-- Phase 2c: look up pasted card names in one call (deck import).
-- Matches the full name or the front face ("Fire" finds "Fire // Ice", "Delver of Secrets" finds the DFC),
-- ignoring case and accents ("Lim-Dul" finds "Lim-Dûl", "Seance" finds "Séance").
-- Returns [{ "input": "<name as given>", "card": { ...card_summaries row } }] for the names found.

create extension if not exists unaccent with schema extensions;

-- unaccent() isn't marked immutable (its dictionary could change), so Postgres won't index it directly.
-- This wrapper pins the dictionary, which makes it safe to mark immutable and use in indexes.
create or replace function public.normalize_card_name(t text) returns text
language sql immutable parallel safe strict set search_path = '' as $$
  select lower(extensions.unaccent('extensions.unaccent'::regdictionary, t));
$$;

create index if not exists cards_name_norm_idx on public.cards (public.normalize_card_name(name));
create index if not exists cards_front_name_norm_idx
  on public.cards (public.normalize_card_name(split_part(name, ' // ', 1)));

create or replace function public.resolve_card_names(names text[])
returns jsonb
language sql stable security invoker set search_path = '' as $$
  with inp as (
    select distinct n as input, public.normalize_card_name(trim(n)) as norm
    from unnest(names[1:600]) as n
    where trim(n) <> ''
  ),
  -- Two plain equality lookups (each can use its index or a hash join) instead of one OR join,
  -- which the function's generic query plan handled badly (~1 s for 100 names instead of a few ms).
  candidates as (
    select i.input, i.norm, c.oracle_id, c.name, c.commander_legal, c.edhrec_rank, true as full_name
    from inp i join public.cards c on public.normalize_card_name(c.name) = i.norm
    union all
    select i.input, i.norm, c.oracle_id, c.name, c.commander_legal, c.edhrec_rank, false
    from inp i join public.cards c on public.normalize_card_name(split_part(c.name, ' // ', 1)) = i.norm
  ),
  matches as (
    select distinct on (input) input, oracle_id
    from candidates
    order by input,
             (lower(name) = lower(trim(input))) desc,  -- exact spelling first
             full_name desc,                           -- full name beats front face
             commander_legal desc,                     -- a real card beats a same-named token
             edhrec_rank nulls last
  )
  select coalesce(jsonb_agg(jsonb_build_object('input', m.input, 'card', to_jsonb(s))), '[]'::jsonb)
  from matches m
  join public.card_summaries s on s.oracle_id = m.oracle_id;
$$;
grant execute on function public.resolve_card_names(text[]) to anon, authenticated;
