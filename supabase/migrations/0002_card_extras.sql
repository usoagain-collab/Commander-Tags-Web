-- Two card fields found in the bulk data that later phases need.
alter table public.cards
  add column game_changer  boolean not null default false,   -- WotC Game Changers list (bracket checks)
  add column produced_mana text[]  not null default '{}';    -- colors of mana it can make (land-source stats)
