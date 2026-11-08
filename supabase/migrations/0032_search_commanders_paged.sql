-- The commander box showed only a few results: it asked search_cards for 25 name matches and then kept only
-- cards that can be a commander. search_cards now filters commanders itself (p_commanders_only, the same test
-- as card_summaries.can_be_commander) and takes p_offset, so the box loads the next page as you scroll.
-- Otherwise the same as 0031. The old four-argument version is dropped so calls are not ambiguous.
-- Note for the migration runner: keep comments free of quote characters.

drop function if exists public.search_cards(text, int, text[], boolean);

create or replace function public.search_cards(
  q text,
  lim int default 10,
  p_identity text[] default null,
  p_any_legality boolean default false,
  p_commanders_only boolean default false,
  p_offset int default 0
)
returns setof public.card_summaries
language plpgsql stable security invoker set search_path = '' as $$
declare
  term text := lower(trim(q));
  esc  text := replace(replace(replace(lower(trim(q)), chr(92), chr(92) || chr(92)), '%', chr(92) || '%'), '_', chr(92) || '_');
  n    int  := least(greatest(lim, 1), 25);
  skip int  := least(greatest(coalesce(p_offset, 0), 0), 500);
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
        and (not p_commanders_only
          or c.type_line ilike '%legendary%creature%'
          or c.oracle_text ilike '%can be your commander%'
          or c.type_line ilike '%background%')
      order by (lower(c.name) = term) desc, c.edhrec_rank nulls last, c.name
      limit n offset skip
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
        and (not p_commanders_only
          or c.type_line ilike '%legendary%creature%'
          or c.oracle_text ilike '%can be your commander%'
          or c.type_line ilike '%background%')
      order by
        case
          when lower(c.name) = term                then 0
          when lower(c.name) like esc || '%'       then 1
          when lower(c.name) like '% ' || esc || '%' then 2
          else 3
        end,
        c.edhrec_rank nulls last, c.name
      limit n offset skip
    ) x;
  end if;

  return query
    select s.*
    from unnest(ids) with ordinality as u(id, ord)
    join public.card_summaries s on s.oracle_id = u.id
    order by u.ord;
end;
$$;
grant execute on function public.search_cards(text, int, text[], boolean, boolean, int) to anon, authenticated;
