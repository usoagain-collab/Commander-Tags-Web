-- Quick add showed cards outside the commander colors. search_cards now takes the deck color identity
-- (null = any colors, used while picking a commander and by the avatar picker) and keeps only cards inside it.
-- Otherwise the same as 0022: prefix index for two letters, trigram index for three or more, best matches
-- picked from cards first, then only those rows go through card_summaries.
-- The old two-argument version is dropped so a call with only q and lim is not ambiguous.
-- Note for the migration runner: keep comments free of quote characters.

drop function if exists public.search_cards(text, int);

create or replace function public.search_cards(q text, lim int default 10, p_identity text[] default null)
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
      where c.commander_legal and lower(c.name) like esc || '%'
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
      where c.commander_legal and lower(c.name) like '%' || esc || '%'
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
grant execute on function public.search_cards(text, int, text[]) to anon, authenticated;
