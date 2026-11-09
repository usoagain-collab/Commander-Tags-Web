-- Auto build land base timed out on a cold database.
-- The basics lookup by name read every card row, 6.6 s, because no index covers name itself.
-- The nonbasic land pool walked the edhrec_rank index over about 2,100 full card rows to find 250 lands.
-- Two small partial indexes whose predicates match the panel filters: basics by name, nonbasic lands by rank.
-- Note for the migration runner: keep comments free of quote characters.

create index if not exists cards_basic_name_idx on public.cards (name)
  where type_line ilike 'Basic%';

create index if not exists cards_land_pool_idx on public.cards (edhrec_rank) include (color_identity, commander_legal)
  where type_line ilike '%Land%' and not (type_line ilike '%Basic%') and edhrec_rank is not null;

analyze public.cards;
