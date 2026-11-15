-- V3 Suggest changes (Nov 15, 2026), from David own V3 sharing ideas. Someone signed in who can open a deck shared
-- by link or made public can suggest cards to add and cards to cut, with a note. The deck owner sees the open
-- suggestions and applies them (the app makes the deck changes, so they can be undone like any edit), sends the
-- adds to the maybeboard, or dismisses them. The author sees their own suggestions and what became of them.
-- Read and written only through the functions below, because the decks policies hide other people unlisted decks.
-- Note for the migration runner: keep comments free of quote characters.

create table if not exists public.deck_suggestions (
  id         uuid primary key default gen_random_uuid(),
  deck_id    uuid not null references public.decks (id) on delete cascade,
  author_id  uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  adds       uuid[] not null default '{}' check (cardinality(adds) <= 30),
  cuts       uuid[] not null default '{}' check (cardinality(cuts) <= 30),
  note       text check (char_length(note) <= 500),
  status     text not null default 'open' check (status in ('open', 'applied', 'maybe', 'dismissed')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  check (cardinality(adds) + cardinality(cuts) > 0)
);
create index if not exists deck_suggestions_deck_idx on public.deck_suggestions (deck_id, created_at desc);
create index if not exists deck_suggestions_author_idx on public.deck_suggestions (author_id, created_at desc);

alter table public.deck_suggestions enable row level security;
revoke all on public.deck_suggestions from anon, authenticated;

-- Suggestions on one deck: every one for its owner (open first), only your own for anyone else.
create or replace function public.deck_suggestions_for(p_deck uuid)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', s.id,
    'adds', to_jsonb(s.adds),
    'cuts', to_jsonb(s.cuts),
    'note', s.note,
    'status', s.status,
    'created_at', s.created_at,
    'author', nullif(btrim(p.display_name), ''),
    'avatar_url', p.avatar_url,
    'mine', s.author_id = (select auth.uid())
  ) order by (s.status = 'open') desc, s.created_at desc), '[]'::jsonb)
  from (
    select x.* from public.deck_suggestions x
    join public.decks d on d.id = x.deck_id
    where x.deck_id = p_deck
      and (d.owner_id = (select auth.uid()) or x.author_id = (select auth.uid()))
    order by (x.status = 'open') desc, x.created_at desc
    limit 100
  ) s
  join public.profiles p on p.id = s.author_id;
$$;
revoke all on function public.deck_suggestions_for(uuid) from public;
grant execute on function public.deck_suggestions_for(uuid) to authenticated;

-- Suggest changes to a deck you can open but do not own. About five suggestions per person per hour.
create or replace function public.suggest_deck_changes(p_deck uuid, p_adds uuid[], p_cuts uuid[], p_note text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  v_adds uuid[] := coalesce((select array_agg(distinct a) from unnest(coalesce(p_adds, '{}')) a
                             where exists (select 1 from public.cards c where c.oracle_id = a)), '{}');
  v_cuts uuid[] := coalesce((select array_agg(distinct a) from unnest(coalesce(p_cuts, '{}')) a
                             where exists (select 1 from public.deck_cards dc where dc.deck_id = p_deck and dc.oracle_id = a)), '{}');
  v_note text := nullif(btrim(regexp_replace(coalesce(p_note, ''), '[\x01-\x09\x0B-\x1F\x7F]', '', 'g')), '');
  new_id uuid;
begin
  if me is null then raise exception 'Sign in to suggest changes.'; end if;
  if not exists (select 1 from public.decks d where d.id = p_deck and d.visibility in ('unlisted', 'public')) then
    raise exception 'That deck is not shared.';
  end if;
  if exists (select 1 from public.decks d where d.id = p_deck and d.owner_id = me) then
    raise exception 'This is your own deck. Edit it directly.';
  end if;
  if cardinality(v_adds) + cardinality(v_cuts) = 0 then raise exception 'Pick at least one card to add or cut.'; end if;
  if cardinality(v_adds) > 30 or cardinality(v_cuts) > 30 then raise exception 'Suggest up to 30 adds and 30 cuts at a time.'; end if;
  if char_length(v_note) > 500 then raise exception 'The note can be up to 500 characters.'; end if;
  if (select count(*) from public.deck_suggestions s where s.author_id = me and s.created_at > now() - interval '1 hour') >= 5 then
    raise exception 'That is a lot of suggestions at once. Try again later.';
  end if;
  insert into public.deck_suggestions (deck_id, author_id, adds, cuts, note)
  values (p_deck, me, v_adds, v_cuts, v_note) returning id into new_id;
  return new_id;
end;
$$;
revoke all on function public.suggest_deck_changes(uuid, uuid[], uuid[], text) from public;
grant execute on function public.suggest_deck_changes(uuid, uuid[], uuid[], text) to authenticated;

-- The deck owner records what they did with a suggestion. The author may withdraw (delete) an open one.
create or replace function public.decide_deck_suggestion(p_id uuid, p_status text)
returns boolean
language sql security definer set search_path = '' as $$
  with done as (
    update public.deck_suggestions s set status = p_status, decided_at = now()
    from public.decks d
    where s.id = p_id and d.id = s.deck_id and d.owner_id = (select auth.uid())
      and p_status in ('applied', 'maybe', 'dismissed')
    returning s.id
  )
  select exists (select 1 from done);
$$;
revoke all on function public.decide_deck_suggestion(uuid, text) from public;
grant execute on function public.decide_deck_suggestion(uuid, text) to authenticated;

create or replace function public.withdraw_deck_suggestion(p_id uuid)
returns boolean
language sql security definer set search_path = '' as $$
  with gone as (
    delete from public.deck_suggestions s
    where s.id = p_id and s.author_id = (select auth.uid()) and s.status = 'open'
    returning s.id
  )
  select exists (select 1 from gone);
$$;
revoke all on function public.withdraw_deck_suggestion(uuid) from public;
grant execute on function public.withdraw_deck_suggestion(uuid) to authenticated;

notify pgrst, 'reload schema';
