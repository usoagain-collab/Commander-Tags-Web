-- Binders and boxes (v2, David chose option A on Nov 25, 2026): copies per location.
-- collection_locations holds each binder, box or deck box with its own look (style jsonb: color, cover card, layout,
-- pocket size, card size, sort; read by src/lib/deck/locations.ts, so new style fields need no migration).
-- collection_cards.location_id says where the copies are; null = Unsorted. It joins the unique key, so 3 in the
-- Blue binder and 1 in the Trade box are two rows and owned totals add up.
-- Deleting a location goes through delete_collection_location, which merges its copies into Unsorted first.
-- Note for the migration runner: keep comments free of quote characters.

create table if not exists public.collection_locations (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  name       text not null check (char_length(btrim(name)) between 1 and 40),
  kind       text not null default 'binder' check (kind in ('binder', 'box', 'deckbox', 'other')),
  style      jsonb not null default '{}'::jsonb,
  sort       int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists collection_locations_name on public.collection_locations (owner_id, lower(btrim(name)));

alter table public.collection_locations enable row level security;
drop policy if exists "Owner manages collection locations" on public.collection_locations;
create policy "Owner manages collection locations" on public.collection_locations for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

revoke all on public.collection_locations from anon, authenticated;
grant select, insert, update, delete on public.collection_locations to authenticated;

drop trigger if exists set_updated_at on public.collection_locations;
create trigger set_updated_at before update on public.collection_locations for each row execute function public.set_updated_at();
drop trigger if exists limit_size on public.collection_locations;
create trigger limit_size before insert or update on public.collection_locations for each row execute function public.limit_row_size('4096');
drop trigger if exists limit_count on public.collection_locations;
create trigger limit_count after insert on public.collection_locations referencing new table as added
  for each statement execute function public.limit_row_count('owner_id', '200', 'binders and boxes');

-- Where the copies are. Restrict, so a location is never deleted with rows still in it (the function moves them).
alter table public.collection_cards add column if not exists location_id uuid references public.collection_locations (id) on delete restrict;
create index if not exists collection_cards_location on public.collection_cards (location_id) where location_id is not null;

alter table public.collection_cards drop constraint if exists collection_cards_one_row;
alter table public.collection_cards add constraint collection_cards_one_row
  unique nulls not distinct (owner_id, oracle_id, printing_id, finish, location_id);

-- A row can only point at a location of the same owner.
create or replace function public.collection_location_owner()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.location_id is not null and not exists (
    select 1 from public.collection_locations l where l.id = new.location_id and l.owner_id = new.owner_id
  ) then
    raise exception 'That binder or box is not yours.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists collection_location_owner on public.collection_cards;
create trigger collection_location_owner before insert or update of location_id, owner_id on public.collection_cards
  for each row execute function public.collection_location_owner();

-- Deletes one of your locations; its copies join Unsorted (adding to a row already there). Returns copies moved.
create or replace function public.delete_collection_location(p_id uuid)
returns int
language plpgsql
security invoker
set search_path = ''
as $$
declare
  moved int;
begin
  if not exists (select 1 from public.collection_locations where id = p_id and owner_id = (select auth.uid())) then
    raise exception 'That binder or box was not found.' using errcode = 'P0002';
  end if;
  select coalesce(sum(quantity), 0) into moved from public.collection_cards where location_id = p_id;
  insert into public.collection_cards (owner_id, oracle_id, printing_id, finish, quantity, printing_info, location_id, added_at)
  select owner_id, oracle_id, printing_id, finish, quantity, printing_info, null, added_at
  from public.collection_cards where location_id = p_id
  on conflict on constraint collection_cards_one_row do update
    set quantity = least(9999, public.collection_cards.quantity + excluded.quantity),
        printing_info = coalesce(public.collection_cards.printing_info, excluded.printing_info),
        updated_at = now();
  delete from public.collection_cards where location_id = p_id;
  delete from public.collection_locations where id = p_id;
  return moved;
end;
$$;

revoke all on function public.delete_collection_location(uuid) from public, anon;
grant execute on function public.delete_collection_location(uuid) to authenticated;

notify pgrst, 'reload schema';
