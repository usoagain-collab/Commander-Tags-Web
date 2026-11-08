-- v2 Precons: every Commander precon from MTGJSON as a real public deck owned by the Deck Genome Precons
-- account, so the deck page, playtester, stats, Copy to my decks and collection marks all work on them.
-- decks.precon holds file (MTGJSON fileName, unique), code, set_name, release, type, source, collector, hash.
-- Note for the migration runner: keep comments free of quote characters.

alter table public.decks add column if not exists precon jsonb;
create unique index if not exists decks_precon_file on public.decks ((precon->>'file')) where precon is not null;

alter table public.import_runs drop constraint if exists import_runs_source_check;
alter table public.import_runs add constraint import_runs_source_check check (source in ('scryfall', 'combos', 'precons'));

-- The builder line now also says when a deck is a precon.
create or replace function public.deck_builder(p_id uuid)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('name', nullif(btrim(p.display_name), ''), 'avatar_url', p.avatar_url, 'precon', d.precon - 'hash')
  from public.decks d
  join public.profiles p on p.id = d.owner_id
  where d.id = p_id and (d.visibility in ('unlisted', 'public') or d.owner_id = (select auth.uid()));
$$;

-- Every precon for the Precons page, newest first: commanders with their printing, colors, card count and price.
create or replace function public.precon_list()
returns jsonb
language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(x order by x->'precon'->>'release' desc nulls last, x->>'name'), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'id', d.id,
      'name', d.name,
      'precon', d.precon - 'hash',
      'commanders', coalesce((
        select jsonb_agg(jsonb_build_object('name', c.name, 'printing_id', dc.printing_id, 'art', c.image_uris->>'art_crop') order by c.name)
        from public.deck_cards dc join public.cards c on c.oracle_id = dc.oracle_id
        where dc.deck_id = d.id and dc.board = 'commander'), '[]'::jsonb),
      'identity', coalesce((
        select jsonb_agg(distinct ci)
        from public.deck_cards dc join public.cards c on c.oracle_id = dc.oracle_id, unnest(c.color_identity) ci
        where dc.deck_id = d.id and dc.board = 'commander'), '[]'::jsonb),
      'size', (select coalesce(sum(quantity), 0) from public.deck_cards dc where dc.deck_id = d.id and dc.board in ('commander', 'main')),
      'price', (
        select round(coalesce(sum(dc.quantity * coalesce(
          case when dc.foil then coalesce((dc.printing_info->>'usd_foil')::numeric, (dc.printing_info->>'usd_etched')::numeric) else (dc.printing_info->>'usd')::numeric end,
          c.price_usd, 0)), 0), 2)
        from public.deck_cards dc join public.cards c on c.oracle_id = dc.oracle_id
        where dc.deck_id = d.id and dc.board in ('commander', 'main'))
    ) as x
    from public.decks d
    where d.precon is not null and d.visibility = 'public'
  ) s;
$$;

revoke all on function public.precon_list() from public;
grant execute on function public.precon_list() to anon, authenticated;

notify pgrst, 'reload schema';
