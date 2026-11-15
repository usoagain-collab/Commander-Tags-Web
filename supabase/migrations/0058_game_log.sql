-- V3 Game log (Nov 15, 2026): games you record for one of your decks. Each game has a date, a result, the pod
-- size, who you played against (free text), a note, and which cards stood out or flopped. Private to the deck
-- owner. Flopped cards also count as playtest flags (the app calls flag_card for each), so they show where
-- playtester flags already do.
-- Note for the migration runner: keep comments free of quote characters.

create table if not exists public.deck_games (
  id         uuid primary key default gen_random_uuid(),
  deck_id    uuid not null references public.decks (id) on delete cascade,
  owner_id   uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  played_on  date not null default current_date,
  result     text not null check (result in ('win', 'loss', 'draw')),
  pod_size   smallint check (pod_size between 2 and 8),
  opponents  text check (char_length(opponents) <= 200),
  note       text check (char_length(note) <= 500),
  standouts  uuid[] not null default '{}' check (cardinality(standouts) <= 20),
  flops      uuid[] not null default '{}' check (cardinality(flops) <= 20),
  created_at timestamptz not null default now()
);
create index if not exists deck_games_deck_idx on public.deck_games (deck_id, played_on desc);

alter table public.deck_games enable row level security;
create policy "Owner reads own games" on public.deck_games for select to authenticated
  using (owner_id = (select auth.uid()));
create policy "Owner logs games" on public.deck_games for insert to authenticated
  with check (owner_id = (select auth.uid())
              and exists (select 1 from public.decks d where d.id = deck_id and d.owner_id = (select auth.uid())));
create policy "Owner edits own games" on public.deck_games for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid())
              and exists (select 1 from public.decks d where d.id = deck_id and d.owner_id = (select auth.uid())));
create policy "Owner deletes own games" on public.deck_games for delete to authenticated
  using (owner_id = (select auth.uid()));

revoke all on public.deck_games from anon, authenticated;
grant select, insert, update, delete on public.deck_games to authenticated;

notify pgrst, 'reload schema';
