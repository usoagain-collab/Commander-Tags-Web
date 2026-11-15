-- V3 Co-build (Nov 15, 2026), from David own V3 sharing ideas: a friend builds a deck with you. The owner makes
-- an invite link; a signed-in friend who opens it becomes a co-builder and can change the deck cards (add, cut,
-- move between boards, categories, printings), the same way the owner does, with the same autosave, versions and
-- change log. Everything else about the deck stays the owner own: its name, cover, sharing, roles and targets,
-- bracket, Smart Cutter, notes, game log and deleting it. Up to 5 co-builders per deck. The owner can start a new
-- link (the old one stops working), turn the link off, or take a co-builder out; a co-builder can leave.
-- Note for the migration runner: keep comments free of quote characters.

create table if not exists public.deck_cobuilders (
  deck_id  uuid not null references public.decks (id) on delete cascade,
  user_id  uuid not null references public.profiles (id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (deck_id, user_id)
);
create index if not exists deck_cobuilders_user_idx on public.deck_cobuilders (user_id, added_at desc);

-- One invite link per deck. No row means no link.
create table if not exists public.deck_cobuild_links (
  deck_id    uuid primary key references public.decks (id) on delete cascade,
  code       text not null unique default substr(replace(gen_random_uuid()::text, '-', ''), 1, 24),
  created_at timestamptz not null default now()
);

alter table public.deck_cobuilders enable row level security;
alter table public.deck_cobuild_links enable row level security;
revoke all on public.deck_cobuilders, public.deck_cobuild_links from anon, authenticated;

create or replace function public.is_deck_cobuilder(p_deck uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.deck_cobuilders c where c.deck_id = p_deck and c.user_id = (select auth.uid()));
$$;
revoke all on function public.is_deck_cobuilder(uuid) from public;
grant execute on function public.is_deck_cobuilder(uuid) to authenticated;

create or replace function public.can_edit_deck(p_deck uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.decks d where d.id = p_deck and d.owner_id = (select auth.uid()))
      or public.is_deck_cobuilder(p_deck);
$$;
revoke all on function public.can_edit_deck(uuid) from public;
grant execute on function public.can_edit_deck(uuid) to authenticated;

-- Co-builders read the deck, even a private one, and change its cards. Nothing else on decks changes for them.
drop policy if exists "Co-builders read decks" on public.decks;
create policy "Co-builders read decks" on public.decks for select to authenticated
  using (public.is_deck_cobuilder(id));
drop policy if exists "Co-builders read deck cards" on public.deck_cards;
create policy "Co-builders read deck cards" on public.deck_cards for select to authenticated
  using (public.is_deck_cobuilder(deck_id));
drop policy if exists "Co-builders add deck cards" on public.deck_cards;
create policy "Co-builders add deck cards" on public.deck_cards for insert to authenticated
  with check (public.is_deck_cobuilder(deck_id));
drop policy if exists "Co-builders update deck cards" on public.deck_cards;
create policy "Co-builders update deck cards" on public.deck_cards for update to authenticated
  using (public.is_deck_cobuilder(deck_id)) with check (public.is_deck_cobuilder(deck_id));
drop policy if exists "Co-builders remove deck cards" on public.deck_cards;
create policy "Co-builders remove deck cards" on public.deck_cards for delete to authenticated
  using (public.is_deck_cobuilder(deck_id));

-- Versions: the automatic version at the start of an editing session is taken for co-builders too, so the owner
-- can always go back. It now runs with the function owner rights, after the same check, so co-builders get no
-- direct access to deck_versions. Body as in migration 0025 apart from the check.
create or replace function public.snapshot_deck(p_deck uuid, p_kind text default 'manual', p_name text default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if not public.can_edit_deck(p_deck) then
    raise exception 'Deck not found or not yours' using errcode = '42501';
  end if;
  if not exists (select 1 from public.deck_cards where deck_id = p_deck) then
    return null;
  end if;

  insert into public.deck_versions (deck_id, kind, name, cards, card_count)
  select p_deck, p_kind, nullif(btrim(p_name), ''),
         jsonb_agg(jsonb_build_array(oracle_id, board, quantity, category,
                     case when printing_id is null then null
                          else coalesce(printing_info, '{}'::jsonb) || jsonb_build_object('id', printing_id, 'foil', foil) end)
                   order by board, oracle_id),
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

-- Saving edits: owner or co-builder. Body as in migration 0034 apart from the check. My tags stay your own.
create or replace function public.apply_deck_changes(
  p_deck uuid, p_changes jsonb, p_categories jsonb default '[]', p_tag_cards jsonb default '[]', p_snapshot_name text default null,
  p_printings jsonb default '[]', p_notes jsonb default null
)
returns void
language plpgsql security invoker set search_path = '' as $$
declare
  ch jsonb;
  qty int;
  pr jsonb;
begin
  if not public.can_edit_deck(p_deck) then
    raise exception 'Deck not found or not yours' using errcode = '42501';
  end if;

  perform set_config('deckgenome.change_notes', coalesce(p_notes::text, ''), true);

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

  for ch in select * from jsonb_array_elements(coalesce(p_printings, '[]')) loop
    pr := nullif(ch->'printing', 'null'::jsonb);
    update public.deck_cards
    set printing_id = (pr->>'id')::uuid,
        foil = coalesce((pr->>'foil')::boolean, false),
        printing_info = pr - 'id' - 'foil'
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
revoke execute on function public.apply_deck_changes(uuid, jsonb, jsonb, jsonb, text, jsonb, jsonb) from anon, public;
grant execute on function public.apply_deck_changes(uuid, jsonb, jsonb, jsonb, text, jsonb, jsonb) to authenticated;

-- Who builds a deck, for its owner and its co-builders: the owner, the co-builders, and (owner only) the link.
-- Null for anyone else.
create or replace function public.deck_cobuild(p_deck uuid)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'is_owner', d.owner_id = (select auth.uid()),
    'code', case when d.owner_id = (select auth.uid()) then (select l.code from public.deck_cobuild_links l where l.deck_id = d.id) end,
    'owner', jsonb_build_object('name', nullif(btrim(op.display_name), ''), 'avatar_url', op.avatar_url),
    'builders', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', c.user_id,
        'name', nullif(btrim(p.display_name), ''),
        'avatar_url', p.avatar_url,
        'me', c.user_id = (select auth.uid())
      ) order by c.added_at)
      from public.deck_cobuilders c join public.profiles p on p.id = c.user_id
      where c.deck_id = d.id), '[]'::jsonb)
  )
  from public.decks d join public.profiles op on op.id = d.owner_id
  where d.id = p_deck and public.can_edit_deck(d.id);
