-- Banned and preview cards (friend-test idea, Nov 7, 2026). Searches can now include cards that are banned in
-- Commander or not released yet (Scryfall marks new sets not_legal until release day).
-- cards.released_at is the release date of the printing oracle_cards carries, filled by the nightly import.
-- card_summaries gains commander_status: legal, banned, preview (not out yet, paper, a real card) or not_legal.
-- search_cards gains p_any_legality: true also returns banned and preview cards.
-- Note for the migration runner: keep comments free of quote characters.

alter table public.cards add column if not exists released_at date;

-- One place that says what a card is in Commander. Tokens, art cards and digital-only cards are never preview.
create or replace function public.commander_status(c public.cards)
returns text
language sql stable set search_path = '' as $$
  select case
    when c.legalities->>'commander' = 'legal'  then 'legal'
    when c.legalities->>'commander' = 'banned' then 'banned'
    when c.released_at > current_date
      and 'paper' = any(c.games)
      and c.layout not in ('token', 'double_faced_token', 'emblem', 'art_series', 'vanguard', 'scheme', 'planar')
      then 'preview'
    else 'not_legal'
  end
$$;
grant execute on function public.commander_status(public.cards) to anon, authenticated;

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
  public.commander_status(c) as commander_status
from public.cards c;

revoke all on public.card_summaries from anon, authenticated;
grant select on public.card_summaries to anon, authenticated;

-- Same as 0029, plus p_any_legality. The old three-argument version is dropped so calls are not ambiguous.
drop function if exists public.search_cards(text, int, text[]);

create or replace function public.search_cards(q text, lim int default 10, p_identity text[] default null, p_any_legality boolean default false)
returns setof public.card_summaries
language plpgsql stable security invoker set search_path = '' as $$
declare
  term text := lower(trim(q));
  esc  text := replace(replace(replace(lower(trim(q)), chr(92), chr(92) || chr(92)), '%', chr(92) || '%'), '_', chr(92) || '_');
  n    int  := least(greatest(lim, 1), 25);
  ids  uuid[];
begin
  if length(term) < 2 then
    return;
  elsif length(term) = 2 then
    select array_agg(oracle_id order by r) into ids from (
      select c.oracle_id, row_number() over (order by (lower(c.name) = term) desc, c.edhrec_rank nulls last, c.name) as r
      from public.cards c
      where lower(c.name) like esc || '%'
        and (c.commander_legal or (p_any_legality and public.commander_status(c) in ('banned', 'preview')))
        and (p_identity is null or c.color_identity <@ p_identity)
      order by (lower(c.name) = term) desc, c.edhrec_rank nulls last, c.name
      limit n
    ) x;
  else
    select array_agg(oracle_id order by r) into ids from (
      select c.oracle_id, row_number() over (order by
          case
            when lower(c.name) = term                then 0
            when lower(c.name) like esc || '%'       then 1
            when lower(c.name) like '% ' || esc || '%' then 2
            else 3
          end,
          c.edhrec_rank nulls last, c.name) as r
      from public.cards c
      where lower(c.name) like '%' || esc || '%'
        and (c.commander_legal or (p_any_legality and public.commander_status(c) in ('banned', 'preview')))
        and (p_identity is null or c.color_identity <@ p_identity)
      order by
        case
          when lower(c.name) = term                then 0
          when lower(c.name) like esc || '%'       then 1
          when lower(c.name) like '% ' || esc || '%' then 2
          else 3
        end,
        c.edhrec_rank nulls last, c.name
      limit n
    ) x;
  end if;

  return query
    select s.*
    from unnest(ids) with ordinality as u(id, ord)
    join public.card_summaries s on s.oracle_id = u.id
    order by u.ord;
end;
$$;
grant execute on function public.search_cards(text, int, text[], boolean) to anon, authenticated;
