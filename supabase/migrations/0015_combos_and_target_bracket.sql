-- Phase 5a: bracket targeting data. Schema approved by David, Oct 21, 2026.
--   combos              two-card combos from Commander Spellbook, rebuilt daily by scripts/import-combos.mts
--   decks.target_bracket the bracket the builder aims for, 1 to 5, default 3 (Upgraded)
--   combos_within(ids)  the combos whose two cards are both in a list of cards
-- Note for the migration runner: keep comments free of quote characters.

create table public.combos (
  id          text primary key,      -- Spellbook variant id, e.g. 116-4613-6859
  card_a      uuid not null references public.cards (oracle_id),
  card_b      uuid not null references public.cards (oracle_id),
  results     text[] not null default '{}',  -- what it does, up to 3 features, e.g. Infinite mana
  bracket_tag text,                  -- Spellbook rating letter, R = Ruthless down to E = Exhibition
  requires    int not null default 0, -- extra generic pieces needed, 0 = just these two cards
  popularity  int,                   -- decks running it, per Spellbook (may be empty)
  check (card_a < card_b)            -- each pair stored in one fixed order
);
create index combos_card_a_idx on public.combos (card_a);
create index combos_card_b_idx on public.combos (card_b);

-- Read-only reference data, like the card tables.
alter table public.combos enable row level security;
create policy "Anyone reads combos" on public.combos for select to anon, authenticated using (true);
revoke all on public.combos from anon, authenticated;
grant select on public.combos to anon, authenticated;

alter table public.decks add column if not exists target_bracket smallint not null default 3
  check (target_bracket between 1 and 5);

-- [{id, card_a, card_b, results, bracket_tag, requires, popularity}, ...] for combos fully inside the list.
-- One JSON value, ids in the request body (a deck can have hundreds of cards).
create or replace function public.combos_within(p_ids uuid[])
returns jsonb
language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(c) order by c.popularity desc nulls last, c.id), '[]'::jsonb)
  from public.combos c
  where c.card_a = any(p_ids[1:1000]) and c.card_b = any(p_ids[1:1000]);
$$;
grant execute on function public.combos_within(uuid[]) to anon, authenticated;
