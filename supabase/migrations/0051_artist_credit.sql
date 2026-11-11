-- Artist credit (Nov 11, 2026). Scryfall asks that wherever an art_crop image shows, the artist name and the
-- copyright line show in the same view (docs/api/images). cards.artist holds the artist of the card default
-- printing, the one whose image_uris we keep. card_summaries gains artist at the end, since a view can only gain
-- columns there. precon_list adds each commander artist: the chosen printing artist from printing_info when the
-- row has a printing, otherwise the card default. The nightly import fills printing_info artist for chosen printings.
-- Note for the migration runner: keep comments free of quote characters.

alter table public.cards add column if not exists artist text;

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
  c.artist
from public.cards c;

create or replace function public.precon_list()
returns jsonb
language sql stable security invoker set search_path = '' as $$
  with p as (
    select d.id, d.name, d.precon from public.decks d
    where d.precon is not null and d.visibility = 'public'
  ), r as (
    select dc.deck_id, dc.board, dc.quantity, dc.foil, dc.printing_id, dc.printing_info,
      c.name, c.color_identity, c.price_usd, c.image_uris->>'art_crop' as art,
      case when dc.printing_id is null then c.artist else dc.printing_info->>'artist' end as artist
    from p join public.deck_cards dc on dc.deck_id = p.id
    join public.cards c on c.oracle_id = dc.oracle_id
    where dc.board in ('commander', 'main')
  ), agg as (
    select deck_id,
      jsonb_agg(jsonb_build_object('name', name, 'printing_id', printing_id, 'image_v', printing_info->>'image_v', 'art', art, 'artist', artist) order by name)
        filter (where board = 'commander') as commanders,
      sum(quantity) as size,
      round(coalesce(sum(quantity * coalesce(
        case when foil then coalesce((printing_info->>'usd_foil')::numeric, (printing_info->>'usd_etched')::numeric) else (printing_info->>'usd')::numeric end,
        price_usd, 0)), 0), 2) as price
    from r group by deck_id
  ), ident as (
    select deck_id, jsonb_agg(distinct ci) as identity
    from r, unnest(r.color_identity) ci where board = 'commander' group by deck_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id, 'name', p.name, 'precon', p.precon - 'hash',
      'commanders', coalesce(a.commanders, '[]'::jsonb), 'identity', coalesce(i.identity, '[]'::jsonb),
      'size', coalesce(a.size, 0), 'price', coalesce(a.price, 0))
    order by p.precon->>'release' desc nulls last, p.name), '[]'::jsonb)
  from p left join agg a on a.deck_id = p.id left join ident i on i.deck_id = p.id;
$$;

revoke all on function public.precon_list() from public;
grant execute on function public.precon_list() to anon, authenticated;

notify pgrst, 'reload schema';