$$;
revoke all on function public.deck_cobuild(uuid) from public;
grant execute on function public.deck_cobuild(uuid) to authenticated;

-- What an invite link shows before joining.
create or replace function public.cobuild_invite(p_code text)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'deck_id', d.id,
    'deck_name', d.name,
    'owner', nullif(btrim(op.display_name), ''),
    'builders', (select count(*) from public.deck_cobuilders c where c.deck_id = d.id),
    'joined', public.can_edit_deck(d.id)
  )
  from public.deck_cobuild_links l
  join public.decks d on d.id = l.deck_id
  join public.profiles op on op.id = d.owner_id
  where l.code = p_code;
$$;
revoke all on function public.cobuild_invite(text) from public;
grant execute on function public.cobuild_invite(text) to authenticated;

create or replace function public.join_cobuild(p_code text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  v_deck uuid;
begin
  if me is null then raise exception 'Sign in to build this deck.'; end if;
  select l.deck_id into v_deck from public.deck_cobuild_links l where l.code = p_code;
  if v_deck is null then raise exception 'That invite link no longer works. Ask for a new one.'; end if;
  if public.can_edit_deck(v_deck) then return v_deck; end if;
  if (select count(*) from public.deck_cobuilders c where c.deck_id = v_deck) >= 5 then
    raise exception 'This deck already has 5 co-builders.';
  end if;
  if (select count(*) from public.deck_cobuilders c where c.user_id = me) >= 50 then
    raise exception 'You can co-build up to 50 decks.';
  end if;
  insert into public.deck_cobuilders (deck_id, user_id) values (v_deck, me);
  return v_deck;
end;
$$;
revoke all on function public.join_cobuild(text) from public;
grant execute on function public.join_cobuild(text) to authenticated;

-- Owner only: new_link (returns the new code; the old link stops working), stop_link, remove (a co-builder).
create or replace function public.manage_cobuild(p_deck uuid, p_action text, p_user uuid default null)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_code text;
begin
  if not exists (select 1 from public.decks d where d.id = p_deck and d.owner_id = (select auth.uid())) then
    raise exception 'Only the deck owner can do that.';
  end if;
  if p_action = 'new_link' then
    insert into public.deck_cobuild_links (deck_id) values (p_deck)
    on conflict (deck_id) do update
      set code = substr(replace(gen_random_uuid()::text, '-', ''), 1, 24), created_at = now()
    returning code into v_code;
    return v_code;
  elsif p_action = 'stop_link' then
    delete from public.deck_cobuild_links where deck_id = p_deck;
    return null;
  elsif p_action = 'remove' then
    delete from public.deck_cobuilders where deck_id = p_deck and user_id = p_user;
    return null;
  end if;
  raise exception 'Unknown action.';
end;
$$;
revoke all on function public.manage_cobuild(uuid, text, uuid) from public;
grant execute on function public.manage_cobuild(uuid, text, uuid) to authenticated;

create or replace function public.leave_cobuild(p_deck uuid)
returns boolean
language sql security definer set search_path = '' as $$
  with gone as (
    delete from public.deck_cobuilders c where c.deck_id = p_deck and c.user_id = (select auth.uid())
    returning c.user_id
  )
  select exists (select 1 from gone);
$$;
revoke all on function public.leave_cobuild(uuid) from public;
grant execute on function public.leave_cobuild(uuid) to authenticated;

-- Decks you build with someone else, for My decks.
create or replace function public.my_cobuild_decks()
returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', d.id,
    'name', d.name,
    'owner', nullif(btrim(op.display_name), ''),
    'updated_at', d.updated_at
  ) order by d.updated_at desc), '[]'::jsonb)
  from public.deck_cobuilders c
  join public.decks d on d.id = c.deck_id
  join public.profiles op on op.id = d.owner_id
  where c.user_id = (select auth.uid());
$$;
revoke all on function public.my_cobuild_decks() from public;
grant execute on function public.my_cobuild_decks() to authenticated;

notify pgrst, 'reload schema';
