-- Rules text searchable on our side (v2, Nov 10, 2026; measured first with scripts/measure-wording.mjs).
-- cards.oracle_norm = the rules text in lower case with the card name written as a tilde, as in Scryfall syntax,
-- so a phrase such as "when ~ enters" finds every card with that wording whatever its name.
-- Names swapped: the full name, each face of a split or double-faced card, and for legends the short name
-- before the comma (Omo for Omo, Queen of Vesuva), only as a whole word.
-- A stored generated column, so the nightly import needs no change. A trigram index makes phrase search fast.
-- Note for the migration runner: keep comments free of quote characters.

create or replace function public.oracle_norm(p_name text, p_type text, p_text text)
returns text
language plpgsql immutable parallel safe set search_path = '' as $$
declare
  t      text := lower(coalesce(p_text, ''));
  full_n text := lower(coalesce(p_name, ''));
  names  text[] := array[]::text[];
  face   text;
  n      text;
begin
  if t = '' or full_n = '' then
    return t;
  end if;
  names := names || full_n;
  foreach face in array string_to_array(full_n, ' // ') loop
    if face <> full_n then
      names := names || face;
    end if;
    if position(',' in face) > 0 and lower(coalesce(p_type, '')) like '%legendary%' then
      n := trim(split_part(face, ',', 1));
      if length(n) >= 3 then
        names := names || n;
      end if;
    end if;
  end loop;
  -- Longest first, so a short name never cuts into a longer one.
  foreach n in array (select array_agg(x order by length(x) desc) from unnest(names) x) loop
    t := regexp_replace(
      t,
      '(?<![[:alnum:]])' || regexp_replace(n, '([^[:alnum:] ])', '\\\1', 'g') || '(?![[:alnum:]])',
      '~',
      'g'
    );
  end loop;
  return t;
end $$;

alter table public.cards
  add column if not exists oracle_norm text
  generated always as (public.oracle_norm(name, type_line, oracle_text)) stored;

create index if not exists cards_oracle_norm_trgm_idx
  on public.cards using gin (oracle_norm extensions.gin_trgm_ops);

-- Which phrases each Commander-legal card inside the colors says. Phrases are matched in lower case,
-- at least 4 characters each, at most 24 phrases. Used by Suggest for wording matches.
create or replace function public.cards_with_wording(
  p_phrases text[],
  p_identity text[] default null,
  lim int default 500
)
returns table (oracle_id uuid, matched text[])
language sql stable security invoker set search_path = '' as $$
  with p as (
    select distinct lower(trim(x)) as phrase
    from unnest(p_phrases[1:24]) x
    where length(trim(x)) >= 4
  )
  select c.oracle_id, array_agg(p.phrase order by p.phrase)
  from p
  join public.cards c on c.oracle_norm like '%' || p.phrase || '%'
  where c.commander_legal
    and (p_identity is null or c.color_identity <@ p_identity)
  group by c.oracle_id, c.edhrec_rank
  order by count(*) desc, c.edhrec_rank nulls last
  limit least(greatest(lim, 1), 2000)
$$;

grant execute on function public.cards_with_wording(text[], text[], int) to anon, authenticated;
