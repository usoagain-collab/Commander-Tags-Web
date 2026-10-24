-- Speed: quick add timed out on two-letter searches (so, el, ...). A two-letter pattern has no trigrams, so the
-- name search read the whole cards table (about 150 MB, often from disk) and built every matching row of the
-- card_summaries view before keeping 8. Now:
--   two letters      names starting with them, through a small prefix index (text_pattern_ops);
--   three or more    names containing them, through the existing trigram index, as before;
-- and the best matches are picked from cards first, then only those rows go through card_summaries.
-- Same ranking as before: exact name, then starts with, then a word starts with, then contains; popular first.
-- Note for the migration runner: keep comments free of quote characters.

create index if not exists cards_name_prefix_idx on public.cards (lower(name) text_pattern_ops);

create or replace function public.search_cards(q text, lim int default 10)
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
grant execute on function public.search_cards(text, int) to anon, authenticated;
