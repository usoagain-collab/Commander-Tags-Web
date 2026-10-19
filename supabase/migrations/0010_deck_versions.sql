-- Phase 3h: version history. Decided with David Oct 19, 2026:
--   * automatic version at the start of each editing session (an edit when the newest version is 30+ minutes old)
--   * manual "Save version" with an optional name
--   * keep the latest 10 automatic versions per deck; manual ones stay until deleted
--   * restoring saves the current deck as a version first
-- Full snapshots (a 100-card deck is ~5 KB), so any two versions compare and restore without replaying diffs.

create table public.deck_versions (
  id         uuid primary key default gen_random_uuid(),
  deck_id    uuid not null references public.decks (id) on delete cascade,
  created_at timestamptz not null default now(),
  kind       text not null check (kind in ('auto', 'manual')),
  name       text check (name is null or char_length(btrim(name)) between 1 and 60),
  cards      jsonb not null,   -- [[oracle_id, board, quantity, category|null], ...]
  card_count int not null      -- commander + main + companion copies, for the list
);
create index deck_versions_deck_idx on public.deck_versions (deck_id, created_at desc);

alter table public.deck_versions enable row level security;
create policy "Owner reads own deck versions" on public.deck_versions for select to authenticated
  using (exists (select 1 from public.decks d where d.id = deck_id and d.owner_id = (select auth.uid())));
create policy "Owner adds deck versions" on public.deck_versions for insert to authenticated
  with check (exists (select 1 from public.decks d where d.id = deck_id and d.owner_id = (select auth.uid())));
create policy "Owner renames deck versions" on public.deck_versions for update to authenticated
  using (exists (select 1 from public.decks d where d.id = deck_id and d.owner_id = (select auth.uid())))
  with check (exists (select 1 from public.decks d where d.id = deck_id and d.owner_id = (select auth.uid())));
create policy "Owner deletes deck versions" on public.deck_versions for delete to authenticated
  using (exists (select 1 from public.decks d where d.id = deck_id and d.owner_id = (select auth.uid())));

revoke all on public.deck_versions from anon, authenticated;
grant select, insert, delete on public.deck_versions to authenticated;
grant update (name) on public.deck_versions to authenticated;

-- ---------- snapshot_deck: saves the deck as it is now ----------
-- Skips an empty deck. Afterwards keeps only the newest 10 automatic versions of this deck.
create or replace function public.snapshot_deck(p_deck uuid, p_kind text default 'manual', p_name text default null)
returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  v_id uuid;
begin
  if not exists (select 1 from public.decks where id = p_deck and owner_id = (select auth.uid())) then
    raise exception 'Deck not found or not yours' using errcode = '42501';
  end if;
  if not exists (select 1 from public.deck_cards where deck_id = p_deck) then
    return null;
  end if;

  insert into public.deck_versions (deck_id, kind, name, cards, card_count)
  select p_deck, p_kind, nullif(btrim(p_name), ''),
         jsonb_agg(jsonb_build_array(oracle_id, board, quantity, category) order by board, oracle_id),
         coalesce(sum(quantity) filter (where board <> 'maybe'), 0)
  from public.deck_cards where deck_id = p_deck
  returning id into v_id;

  delete from public.deck_versions
  where deck_id = p_deck and kind = 'auto'
    and id not in (select id from public.deck_versions where deck_id = p_deck and kind = 'auto'
                   order by created_at desc limit 10);
  return v_id;
end $$;
revoke execute on function public.snapshot_deck(uuid, text, text) from anon, public;
grant execute on function public.snapshot_deck(uuid, text, text) to authenticated;

-- ---------- apply_deck_changes: now also takes the session snapshot ----------
-- p_snapshot_name: set by a restore, which always saves the deck first under that name. Otherwise an automatic
-- version is saved when the newest version is 30+ minutes old (the start of an editing session).
drop function public.apply_deck_changes(uuid, jsonb, jsonb, jsonb);
create function public.apply_deck_changes(
  p_deck uuid, p_changes jsonb, p_categories jsonb default '[]', p_tag_cards jsonb default '[]', p_snapshot_name text default null
)
returns void
language plpgsql security invoker set search_path = '' as $$
declare
  ch jsonb;
  qty int;
begin
  if not exists (select 1 from public.decks where id = p_deck and owner_id = (select auth.uid())) then
    raise exception 'Deck not found or not yours' using errcode = '42501';
  end if;

  if p_snapshot_name is not null then
    perform public.snapshot_deck(p_deck, 'auto', p_snapshot_name);
  elsif not exists (select 1 from public.deck_versions
                    where deck_id = p_deck and created_at > now() - interval '30 minutes') then
    perform public.snapshot_deck(p_deck, 'auto', null);
  end if;

  for ch in select * from jsonb_array_elements(coalesce(p_changes, '[]')) loop
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

  for ch in select * from jsonb_array_elements(coalesce(p_categories, '[]')) loop
    update public.deck_cards set category = nullif(btrim(ch->>'category'), '')
    where deck_id = p_deck and oracle_id = (ch->>'oracle_id')::uuid and board = ch->>'board';
  end loop;

  for ch in select * from jsonb_array_elements(coalesce(p_tag_cards, '[]')) loop
    if not exists (select 1 from public.user_tags t
                   where t.id = (ch->>'tag_id')::uuid and t.owner_id = (select auth.uid())
                     and (t.deck_id is null or t.deck_id = p_deck)) then
      raise exception 'Tag not found or not usable in this deck' using errcode = '42501';
    end if;
    if coalesce((ch->>'on')::boolean, false) then
      insert into public.user_tag_cards (tag_id, oracle_id)
      values ((ch->>'tag_id')::uuid, (ch->>'oracle_id')::uuid) on conflict do nothing;
    else
      delete from public.user_tag_cards
      where tag_id = (ch->>'tag_id')::uuid and oracle_id = (ch->>'oracle_id')::uuid;
    end if;
  end loop;
end $$;
revoke execute on function public.apply_deck_changes(uuid, jsonb, jsonb, jsonb, text) from anon, public;
grant execute on function public.apply_deck_changes(uuid, jsonb, jsonb, jsonb, text) to authenticated;
