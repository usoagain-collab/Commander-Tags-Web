-- v2 Collection by printing: one row per card, printing and finish, so the collection shows each printing you own
-- and decks can tell the exact printing from another one. printing_id null = printing unknown (plain lists and
-- everything from 0038, which is copied over here). printing_info holds set, set_name, number, illustration_id,
-- finishes and prices, copied at add time like deck_cards.printing_info, since all printings are not stored.
-- Note for the migration runner: keep comments free of quote characters.

create table if not exists public.collection_cards (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  oracle_id     uuid not null references public.cards (oracle_id),
  printing_id   uuid,
  finish        text not null default 'nonfoil' check (finish in ('nonfoil', 'foil', 'etched')),
  quantity      int not null default 1 check (quantity between 1 and 9999),
  printing_info jsonb,
  added_at      timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint collection_cards_one_row unique nulls not distinct (owner_id, oracle_id, printing_id, finish)
);

alter table public.collection_cards enable row level security;
drop policy if exists "Owner manages collection cards" on public.collection_cards;
create policy "Owner manages collection cards" on public.collection_cards for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

revoke all on public.collection_cards from anon, authenticated;
grant select, insert, update, delete on public.collection_cards to authenticated;

insert into public.collection_cards (owner_id, oracle_id, printing_id, finish, quantity, added_at, updated_at)
select owner_id, oracle_id, null::uuid, 'nonfoil', quantity, updated_at, updated_at from public.collection where quantity > 0
union all
select owner_id, oracle_id, null::uuid, 'foil', foil_quantity, updated_at, updated_at from public.collection where foil_quantity > 0
on conflict do nothing;

notify pgrst, 'reload schema';
