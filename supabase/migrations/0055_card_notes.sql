-- V3 Card notes (Nov 15, 2026): a line of free text on a card in one of your decks, such as swap for X once bought.
-- One note per card per deck, whatever board it is on. Only the deck owner reads or writes notes: they stay private
-- even on shared and public decks, so nothing else (shared_deck, deck_bundle) changes.
-- Note for the migration runner: keep comments free of quote characters.

create table if not exists public.deck_card_notes (
  deck_id    uuid not null references public.decks(id) on delete cascade,
  oracle_id  uuid not null,
  note       text not null check (char_length(note) between 1 and 280),
  updated_at timestamptz not null default now(),
  primary key (deck_id, oracle_id)
);

alter table public.deck_card_notes enable row level security;
create policy "Owner reads own card notes" on public.deck_card_notes for select to authenticated
  using (exists (select 1 from public.decks d where d.id = deck_id and d.owner_id = (select auth.uid())));
create policy "Owner adds card notes" on public.deck_card_notes for insert to authenticated
  with check (exists (select 1 from public.decks d where d.id = deck_id and d.owner_id = (select auth.uid())));
create policy "Owner changes card notes" on public.deck_card_notes for update to authenticated
  using (exists (select 1 from public.decks d where d.id = deck_id and d.owner_id = (select auth.uid())))
  with check (exists (select 1 from public.decks d where d.id = deck_id and d.owner_id = (select auth.uid())));
create policy "Owner removes card notes" on public.deck_card_notes for delete to authenticated
  using (exists (select 1 from public.decks d where d.id = deck_id and d.owner_id = (select auth.uid())));

revoke all on public.deck_card_notes from anon, authenticated;
grant select, insert, update, delete on public.deck_card_notes to authenticated;

notify pgrst, 'reload schema';
