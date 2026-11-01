-- Card printings and foil, per deck row (David approved, Oct 31, 2026: option A, real price of the choice).
--   printing_id    the chosen Scryfall printing; null = default printing
--   foil           only with a chosen printing; turning foil on pins the printing the card is showing
--   printing_info  copied from Scryfall at pick time: set, set_name, number, illustration_id, finishes, usd, usd_foil,
--                  usd_etched. The nightly import refreshes the three prices.
-- Clients read one value, named printing: printing_info plus id and foil, or null for the default printing.
-- Note for the migration runner: keep comments free of quote characters.

alter table public.deck_cards
  add column foil boolean not null default false,
  add column printing_info jsonb,
  add constraint deck_cards_foil_needs_printing check (not foil or printing_id is not null);

-- ---------- art tags of any illustration, for cards showing a chosen printing ----------
create or replace function public.art_tags_for_illustrations(p_ids uuid[])
returns jsonb
language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_object_agg(illustration_id, tags), '{}'::jsonb) from (
    select it.illustration_id, jsonb_agg(jsonb_build_array(t.slug, t.label, t.size) order by t.size, t.slug) as tags
    from unnest(p_ids) u(id)
    join public.illustration_tags it on it.illustration_id = u.id
    join public.tags t on t.id = it.tag_id
    group by it.illustration_id) x;
$$;
grant execute on function public.art_tags_for_illustrations(uuid[]) to anon, authenticated;

-- ---------- snapshot_deck: versions also keep each row printing, as a fifth array item ----------
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

-- ---------- apply_deck_changes: now also saves printings, in the same transaction as the edit ----------
drop function public.apply_deck_changes(uuid, jsonb, jsonb, jsonb, text);
create function public.apply_deck_changes(
  p_deck uuid, p_changes jsonb, p_categories jsonb default '[]', p_tag_cards jsonb default '[]', p_snapshot_name text default null,
  p_printings jsonb default '[]'
)
returns void
language plpgsql security invoker set search_path = '' as $$
declare
  ch jsonb;
  qty int;
  pr jsonb;
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
revoke execute on function public.apply_deck_changes(uuid, jsonb, jsonb, jsonb, text, jsonb) from anon, public;
grant execute on function public.apply_deck_changes(uuid, jsonb, jsonb, jsonb, text, jsonb) to authenticated;

-- ---------- shared_deck: rows carry the printing ----------
create or replace function public.shared_deck(p_id uuid)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'deck', jsonb_build_object(
      'id', d.id, 'name', d.name, 'owner_id', d.owner_id, 'visibility', d.visibility,
      'role_targets', d.role_targets, 'custom_roles', d.custom_roles, 'target_bracket', d.target_bracket),
    'rows', coalesce((select jsonb_agg(jsonb_build_object('oracle_id', c.oracle_id, 'board', c.board, 'quantity', c.quantity, 'category', c.category,
                        'printing', case when c.printing_id is null then null
                                         else coalesce(c.printing_info, '{}'::jsonb) || jsonb_build_object('id', c.printing_id, 'foil', c.foil) end))
                      from public.deck_cards c where c.deck_id = d.id), '[]'::jsonb))
  from public.decks d
  where d.id = p_id and (d.visibility in ('unlisted', 'public') or d.owner_id = (select auth.uid()));
$$;

-- ---------- deck_bundle: same as 0024, rows carry the printing ----------
create or replace function public.deck_bundle(p_id uuid, p_tags boolean default true, p_tokens boolean default false)
returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_deck    jsonb;
  v_rows    jsonb;
  v_shared  jsonb;
  v_ids     uuid[];
  v_play    uuid[];
  v_bracket uuid[];
  v_cards   jsonb;
  v_tags    jsonb;
  v_combos  jsonb;
  v_tokens  jsonb;
  v_profile jsonb;
