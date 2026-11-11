-- oracle_norm (0048) also treats the word before of as a legend short name: Loran of the Third Path says Loran.
-- Same rule as normalizeOracle in src/lib/search/wording.ts. The stored column is recomputed for the legends
-- this changes; every other row already holds the same value.
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
    if lower(coalesce(p_type, '')) like '%legendary%' then
      if position(',' in face) > 0 then
        n := trim(split_part(face, ',', 1));
      else
        n := coalesce(substring(face from '^(\S+) of '), '');
      end if;
      if length(n) >= 3 then
        names := names || n;
      end if;
    end if;
  end loop;
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

update public.cards set name = name
where type_line ilike '%legendary%' and position(',' in name) = 0 and name ~ '^\S+ of ';
