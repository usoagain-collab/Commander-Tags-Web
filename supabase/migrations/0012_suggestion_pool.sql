-- Phase 4a: the suggestion pool, from our own data (David chose this over Scryfall search, Oct 19, 2026).
-- Candidates: Commander-legal cards inside the given color identity, not in the deck, that carry any of the
-- given oracle tags (the editor passes each tag WITH its descendants, the same sets the role profile uses).
-- With p_lands, candidates are nonbasic lands instead (the Lands role has no tags).
-- Returns the most-played end (by EDHREC rank) plus the least-played ranked end, so the Hidden gems style has
-- real options, each card with its summary fields and its oracle tag slugs:
--   [{...card_summaries columns, tags: [slug, ...]}, ...]
-- One JSON value: no 1000-row cap, and the deck ids travel in the request body, not the URL.
-- Written step by step (plpgsql) on purpose: as a single SQL statement the planner picked a slow generic plan
-- for unknown array inputs (8 s instead of under 1 s).
-- Note for the migration runner: keep comments free of quote characters.

create or replace function public.suggestion_pool(
  p_slugs    text[],
  p_identity text[],
  p_exclude  uuid[] default '{}',
  p_lands    boolean default false,
  p_top      int default 150,
  p_tail     int default 60
)
returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_pick uuid[];
  v_out jsonb;
begin
  -- 1-2. Legal cards in the colors, not in the deck, that carry one of the tags (or are nonbasic lands);
  -- then both ends of the popularity ranking. Joins, not "= any(big array)", which is slow at 10,000 ids.
  with tagged as (
    select distinct ct.oracle_id
    from public.tags t join public.card_tags ct on ct.tag_id = t.id
    where not p_lands and t.kind = 'oracle' and t.slug = any(p_slugs[1:3000])
  ),
  eligible as (
    select c.oracle_id, c.edhrec_rank, c.name
    from public.cards c
    left join tagged tg on tg.oracle_id = c.oracle_id
    where c.commander_legal
      and c.color_identity <@ p_identity
      and not (c.oracle_id = any(coalesce(p_exclude, '{}')))
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

  -- 3. Details and tags for just those cards.
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
grant execute on function public.suggestion_pool(text[], text[], uuid[], boolean, int, int) to anon, authenticated;
