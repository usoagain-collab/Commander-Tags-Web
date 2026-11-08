-- v2 Collection tracking: how many copies of each card a user owns (per card, not per printing).
-- Note for the migration runner: keep comments free of quote characters.

create table if not exists public.collection (
  owner_id      uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  oracle_id     uuid not null references public.cards (oracle_id),
  quantity      int not null default 1 check (quantity between 0 and 9999),
  foil_quantity int not null default 0 check (foil_quantity between 0 and 9999),
  updated_at    timestamptz not null default now(),
  primary key (owner_id, oracle_id)
);

alter table public.collection enable row level security;
drop policy if exists "Owner manages collection" on public.collection;
create policy "Owner manages collection" on public.collection for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

revoke all on public.collection from anon, authenticated;
grant select, insert, update, delete on public.collection to authenticated;

notify pgrst, 'reload schema';
