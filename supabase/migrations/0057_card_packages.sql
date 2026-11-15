-- V3 Packages (Nov 15, 2026): a saved group of cards, such as a ramp suite or an aristocrats core, that you can
-- add to any deck in one go. Packages belong to a person, not a deck, and are private to them.
-- Note for the migration runner: keep comments free of quote characters.

create table if not exists public.card_packages (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  name       text not null check (char_length(btrim(name)) between 1 and 60),
  created_at timestamptz not null default now()
);
create unique index if not exists card_packages_name_uq on public.card_packages (owner_id, lower(btrim(name)));

create table if not exists public.card_package_cards (
  package_id uuid not null references public.card_packages (id) on delete cascade,
  oracle_id  uuid not null references public.cards (oracle_id),
  quantity   smallint not null default 1 check (quantity between 1 and 99),
  primary key (package_id, oracle_id)
);

alter table public.card_packages enable row level security;
create policy "Owner reads own packages" on public.card_packages for select to authenticated
  using (owner_id = (select auth.uid()));
create policy "Owner adds packages" on public.card_packages for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy "Owner renames own packages" on public.card_packages for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "Owner deletes own packages" on public.card_packages for delete to authenticated
  using (owner_id = (select auth.uid()));

alter table public.card_package_cards enable row level security;
create policy "Owner reads own package cards" on public.card_package_cards for select to authenticated
  using (exists (select 1 from public.card_packages p where p.id = package_id and p.owner_id = (select auth.uid())));
create policy "Owner adds package cards" on public.card_package_cards for insert to authenticated
  with check (exists (select 1 from public.card_packages p where p.id = package_id and p.owner_id = (select auth.uid())));
create policy "Owner changes package cards" on public.card_package_cards for update to authenticated
  using (exists (select 1 from public.card_packages p where p.id = package_id and p.owner_id = (select auth.uid())))
  with check (exists (select 1 from public.card_packages p where p.id = package_id and p.owner_id = (select auth.uid())));
create policy "Owner removes package cards" on public.card_package_cards for delete to authenticated
  using (exists (select 1 from public.card_packages p where p.id = package_id and p.owner_id = (select auth.uid())));

revoke all on public.card_packages, public.card_package_cards from anon, authenticated;
grant select, insert, update, delete on public.card_packages, public.card_package_cards to authenticated;

notify pgrst, 'reload schema';
