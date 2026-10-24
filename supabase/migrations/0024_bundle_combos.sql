-- Speed: the editor bundle (p_tags true) also carries the two-card combos among the commander, companion and
-- mainboard (combos_within output), so the bracket estimate is ready when the page arrives.
-- Same function as 0023 plus the combos key.
-- Note for the migration runner: keep comments free of quote characters.

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
    select coalesce(jsonb_agg(jsonb_build_object('oracle_id', c.oracle_id, 'board', c.board, 'quantity', c.quantity, 'category', c.category)), '[]'::jsonb)
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
