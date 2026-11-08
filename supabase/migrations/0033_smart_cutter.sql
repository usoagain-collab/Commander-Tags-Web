-- Smart Cutter, step C1 (docs/spec.md, Smart Cutter v2 design), reviewed by David Nov 7, 2026.
-- decks.cutter: per deck state (locks, dismissed cuts, archetype answers, curve overrides, head to head results).
-- profiles.cutter_prefs: per user settings (power user mode, weights, combo protection, warnings, custom archetypes).
-- card_summaries gains instant_speed (an instant, or a card with Flash), appended after commander_status from 0031,
-- since a view can only gain columns at the end. Numbered 0033 because 0031 and 0032 landed on main first.
-- deck_bundle returns both, and the deck state only to its owner.
-- Note for the migration runner: keep comments free of quote characters.

alter table public.decks add column if not exists cutter jsonb not null default '{}'::jsonb;
alter table public.profiles add column if not exists cutter_prefs jsonb not null default '{}'::jsonb;

create or replace view public.card_summaries with (security_invoker = on) as
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
  case
    when c.type_line ilike 'basic%land%'                                   then 99
    when c.oracle_text ilike '%a deck can have any number of cards named%' then 99
    when c.oracle_text ilike '%a deck can have up to seven cards named%'   then 7
    when c.oracle_text ilike '%a deck can have up to nine cards named%'    then 9
    else 1
  end as max_copies,
  (c.type_line ilike '%legendary%creature%'
    or c.oracle_text ilike '%can be your commander%'
    or c.type_line ilike '%background%') as can_be_commander,
  c.layout,
  (split_part(c.type_line, ' // ', 1) ~ '\mLand\M'
    or (c.layout = 'modal_dfc' and c.type_line ~ '\mLand\M')) as counts_as_land,
  c.produced_mana,
  public.commander_status(c) as commander_status,
  (split_part(c.type_line, ' // ', 1) ~ '\mInstant\M'
    or c.oracle_text ~ '(^|\n)Flash($|\n| \()') as instant_speed
from public.cards c;

revoke all on public.card_summaries from anon, authenticated;
grant select on public.card_summaries to anon, authenticated;

-- ---------- deck_bundle: same as 0028, plus cutter and cutter_prefs ----------
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
  v_preferred jsonb;
begin
  select jsonb_build_object(
           'id', d.id, 'cover_oracle_id', d.cover_oracle_id, 'name', d.name, 'owner_id', d.owner_id, 'visibility', d.visibility,
           'role_targets', d.role_targets, 'custom_roles', d.custom_roles, 'suggest_settings', d.suggest_settings,
           'dismissed_suggestions', d.dismissed_suggestions, 'target_bracket', d.target_bracket,
           'playtest_flags', d.playtest_flags,
           'cutter', case when d.owner_id = (select auth.uid()) then d.cutter else '{}'::jsonb end)
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
                              'custom_roles', p.custom_roles, 'hidden_tags', p.hidden_tags,
                              'cutter_prefs', p.cutter_prefs)
      into v_profile
      from public.profiles p where p.id = (select auth.uid());
  end if;

  v_preferred := public.deck_preferred_printings(p_id);

  return jsonb_build_object('deck', v_deck, 'rows', v_rows, 'cards', v_cards, 'tags', v_tags, 'combos', v_combos,
                            'tokens', v_tokens, 'profile', v_profile, 'preferred', v_preferred);
end;
$$;

notify pgrst, 'reload schema';
