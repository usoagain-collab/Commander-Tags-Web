-- Phase 3f: My tags (your own labels on cards) and the manual category override.
-- Decided with David Oct 19, 2026: two tables; the scope lives on the tag (deck_id empty = account-wide, so an
-- account-wide tag's cards carry it into every deck); an override moves the card AND recounts its role.

-- ---------- user_tags: the labels themselves ----------
create table public.user_tags (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  deck_id    uuid references public.decks (id) on delete cascade,   -- null = account-wide; set = this deck only
  name       text not null check (char_length(btrim(name)) between 1 and 40),
  color      text not null default 'slate'
             check (color in ('slate', 'red', 'orange', 'amber', 'green', 'teal', 'blue', 'violet', 'pink')),
  created_at timestamptz not null default now()
);
-- One name per scope (case-insensitive): account-wide names are unique per user, deck names per deck.
create unique index user_tags_account_name_uq on public.user_tags (owner_id, lower(btrim(name))) where deck_id is null;
create unique index user_tags_deck_name_uq    on public.user_tags (deck_id,  lower(btrim(name))) where deck_id is not null;
create index user_tags_owner_idx on public.user_tags (owner_id);

-- ---------- user_tag_cards: which cards carry each tag ----------
create table public.user_tag_cards (
  tag_id    uuid not null references public.user_tags (id) on delete cascade,
  oracle_id uuid not null references public.cards (oracle_id),
  added_at  timestamptz not null default now(),
  primary key (tag_id, oracle_id)
);
create index user_tag_cards_oracle_idx on public.user_tag_cards (oracle_id);

-- ---------- row-level security: private to the owner ----------
-- (Whether shared decks show their deck tags is decided in Phase 7, with share links.)
alter table public.user_tags enable row level security;
create policy "Owner reads own tags" on public.user_tags for select to authenticated
  using (owner_id = (select auth.uid()));
create policy "Owner adds tags" on public.user_tags for insert to authenticated
  with check (owner_id = (select auth.uid())
              and (deck_id is null or exists (select 1 from public.decks d where d.id = deck_id and d.owner_id = (select auth.uid()))));
create policy "Owner updates own tags" on public.user_tags for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid())
              and (deck_id is null or exists (select 1 from public.decks d where d.id = deck_id and d.owner_id = (select auth.uid()))));
create policy "Owner deletes own tags" on public.user_tags for delete to authenticated
  using (owner_id = (select auth.uid()));

alter table public.user_tag_cards enable row level security;
create policy "Owner reads own tag cards" on public.user_tag_cards for select to authenticated
  using (exists (select 1 from public.user_tags t where t.id = tag_id and t.owner_id = (select auth.uid())));
create policy "Owner adds tag cards" on public.user_tag_cards for insert to authenticated
  with check (exists (select 1 from public.user_tags t where t.id = tag_id and t.owner_id = (select auth.uid())));
create policy "Owner removes tag cards" on public.user_tag_cards for delete to authenticated
  using (exists (select 1 from public.user_tags t where t.id = tag_id and t.owner_id = (select auth.uid())));

revoke all on public.user_tags, public.user_tag_cards from anon, authenticated;
grant select, insert, update, delete on public.user_tags      to authenticated;
grant select, insert, delete         on public.user_tag_cards to authenticated;

-- ---------- my_tags_for(deck): what the editor loads ----------
-- {"tags": [{"id", "name", "color", "deck_id"}...], "cards": {"<oracle_id>": ["<tag id>", ...]}}
-- Every account-wide tag plus this deck's own tags, and ALL their cards (not just this deck's), so a card
-- added later shows its account-wide tags straight away. One JSON value: no row cap, no ids in the URL.
create or replace function public.my_tags_for(p_deck uuid)
returns jsonb
language sql stable security invoker set search_path = '' as $$
  with t as (
    select id, name, color, deck_id from public.user_tags
    where owner_id = (select auth.uid()) and (deck_id is null or deck_id = p_deck)
  ),
  c as (
    select tc.oracle_id, jsonb_agg(tc.tag_id order by tc.added_at) as ids
    from public.user_tag_cards tc join t on t.id = tc.tag_id
    group by tc.oracle_id
  )
  select jsonb_build_object(
    'tags',  coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'color', color, 'deck_id', deck_id)
                                        order by lower(name)) from t), '[]'::jsonb),
    'cards', coalesce((select jsonb_object_agg(oracle_id, ids) from c), '{}'::jsonb)
  );
$$;
revoke execute on function public.my_tags_for(uuid) from anon, public;
grant execute on function public.my_tags_for(uuid) to authenticated;

-- ---------- apply_deck_changes: one edit can now also set categories and My tags ----------
-- Same call autosave already makes, with two optional lists, all in one transaction (so one Ctrl+Z = one save):
--   p_categories: [{"oracle_id", "board", "category"}]  category null = back to automatic
--   p_tag_cards:  [{"tag_id", "oracle_id", "on": true|false}]
drop function public.apply_deck_changes(uuid, jsonb);
create function public.apply_deck_changes(p_deck uuid, p_changes jsonb, p_categories jsonb default '[]', p_tag_cards jsonb default '[]')
returns void
language plpgsql security invoker set search_path = '' as $$
declare
  ch jsonb;
  qty int;
begin
  if not exists (select 1 from public.decks where id = p_deck and owner_id = (select auth.uid())) then
    raise exception 'Deck not found or not yours' using errcode = '42501';
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
    -- The tag must be yours (RLS checks that too) and either account-wide or this deck's own.
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
revoke execute on function public.apply_deck_changes(uuid, jsonb, jsonb, jsonb) from anon, public;
grant execute on function public.apply_deck_changes(uuid, jsonb, jsonb, jsonb) to authenticated;
