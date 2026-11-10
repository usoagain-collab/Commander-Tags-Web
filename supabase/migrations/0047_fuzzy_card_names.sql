-- Name boxes found nothing for a typo (atrxa), a missing apostrophe (praetors voice) or a missing accent (lim dul),
-- because search_cards only matches the typed text inside the name. This is the fallback the boxes ask for when
-- search_cards finds nothing: trigram word similarity on the lowercased name, using cards_name_trgm_idx.
-- Same filters and result shape as search_cards. The threshold is lowered for this call only.
-- Note for the migration runner: keep comments free of quote characters.

create or replace function public.fuzzy_card_names(
  q text,
  lim int default 8,
  p_identity text[] default null,
  p_any_legality boolean default false,
  p_commanders_only boolean default false
)
returns setof public.card_summaries
language plpgsql volatile security invoker set search_path = '' as $$
declare
  term text := lower(trim(q));
  n    int  := least(greatest(lim, 1), 25);
  ids  uuid[];
begin
  if length(term) < 3 then
    return;
  end if;
  perform set_config('pg_trgm.word_similarity_threshold', '0.45', true);
  select array_agg(oracle_id order by r) into ids from (
    select c.oracle_id, row_number() over (order by extensions.word_similarity(term, lower(c.name)) desc, c.edhrec_rank nulls last, c.name) as r
    from public.cards c
    where term operator(extensions.<%) lower(c.name)
      and (c.commander_legal or (p_any_legality and public.commander_status(c) in ('banned', 'preview')))
      and (p_identity is null or c.color_identity <@ p_identity)
      and (not p_commanders_only
        or c.type_line ilike '%legendary%creature%'
        or c.oracle_text ilike '%can be your commander%'
        or c.type_line ilike '%background%')
    order by extensions.word_similarity(term, lower(c.name)) desc, c.edhrec_rank nulls last, c.name
    limit n
  ) x;

  return query
    select s.*
    from unnest(ids) with ordinality as u(id, ord)
    join public.card_summaries s on s.oracle_id = u.id
    order by u.ord;
end;
$$;

revoke all on function public.fuzzy_card_names(text, int, text[], boolean, boolean) from public;
grant execute on function public.fuzzy_card_names(text, int, text[], boolean, boolean) to anon, authenticated;

notify pgrst, 'reload schema';
