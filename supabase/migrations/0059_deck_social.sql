-- V3 Deck descriptions, comments and likes (Nov 15, 2026).
-- A deck can carry a short description written by its owner (decks.description already exists, unused until now).
-- Anyone signed in who can open a deck shared by link or made public can like it and comment on it, unless the
-- owner turns comments off. The owner can delete any comment on the deck; an author can delete their own.
-- Comments and likes are read and written only through the functions below, because the policies on decks hide
-- other people unlisted decks from a plain select.
-- Note for the migration runner: keep comments free of quote characters.

alter table public.decks add column if not exists comments_open boolean not null default true;
alter table public.decks drop constraint if exists decks_description_length;
alter table public.decks add constraint decks_description_length
  check (description is null or char_length(description) <= 1000) not valid;

create table if not exists public.deck_comments (
  id         uuid primary key default gen_random_uuid(),
  deck_id    uuid not null references public.decks (id) on delete cascade,
  author_id  uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  body       text not null check (char_length(btrim(body)) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index if not exists deck_comments_deck_idx on public.deck_comments (deck_id, created_at);
create index if not exists deck_comments_author_idx on public.deck_comments (author_id, created_at desc);

create table if not exists public.deck_likes (
  deck_id    uuid not null references public.decks (id) on delete cascade,
  user_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (deck_id, user_id)
);
create index if not exists deck_likes_user_idx on public.deck_likes (user_id);

-- No direct access: everything goes through the functions below.
alter table public.deck_comments enable row level security;
alter table public.deck_likes enable row level security;
revoke all on public.deck_comments from anon, authenticated;
revoke all on public.deck_likes from anon, authenticated;

-- Whether the caller may see this deck: shared by link, public, or their own.
create or replace function public.deck_viewable(p_id uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.decks d
    where d.id = p_id and (d.visibility in ('unlisted', 'public') or d.owner_id = (select auth.uid()))
  );
$$;
revoke all on function public.deck_viewable(uuid) from public;

-- Description, likes and comments for one deck, or null when the caller may not see it.
create or replace function public.deck_social(p_id uuid)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'description', d.description,
    'comments_open', d.comments_open,
    'likes', (select count(*) from public.deck_likes l where l.deck_id = d.id),
    'liked', exists (select 1 from public.deck_likes l where l.deck_id = d.id and l.user_id = (select auth.uid())),
    'comments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id,
        'body', c.body,
        'created_at', c.created_at,
        'author', nullif(btrim(p.display_name), ''),
        'avatar_url', p.avatar_url,
        'is_owner', c.author_id = d.owner_id,
        'mine', c.author_id = (select auth.uid()),
        'can_delete', c.author_id = (select auth.uid()) or d.owner_id = (select auth.uid())
      ) order by c.created_at)
      from (select * from public.deck_comments x where x.deck_id = d.id order by x.created_at desc limit 200) c
      join public.profiles p on p.id = c.author_id), '[]'::jsonb)
  )
  from public.decks d
  where d.id = p_id and (d.visibility in ('unlisted', 'public') or d.owner_id = (select auth.uid()));
$$;
revoke all on function public.deck_social(uuid) from public;
grant execute on function public.deck_social(uuid) to anon, authenticated;

-- Add a comment. Comments must be open, the deck must be viewable, and one person can post about ten comments
-- in ten minutes across all decks.
create or replace function public.add_deck_comment(p_deck uuid, p_body text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  v_body text := btrim(regexp_replace(coalesce(p_body, ''), '[\x01-\x09\x0B-\x1F\x7F]', '', 'g'));
  new_id uuid;
begin
  if me is null then raise exception 'Sign in to comment.'; end if;
  if char_length(v_body) = 0 then raise exception 'Write something first.'; end if;
  if char_length(v_body) > 1000 then raise exception 'Comments can be up to 1000 characters.'; end if;
  if not public.deck_viewable(p_deck) then raise exception 'That deck is not shared.'; end if;
  if not exists (select 1 from public.decks d where d.id = p_deck and (d.comments_open or d.owner_id = me)) then
    raise exception 'Comments are off for this deck.';
  end if;
  if (select count(*) from public.deck_comments c where c.author_id = me and c.created_at > now() - interval '10 minutes') >= 10 then
    raise exception 'That is a lot of comments at once. Try again in a few minutes.';
  end if;
  insert into public.deck_comments (deck_id, author_id, body) values (p_deck, me, v_body) returning id into new_id;
  return new_id;
end;
$$;
revoke all on function public.add_deck_comment(uuid, text) from public;
grant execute on function public.add_deck_comment(uuid, text) to authenticated;

-- Delete a comment: its author or the deck owner.
create or replace function public.delete_deck_comment(p_id uuid)
returns boolean
language sql security definer set search_path = '' as $$
  with gone as (
    delete from public.deck_comments c
    using public.decks d
    where c.id = p_id and d.id = c.deck_id
      and (c.author_id = (select auth.uid()) or d.owner_id = (select auth.uid()))
    returning c.id
  )
  select exists (select 1 from gone);
$$;
revoke all on function public.delete_deck_comment(uuid) from public;
grant execute on function public.delete_deck_comment(uuid) to authenticated;

-- Like or unlike a deck you can see. Your own deck cannot be liked. Returns the new like count.
create or replace function public.set_deck_like(p_deck uuid, p_on boolean)
returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
begin
  if me is null then raise exception 'Sign in to like decks.'; end if;
  if not public.deck_viewable(p_deck) then raise exception 'That deck is not shared.'; end if;
  if exists (select 1 from public.decks d where d.id = p_deck and d.owner_id = me) then
    raise exception 'You can not like your own deck.';
  end if;
  if p_on then
    insert into public.deck_likes (deck_id, user_id) values (p_deck, me) on conflict do nothing;
  else
    delete from public.deck_likes l where l.deck_id = p_deck and l.user_id = me;
  end if;
  return (select count(*) from public.deck_likes l where l.deck_id = p_deck);
end;
$$;
revoke all on function public.set_deck_like(uuid, boolean) from public;
grant execute on function public.set_deck_like(uuid, boolean) to authenticated;

notify pgrst, 'reload schema';
