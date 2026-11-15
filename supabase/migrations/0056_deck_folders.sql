-- V3 Folders on My decks (Nov 15, 2026): group your decks into folders. A deck is in one folder or none.
-- Folders are private to their owner. Deleting a folder keeps its decks, which go back to no folder.
-- A deck can only go in a folder of the same owner (checked by the trigger below, since a policy on decks
-- cannot see whose folder it is pointed at).
-- Note for the migration runner: keep comments free of quote characters.

create table if not exists public.deck_folders (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  name       text not null check (char_length(btrim(name)) between 1 and 60),
  created_at timestamptz not null default now()
);
create unique index if not exists deck_folders_name_uq on public.deck_folders (owner_id, lower(btrim(name)));

alter table public.deck_folders enable row level security;
create policy "Owner reads own folders" on public.deck_folders for select to authenticated
  using (owner_id = (select auth.uid()));
create policy "Owner adds folders" on public.deck_folders for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy "Owner renames own folders" on public.deck_folders for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "Owner deletes own folders" on public.deck_folders for delete to authenticated
  using (owner_id = (select auth.uid()));

revoke all on public.deck_folders from anon, authenticated;
grant select, insert, update, delete on public.deck_folders to authenticated;

alter table public.decks add column if not exists folder_id uuid references public.deck_folders (id) on delete set null;
create index if not exists decks_folder_idx on public.decks (folder_id) where folder_id is not null;

create or replace function public.check_deck_folder() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.folder_id is not null and not exists (
    select 1 from public.deck_folders f where f.id = new.folder_id and f.owner_id = new.owner_id) then
    raise exception 'That folder is not yours';
  end if;
  return new;
end $$;
drop trigger if exists decks_folder_owner on public.decks;
create trigger decks_folder_owner before insert or update of folder_id on public.decks
  for each row execute function public.check_deck_folder();

notify pgrst, 'reload schema';
