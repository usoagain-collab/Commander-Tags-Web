-- v2 Wish list: cards a user wants to buy, separate from any deck. One private list per user.
-- Note for the migration runner: keep comments free of quote characters.

create table if not exists public.wishlist (
  owner_id  uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  oracle_id uuid not null references public.cards (oracle_id),
  quantity  smallint not null default 1 check (quantity between 1 and 99),
  foil      boolean not null default false,
  note      text check (char_length(note) <= 200),
  added_at  timestamptz not null default now(),
  primary key (owner_id, oracle_id)
);

alter table public.wishlist enable row level security;
drop policy if exists "Owner manages wish list" on public.wishlist;
create policy "Owner manages wish list" on public.wishlist for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

revoke all on public.wishlist from anon, authenticated;
grant select, insert, update, delete on public.wishlist to authenticated;

notify pgrst, 'reload schema';
