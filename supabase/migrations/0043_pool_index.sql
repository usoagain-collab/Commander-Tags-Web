-- Suggestions timed out on a cold database (friend report, Nov 8, 2026: statement timeout in Hidden gems).
-- suggestion_pool checks every card carrying one of the deck themes (25,000 cards for a broad deck) for
-- legality, colors and rank. Those checks read the full cards rows, and cards is 122 MB because of
-- legalities and image addresses, so with nothing in memory the reads took 11 s, over the 8 s limit.
-- This small covering index holds just the columns that step reads, so it is answered from the index
-- (a few MB) without touching the table.
-- Note for the migration runner: keep comments free of quote characters.

create index if not exists cards_pool_idx
  on public.cards (oracle_id) include (commander_legal, color_identity, edhrec_rank, name);

analyze public.cards;