begin
  select jsonb_build_object(
           'id', d.id, 'name', d.name, 'owner_id', d.owner_id, 'visibility', d.visibility,
           'role_targets', d.role_targets, 'custom_roles', d.custom_roles, 'suggest_settings', d.suggest_settings,
           'dismissed_suggestions', d.dismissed_suggestions, 'target_bracket', d.target_bracket,
           'playtest_flags', d.playtest_flags)
    into v_deck
    from public.decks d where d.id = p_id;

  if v_deck is null then
    v_shared := public.shared_deck(p_id);
    if v_shared is null then
      return null;
    end if;
    v_deck := v_shared->'deck';
    v_rows := v_shared->'rows';
  else
    select coalesce(jsonb_agg(jsonb_build_object('oracle_id', c.oracle_id, 'board', c.board, 'quantity', c.quantity, 'category', c.category,
             'printing', case when c.printing_id is null then null
                              else coalesce(c.printing_info, '{}'::jsonb) || jsonb_build_object('id', c.printing_id, 'foil', c.foil) end)), '[]'::jsonb)
      into v_rows
      from public.deck_cards c where c.deck_id = p_id;
  end if;

  select coalesce(array_agg(distinct (r->>'oracle_id')::uuid), '{}'),
         coalesce(array_agg(distinct (r->>'oracle_id')::uuid) filter (where r->>'board' in ('commander', 'main')), '{}'),
         coalesce(array_agg(distinct (r->>'oracle_id')::uuid) filter (where r->>'board' in ('commander', 'companion', 'main')), '{}')
    into v_ids, v_play, v_bracket
    from jsonb_array_elements(v_rows) r;

  select coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb) into v_cards
    from unnest(v_ids) u(id) join public.card_summaries s on s.oracle_id = u.id;

  if p_tags then
    select jsonb_build_object(
      'o', coalesce((
        select jsonb_object_agg(oracle_id, slugs) from (
          select ct.oracle_id, jsonb_agg(t.slug order by t.slug) as slugs
          from unnest(v_ids) u(id)
          join public.card_tags ct on ct.oracle_id = u.id
          join public.tags t on t.id = ct.tag_id
          group by ct.oracle_id) x), '{}'::jsonb),
      'a', coalesce((
        select jsonb_object_agg(oracle_id, tags) from (
          select c.oracle_id, jsonb_agg(jsonb_build_array(t.slug, t.label, t.size) order by t.size, t.slug) as tags
          from unnest(v_ids) u(id)
          join public.cards c on c.oracle_id = u.id
          join public.illustration_tags it on it.illustration_id = c.default_illustration_id
          join public.tags t on t.id = it.tag_id
          group by c.oracle_id) y), '{}'::jsonb))
    into v_tags;

    select coalesce(jsonb_agg(to_jsonb(c) order by c.popularity desc nulls last, c.id), '[]'::jsonb) into v_combos
      from public.combos c
      where c.card_a = any(v_bracket) and c.card_b = any(v_bracket);
  end if;

  if p_tokens then
    select coalesce(jsonb_agg(t order by t.name), '[]'::jsonb) into v_tokens from (
      select ct.token_id, min(ct.name) as name, min(ct.type_line) as type_line, jsonb_agg(distinct ct.oracle_id) as made_by
      from unnest(v_play) u(id) join public.card_tokens ct on ct.oracle_id = u.id
      group by ct.token_id) t;
  end if;

  if (select auth.uid()) is not null then
    select jsonb_build_object('tag_view', p.tag_view, 'default_role_targets', p.default_role_targets,
                              'custom_roles', p.custom_roles, 'hidden_tags', p.hidden_tags)
      into v_profile
      from public.profiles p where p.id = (select auth.uid());
  end if;

  return jsonb_build_object('deck', v_deck, 'rows', v_rows, 'cards', v_cards, 'tags', v_tags, 'combos', v_combos,
                            'tokens', v_tokens, 'profile', v_profile);
end;
$$;

notify pgrst, 'reload schema';
