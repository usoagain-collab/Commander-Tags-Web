-- Store prices from MTGJSON (v2, Nov 11, 2026; docs/spec.md, Prices from MTGJSON, option A).
-- cards.store_prices: per store, the cheapest printing today. Keys ck = Card Kingdom, mp = Mana Pool (both USD),
-- cm = Cardmarket (EUR); inside each, n = normal, f = foil, e = etched, and for Card Kingdom bn / bf = what it pays
-- (buylist). TCGplayer stays the existing price_usd from Scryfall, which is the TCGplayer price.
-- cards.price_trend: change of the cheapest TCGplayer price, d7 and d30 as fractions (0.4 = up 40 percent), was7 and
-- was30 the old prices. Both are written nightly by scripts/import-prices.mts.
-- card_summaries gains both at the end, so every function that returns to_jsonb of a summary row (deck_bundle,
-- shared_deck, suggestion_pool, wording_pool) carries them with no change of its own.
-- deck_price_history: one row per deck per day with the deck total for each price source, kept 400 days.
-- Note for the migration runner: keep comments free of quote characters.

alter table public.cards add column if not exists store_prices jsonb;
alter table public.cards add column if not exists price_trend jsonb;

create or replace view public.card_summaries with (security_invoker = on) as
select
  c.oracle_id,
  c.name,
  c.mana_cost,
  c.mana_value,
  c.type_line,
  c.color_identity,
  c.image_uris->>'normal'   as image_normal,
  c.image_uris->>'art_crop' as image_art_crop,
  c.price_usd,
  c.edhrec_rank,
  c.commander_legal,
  c.game_changer,
  case
    when c.type_line ilike 'basic%land%'                                   then 99
    when c.oracle_text ilike '%a deck can have any number of cards named%' then 99
    when c.oracle_text ilike '%a deck can have up to seven cards named%'   then 7
    when c.oracle_text ilike '%a deck can have up to nine cards named%'    then 9
    else 1
  end as max_copies,
  (c.type_line ilike '%legendary%creature%'
    or c.oracle_text ilike '%can be your commander%'
    or c.type_line ilike '%background%') as can_be_commander,
  c.layout,
  (split_part(c.type_line, ' // ', 1) ~ '\mLand\M'
    or (c.layout = 'modal_dfc' and c.type_line ~ '\mLand\M')) as counts_as_land,
  c.produced_mana,
  public.commander_status(c) as commander_status,
  (split_part(c.type_line, ' // ', 1) ~ '\mInstant\M'
    or c.oracle_text ~ '(^|\n)Flash($|\n| \()') as instant_speed,
  c.artist,
  c.store_prices,
  c.price_trend
from public.cards c;

create table if not exists public.deck_price_history (
  deck_id uuid not null references public.decks (id) on delete cascade,
  day     date not null,
  totals  jsonb not null,
  primary key (deck_id, day)
);

alter table public.deck_price_history enable row level security;

drop policy if exists deck_price_history_read on public.deck_price_history;
create policy deck_price_history_read on public.deck_price_history for select
  using (exists (
    select 1 from public.decks d
    where d.id = deck_id and (d.owner_id = (select auth.uid()) or d.visibility = 'public')
  ));

grant select on public.deck_price_history to anon, authenticated;

alter table public.import_runs drop constraint if exists import_runs_source_check;
alter table public.import_runs add constraint import_runs_source_check check (source in ('scryfall', 'combos', 'precons', 'prices'));

notify pgrst, 'reload schema';
