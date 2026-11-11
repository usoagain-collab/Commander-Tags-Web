-- Wording matches in Suggest (v2, Nov 10, 2026). Cards whose rules text says one of the phrases (cards_with_wording,
-- migration 0048), in the same shape as suggestion_pool (card_summaries row plus its oracle tags) and with says =
-- the phrases each card matched. Unlike suggestion_pool it needs no tag in common with the deck, so new cards
-- that Tagger has not reached yet can show. Most phrases matched first, then most played.
-- Note for the migration runner: keep comments free of quote characters.

create or replace function public.wording_pool(
  p_phrases  text[],
  p_identity text[],
  p_exclude  uuid[] default '{}',
  p_lim      int default 60,
  p_only     uuid[] default null
)
returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_out jsonb;
begin
  with hits as (
    select w.oracle_id, w.matched
    from public.cards_with_wording(p_phrases, p_identity, 2000) w
    where not (w.oracle_id = any(coalesce(p_exclude, '{}')))
      and (p_only is null or w.oracle_id = any(p_only))
  ),
  picked as (
    select h.oracle_id, h.matched
    from hits h join public.cards c on c.oracle_id = h.oracle_id
    order by cardinality(h.matched) desc, c.edhrec_rank nulls last, c.name
    limit least(greatest(p_lim, 1), 200)
  ),
  tagset as (
    select ct.oracle_id, jsonb_agg(t.slug order by t.slug) as tags
    from public.card_tags ct join public.tags t on t.id = ct.tag_id
    where ct.oracle_id in (select oracle_id from picked) and t.kind = 'oracle'
    group by ct.oracle_id
  )
  select coalesce(jsonb_agg(
           to_jsonb(s) || jsonb_build_object('tags', coalesce(ts.tags, '[]'::jsonb), 'says', to_jsonb(p.matched))
           order by cardinality(p.matched) desc, s.edhrec_rank nulls last, s.name), '[]'::jsonb)
    into v_out
  from picked p
  join public.card_summaries s on s.oracle_id = p.oracle_id
  left join tagset ts on ts.oracle_id = p.oracle_id;
  return v_out;
end $$;

grant execute on function public.wording_pool(text[], text[], uuid[], int, uuid[]) to anon, authenticated;
