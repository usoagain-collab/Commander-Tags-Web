-- v2 Card language: images in your chosen language where that printing exists in it. Scryfall keeps each
-- language as its own printing, and all of them would not fit the free database, so a printing is looked up
-- the first time someone needs it (route /api/localized) and the answer is kept here for everyone.
-- localized_id null = Scryfall has no printing of it in that language. Written only by the server route.
-- Note for the migration runner: keep comments free of quote characters.

create table if not exists public.localized_printings (
  printing_id  uuid not null,
  lang         text not null check (lang in ('ja', 'de', 'fr', 'es', 'it')),
  localized_id uuid,
  image_v      text,
  checked_at   timestamptz not null default now(),
  primary key (printing_id, lang)
);

alter table public.localized_printings enable row level security;
drop policy if exists "Anyone reads localized printings" on public.localized_printings;
create policy "Anyone reads localized printings" on public.localized_printings for select to anon, authenticated using (true);
revoke all on public.localized_printings from anon, authenticated;
grant select on public.localized_printings to anon, authenticated;

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
        select jsonb_agg(jsonb_build_object('name', c.name, 'printing_id', dc.printing_id, 'image_v', dc.printing_info->>'image_v', 'art', c.image_uris->>'art_crop') order by c.name)
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

notify pgrst, 'reload schema';
