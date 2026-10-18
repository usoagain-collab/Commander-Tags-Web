-- Phase 1: card and tag data, loaded daily from Scryfall bulk files.
-- These tables are shared reference data: anyone may read them, only the import job writes them.

-- One row per card (Scryfall "Oracle Cards"), keyed by oracle_id, shared by every printing.
create table public.cards (
  oracle_id               uuid primary key,
  name                    text not null,
  layout                  text,
  mana_cost               text,
  mana_value              numeric not null default 0,
  type_line               text not null default '',
  oracle_text             text,
  color_identity          text[] not null default '{}',   -- e.g. {B,G}
  legalities              jsonb not null default '{}',     -- every format, as Scryfall gives it
  commander_legal         boolean generated always as (legalities->>'commander' = 'legal') stored,
  games                   text[] not null default '{}',   -- paper, mtgo, arena
  edhrec_rank             integer,                         -- lower = more popular; null = unranked
  price_usd               numeric(10, 2),                  -- today's price only
  image_uris              jsonb,                           -- front face for double-faced cards
  default_illustration_id uuid,
  updated_at              timestamptz not null default now()
);

create index cards_name_lower_idx on public.cards (lower(name));
create index cards_color_identity_idx on public.cards using gin (color_identity);
create index cards_edhrec_rank_idx on public.cards (edhrec_rank);

-- Every Tagger tag. An oracle tag and an art tag may share a slug, so (kind, slug) is the unique pair.
create table public.tags (
  id          uuid primary key,                            -- Scryfall's tag id
  slug        text not null,
  label       text not null,
  kind        text not null check (kind in ('oracle', 'art')),
  description text,
  aliases     text[] not null default '{}',
  size        integer not null default 0,                  -- number of cards/illustrations tagged
  unique (kind, slug)
);

-- The tag tree. Cards are tagged at one level only; parents are implied through these links.
create table public.tag_links (
  parent_id uuid not null references public.tags (id) on delete cascade,
  child_id  uuid not null references public.tags (id) on delete cascade,
  primary key (parent_id, child_id),
  check (parent_id <> child_id)
);
create index tag_links_child_idx on public.tag_links (child_id);

-- Oracle tags on cards (same for every printing).
create table public.card_tags (
  oracle_id  uuid not null references public.cards (oracle_id) on delete cascade,
  tag_id     uuid not null references public.tags (id) on delete cascade,
  weight     text,
  annotation text,
  primary key (oracle_id, tag_id)
);
create index card_tags_tag_idx on public.card_tags (tag_id);

-- Art tags on illustrations (printing-specific; use the deck's chosen printing).
-- No foreign key on illustration_id yet: printings arrive with the printing picker in Phase 2.
create table public.illustration_tags (
  illustration_id uuid not null,
  tag_id          uuid not null references public.tags (id) on delete cascade,
  weight          text,
  annotation      text,
  primary key (illustration_id, tag_id)
);
create index illustration_tags_tag_idx on public.illustration_tags (tag_id);

-- One row per import run, so the app can show "data as of" and we can see row counts.
create table public.import_runs (
  id          bigint generated always as identity primary key,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  status      text not null default 'running' check (status in ('running', 'succeeded', 'failed')),
  counts      jsonb,                                       -- {cards, oracle_tags, art_tags, tag_links, ...}
  error       text
);

-- Row-level security: read-only for everyone (signed in or not). No write policies, so only the
-- import job (connecting as the database owner) can change these tables.
alter table public.cards             enable row level security;
alter table public.tags              enable row level security;
alter table public.tag_links         enable row level security;
alter table public.card_tags         enable row level security;
alter table public.illustration_tags enable row level security;
alter table public.import_runs       enable row level security;

create policy "Card data is public" on public.cards             for select to anon, authenticated using (true);
create policy "Card data is public" on public.tags              for select to anon, authenticated using (true);
create policy "Card data is public" on public.tag_links         for select to anon, authenticated using (true);
create policy "Card data is public" on public.card_tags         for select to anon, authenticated using (true);
create policy "Card data is public" on public.illustration_tags for select to anon, authenticated using (true);
create policy "Card data is public" on public.import_runs       for select to anon, authenticated using (true);
