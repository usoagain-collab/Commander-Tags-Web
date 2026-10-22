-- Phase 5a: the combo import logs its runs in import_runs too, so each run records where it came from.
-- oracle_tag_tree reads the theme N values from the latest Scryfall run only (a combo run has no tag counts).
-- Note for the migration runner: keep comments free of quote characters.

alter table public.import_runs add column if not exists source text not null default 'scryfall'
  check (source in ('scryfall', 'combos'));

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
    select counts from public.import_runs where status = 'succeeded' and source = 'scryfall' order by id desc limit 1
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
