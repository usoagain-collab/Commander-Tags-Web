-- Precons page: precon_list ran five correlated subqueries per deck and took about 14 s, past the statement
-- timeout. Same result, built from one pass over the precon rows (about 0.7 s).
create or replace function public.precon_list()
returns jsonb
language sql stable security invoker set search_path = '' as $$
  with p as (
    select d.id, d.name, d.precon from public.decks d
    where d.precon is not null and d.visibility = 'public'
  ), r as (
    select dc.deck_id, dc.board, dc.quantity, dc.foil, dc.printing_id, dc.printing_info,
      c.name, c.color_identity, c.price_usd, c.image_uris->>'art_crop' as art
    from p join public.deck_cards dc on dc.deck_id = p.id
    join public.cards c on c.oracle_id = dc.oracle_id
    where dc.board in ('commander', 'main')
  ), agg as (
    select deck_id,
      jsonb_agg(jsonb_build_object('name', name, 'printing_id', printing_id, 'image_v', printing_info->>'image_v', 'art', art) order by name)
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
