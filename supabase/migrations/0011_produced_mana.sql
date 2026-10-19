-- Phase 3i (stats): card_summaries gains produced_mana, the colors of mana a card can make (the Scryfall field
-- produced_mana, already loaded by the importer since 0002). Stats use it to count land sources per color.
-- Appended at the end, as create or replace view requires.

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
  c.produced_mana
from public.cards c;

revoke all on public.card_summaries from anon, authenticated;
grant select on public.card_summaries to anon, authenticated;
