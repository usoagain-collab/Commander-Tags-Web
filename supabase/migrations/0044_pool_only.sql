-- Suggest filters (v2, Nov 8, 2026): suggestion_pool takes p_only, the cards a Scryfall search found, and keeps
-- the pool inside them, so a filter refills the pool instead of shrinking it. Null means no filter.
-- The old six-argument version is dropped first: two versions with defaults would make PostgREST unable to choose.
-- Same body as 0012 otherwise. Code that does not send p_only keeps working once this has run.
-- Note for the migration runner: keep comments free of quote characters.

drop function if exists public.suggestion_pool(text[], text[], uuid[], boolean, int, int);

create or replace function public.suggestion_pool(
  p_slugs    text[],
  p_identity text[],
  p_exclude  uuid[] default '{}',
  p_lands    boolean default false,
  p_top      int default 150,
  p_tail     int default 60,
  p_only     uuid[] default null
)
returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_pick uuid[];
  v_out jsonb;
begin
  with tagged as (
    select distinct ct.oracle_id
    from public.tags t join public.card_tags ct on ct.tag_id = t.id
    where not p_lands and t.kind = 'oracle' and t.slug = any(p_slugs[1:3000])
  ),
  only_ids as (
    select distinct unnest(p_only) as oracle_id
  ),
  eligible as (
    select c.oracle_id, c.edhrec_rank, c.name
    from public.cards c
    left join tagged tg on tg.oracle_id = c.oracle_id
    where c.commander_legal
      and c.color_identity <@ p_identity
      and not (c.oracle_id = any(coalesce(p_exclude, '{}')))
      and (p_only is null or c.oracle_id in (select oracle_id from only_ids))
      and (
        (p_lands and c.type_line !~* 'basic'
          and (split_part(c.type_line, ' // ', 1) ~ '\mLand\M' or (c.layout = 'modal_dfc' and c.type_line ~ '\mLand\M')))
        or (not p_lands and tg.oracle_id is not null)
      )
  ),
  top_end as (
    select oracle_id from eligible order by edhrec_rank nulls last, name limit least(p_top, 300)
  ),
  tail_end as (
    select oracle_id from eligible
    where edhrec_rank is not null and oracle_id not in (select oracle_id from top_end)
    order by edhrec_rank desc limit least(p_tail, 150)
  )
  select array_agg(oracle_id) into v_pick from (select oracle_id from top_end union all select oracle_id from tail_end) x;
  if v_pick is null then
    return '[]'::jsonb;
  end if;

  with tagset as (
    select ct.oracle_id, jsonb_agg(t.slug order by t.slug) as tags
    from public.card_tags ct join public.tags t on t.id = ct.tag_id
    where ct.oracle_id = any(v_pick) and t.kind = 'oracle'
    group by ct.oracle_id
  )
  select coalesce(jsonb_agg(to_jsonb(s) || jsonb_build_object('tags', coalesce(ts.tags, '[]'::jsonb))
                            order by s.edhrec_rank nulls last, s.name), '[]'::jsonb)
    into v_out
  from public.card_summaries s left join tagset ts on ts.oracle_id = s.oracle_id
  where s.oracle_id = any(v_pick);
  return v_out;
end $$;
grant execute on function public.suggestion_pool(text[], text[], uuid[], boolean, int, int, uuid[]) to anon, authenticated;
