-- Phase 3: what the tag layer needs from the database.
--   oracle_tag_tree()   the whole oracle tag tree in one compact JSON value (served by /api/tag-tree, cached daily)
--   card_tags_for(ids)  each card's oracle tags, and the art tags of its default illustration
-- Both return one JSON value rather than rows: the Data API caps responses at 1,000 rows, and the tree has ~4,600.

-- {"n": <distinct tagged cards>, "art_n": <distinct tagged illustrations>,
--  "tags": [[slug, label, size, [parent positions in this list]], ...]}  (sorted by slug)
create or replace function public.oracle_tag_tree()
returns jsonb
language sql stable security invoker set search_path = '' as $$
  with t as (
    select id, slug, label, size, (row_number() over (order by slug) - 1)::int as pos
    from public.tags
    where kind = 'oracle'
  ),
  p as (
    select l.child_id, jsonb_agg(tp.pos order by tp.pos) as parents
    from public.tag_links l
    join t tp on tp.id = l.parent_id
    group by l.child_id
  )
  , latest as (
    -- N for the theme score, recorded by the daily import (counting live would scan ~700k rows).
    select counts from public.import_runs where status = 'succeeded' order by id desc limit 1
  )
  select jsonb_build_object(
    'n',     coalesce((select (counts->>'tagged_cards')::int from latest),
                      (select count(distinct oracle_id) from public.card_tags)),
    'art_n', coalesce((select (counts->>'tagged_illustrations')::int from latest),
                      (select count(distinct illustration_id) from public.illustration_tags)),
    'tags',  (select jsonb_agg(jsonb_build_array(t.slug, t.label, t.size, coalesce(p.parents, '[]'::jsonb)) order by t.pos)
              from t left join p on p.child_id = t.id)
  );
$$;
grant execute on function public.oracle_tag_tree() to anon, authenticated;

-- {"o": {"<oracle_id>": [slug, ...]}, "a": {"<oracle_id>": [[slug, label, size], ...]}}
-- Cards with no tags are simply absent. Art tags use each card's default illustration (printings are v2).
create or replace function public.card_tags_for(oracle_ids uuid[])
returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'o', coalesce((
      select jsonb_object_agg(oracle_id, slugs)
      from (
        select ct.oracle_id, jsonb_agg(t.slug order by t.slug) as slugs
        from public.card_tags ct
        join public.tags t on t.id = ct.tag_id
        where ct.oracle_id = any(oracle_ids[1:400])
        group by ct.oracle_id
      ) x
    ), '{}'::jsonb),
    'a', coalesce((
      select jsonb_object_agg(oracle_id, tags)
      from (
        select c.oracle_id, jsonb_agg(jsonb_build_array(t.slug, t.label, t.size) order by t.size, t.slug) as tags
        from public.cards c
        join public.illustration_tags it on it.illustration_id = c.default_illustration_id
        join public.tags t on t.id = it.tag_id
        where c.oracle_id = any(oracle_ids[1:400])
        group by c.oracle_id
      ) y
    ), '{}'::jsonb)
  );
$$;
grant execute on function public.card_tags_for(uuid[]) to anon, authenticated;
