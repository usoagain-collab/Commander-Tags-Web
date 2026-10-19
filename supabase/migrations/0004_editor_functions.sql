-- Phase 2b: what the deck editor needs from the database.
--   card_summaries      a slim, read-only view of cards (only the columns the editor shows, plus derived rules)
--   search_cards()      quick-add type-ahead: matches anywhere in the name, best matches first
--   apply_deck_changes  autosave: applies one edit (one or more card rows) atomically, as the signed-in user

-- ---------- fast "name contains" search ----------
create extension if not exists pg_trgm with schema extensions;
create index if not exists cards_name_trgm_idx on public.cards using gin (lower(name) extensions.gin_trgm_ops);

-- ---------- card_summaries ----------
-- security_invoker: the view runs with the caller's permissions, so the cards table's RLS still applies.
create view public.card_summaries with (security_invoker = on) as
select
  c.oracle_id,
  c.name,
  c.mana_cost,
  c.mana_value,
  c.type_line,
  c.color_identity,
  c.image_uris->>'normal'   as image_normal,
  c.image_uris->>'art_crop' as image_art_crop,
  c.price_usd,
  c.edhrec_rank,
  c.commander_legal,
  c.game_changer,
  -- How many copies Commander allows: basics and "any number" cards are unlimited; a few name a number.
  case
    when c.type_line ilike 'basic%land%'                                   then 99
    when c.oracle_text ilike '%a deck can have any number of cards named%' then 99
    when c.oracle_text ilike '%a deck can have up to seven cards named%'   then 7
    when c.oracle_text ilike '%a deck can have up to nine cards named%'    then 9
    else 1
  end as max_copies,
  -- Can sit in the command zone (legendary creature, "can be your commander", or a Background).
  (c.type_line ilike '%legendary%creature%'
    or c.oracle_text ilike '%can be your commander%'
    or c.type_line ilike '%background%') as can_be_commander
from public.cards c;

revoke all on public.card_summaries from anon, authenticated;
grant select on public.card_summaries to anon, authenticated;

-- ---------- search_cards ----------
-- Ranking: exact name, then names starting with the text, then a word starting with it, then anywhere;
-- ties broken by popularity (EDHREC rank). Only Commander-legal cards (this also drops tokens and art cards).
create or replace function public.search_cards(q text, lim int default 10)
returns setof public.card_summaries
language sql stable security invoker set search_path = '' as $$
  with t as (
    select lower(trim(q)) as term,
           replace(replace(replace(lower(trim(q)), '\', '\\'), '%', '\%'), '_', '\_') as esc
  )
  select s.*
  from public.card_summaries s, t
  where length(t.term) >= 2
    and s.commander_legal
    and lower(s.name) like '%' || t.esc || '%'
  order by
    case
      when lower(s.name) = t.term                   then 0
      when lower(s.name) like t.esc || '%'          then 1
      when lower(s.name) like '% ' || t.esc || '%'  then 2
      else 3
    end,
    s.edhrec_rank nulls last,
    s.name
  limit least(greatest(lim, 1), 25);
$$;
grant execute on function public.search_cards(text, int) to anon, authenticated;

-- ---------- apply_deck_changes ----------
-- p_changes: [{"oracle_id": "...", "board": "main", "quantity": 1}, ...]; quantity 0 removes the row.
-- security invoker: row-level security on deck_cards decides whether this user may touch this deck.
-- One call = one transaction, so a move (remove from one board, add to another) can't half-happen.
create or replace function public.apply_deck_changes(p_deck uuid, p_changes jsonb)
returns void
language plpgsql security invoker set search_path = '' as $$
declare
  ch jsonb;
  qty int;
begin
  if not exists (select 1 from public.decks where id = p_deck and owner_id = (select auth.uid())) then
    raise exception 'Deck not found or not yours' using errcode = '42501';
  end if;

  for ch in select * from jsonb_array_elements(p_changes) loop
    qty := coalesce((ch->>'quantity')::int, 0);
    if qty <= 0 then
      delete from public.deck_cards
      where deck_id = p_deck and oracle_id = (ch->>'oracle_id')::uuid and board = ch->>'board';
    else
      insert into public.deck_cards (deck_id, oracle_id, board, quantity)
      values (p_deck, (ch->>'oracle_id')::uuid, ch->>'board', qty)
      on conflict (deck_id, oracle_id, board) do update set quantity = excluded.quantity;
    end if;
  end loop;
end $$;
revoke execute on function public.apply_deck_changes(uuid, jsonb) from anon, public;
grant execute on function public.apply_deck_changes(uuid, jsonb) to authenticated;
