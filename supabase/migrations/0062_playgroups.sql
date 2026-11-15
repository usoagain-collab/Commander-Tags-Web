-- V3 Playgroups (Nov 15, 2026). Friends who play together make a playgroup, join it with an invite link, and log
-- the games they play: who sat down, with which deck, and who won. The playgroup page shows standings per player
-- and per deck. Players who have no account can be added to a game by name.
-- Everything is read and written through the functions below, so the tables have no direct grants: members see
-- only their own playgroups, and display names come from here, never from the private profiles table.
-- Note for the migration runner: keep comments free of quote characters.

create table if not exists public.playgroups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(btrim(name)) between 1 and 60),
  owner_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  invite_code text not null unique default substr(replace(gen_random_uuid()::text, '-', ''), 1, 16),
  created_at  timestamptz not null default now()
);

create table if not exists public.playgroup_members (
  group_id  uuid not null references public.playgroups (id) on delete cascade,
  user_id   uuid not null references public.profiles (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
create index if not exists playgroup_members_user_idx on public.playgroup_members (user_id);

create table if not exists public.playgroup_games (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references public.playgroups (id) on delete cascade,
  played_on  date not null default current_date,
  note       text check (char_length(note) <= 500),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists playgroup_games_group_idx on public.playgroup_games (group_id, played_on desc, created_at desc);

create table if not exists public.playgroup_game_players (
  game_id    uuid not null references public.playgroup_games (id) on delete cascade,
  seat       smallint not null check (seat between 1 and 8),
  user_id    uuid references public.profiles (id) on delete set null,
  guest_name text check (char_length(btrim(guest_name)) between 1 and 40),
  deck_id    uuid references public.decks (id) on delete set null,
  deck_name  text check (char_length(deck_name) <= 120),
  won        boolean not null default false,
  primary key (game_id, seat)
);

alter table public.playgroups enable row level security;
alter table public.playgroup_members enable row level security;
alter table public.playgroup_games enable row level security;
alter table public.playgroup_game_players enable row level security;
revoke all on public.playgroups, public.playgroup_members, public.playgroup_games, public.playgroup_game_players from anon, authenticated;

create or replace function public.is_playgroup_member(p_group uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.playgroup_members m where m.group_id = p_group and m.user_id = (select auth.uid()));
$$;
revoke all on function public.is_playgroup_member(uuid) from public;

-- Your playgroups, newest game first.
create or replace function public.my_playgroups()
returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', g.id,
    'name', g.name,
    'is_owner', g.owner_id = (select auth.uid()),
    'members', (select count(*) from public.playgroup_members m where m.group_id = g.id),
    'games', (select count(*) from public.playgroup_games x where x.group_id = g.id),
    'last_played', (select max(x.played_on) from public.playgroup_games x where x.group_id = g.id)
  ) order by (select max(x.played_on) from public.playgroup_games x where x.group_id = g.id) desc nulls last, g.created_at desc), '[]'::jsonb)
  from public.playgroups g
  join public.playgroup_members me on me.group_id = g.id and me.user_id = (select auth.uid());
$$;
revoke all on function public.my_playgroups() from public;
grant execute on function public.my_playgroups() to authenticated;

-- One playgroup with its members and its latest 300 games, or null when you are not in it.
create or replace function public.playgroup_view(p_id uuid)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', g.id,
    'name', g.name,
    'is_owner', g.owner_id = (select auth.uid()),
    'invite_code', g.invite_code,
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', m.user_id,
        'name', nullif(btrim(p.display_name), ''),
        'avatar_url', p.avatar_url,
        'me', m.user_id = (select auth.uid()),
        'owner', m.user_id = g.owner_id
      ) order by m.joined_at)
      from public.playgroup_members m join public.profiles p on p.id = m.user_id
      where m.group_id = g.id), '[]'::jsonb),
    'games', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', x.id,
        'played_on', x.played_on,
        'note', x.note,
        'mine', x.created_by = (select auth.uid()),
        'players', coalesce((
          select jsonb_agg(jsonb_build_object(
            'user_id', gp.user_id,
            'guest_name', gp.guest_name,
            'name', coalesce(nullif(btrim(pp.display_name), ''), gp.guest_name),
            'deck_id', gp.deck_id,
            'deck_name', gp.deck_name,
            'won', gp.won
          ) order by gp.seat)
          from public.playgroup_game_players gp left join public.profiles pp on pp.id = gp.user_id
          where gp.game_id = x.id), '[]'::jsonb)
      ) order by x.played_on desc, x.created_at desc)
      from (select * from public.playgroup_games y where y.group_id = g.id order by y.played_on desc, y.created_at desc limit 300) x), '[]'::jsonb)
  )
  from public.playgroups g
  where g.id = p_id and public.is_playgroup_member(g.id);
$$;
revoke all on function public.playgroup_view(uuid) from public;
grant execute on function public.playgroup_view(uuid) to authenticated;

-- What an invite link shows before joining: the name and how many are in it.
create or replace function public.playgroup_invite(p_code text)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', g.id,
    'name', g.name,
    'members', (select count(*) from public.playgroup_members m where m.group_id = g.id),
    'joined', public.is_playgroup_member(g.id)
  )
  from public.playgroups g where g.invite_code = p_code;
$$;
revoke all on function public.playgroup_invite(text) from public;
grant execute on function public.playgroup_invite(text) to authenticated;

create or replace function public.create_playgroup(p_name text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  v_name text := btrim(coalesce(p_name, ''));
  new_id uuid;
begin
  if me is null then raise exception 'Sign in to make a playgroup.'; end if;
  if char_length(v_name) = 0 then raise exception 'Give the playgroup a name.'; end if;
  if char_length(v_name) > 60 then raise exception 'Playgroup names can be up to 60 characters.'; end if;
  if (select count(*) from public.playgroups g where g.owner_id = me) >= 20 then
    raise exception 'You can make up to 20 playgroups.';
  end if;
  insert into public.playgroups (name, owner_id) values (v_name, me) returning id into new_id;
  insert into public.playgroup_members (group_id, user_id) values (new_id, me);
  return new_id;
end;
$$;
revoke all on function public.create_playgroup(text) from public;
grant execute on function public.create_playgroup(text) to authenticated;

create or replace function public.join_playgroup(p_code text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  gid uuid;
begin
  if me is null then raise exception 'Sign in to join a playgroup.'; end if;
  select g.id into gid from public.playgroups g where g.invite_code = p_code;
  if gid is null then raise exception 'That invite link no longer works. Ask for a new one.'; end if;
  if public.is_playgroup_member(gid) then return gid; end if;
  if (select count(*) from public.playgroup_members m where m.group_id = gid) >= 30 then
    raise exception 'That playgroup is full (30 players).';
  end if;
  insert into public.playgroup_members (group_id, user_id) values (gid, me);
  return gid;
end;
$$;
revoke all on function public.join_playgroup(text) from public;
grant execute on function public.join_playgroup(text) to authenticated;

-- Leave a playgroup. Its owner cannot leave; they delete it instead. Games you played in stay, under your name.
create or replace function public.leave_playgroup(p_id uuid)
returns boolean
language sql security definer set search_path = '' as $$
  with gone as (
    delete from public.playgroup_members m
    using public.playgroups g
    where m.group_id = p_id and m.user_id = (select auth.uid()) and g.id = m.group_id and g.owner_id <> m.user_id
    returning m.user_id
  )
  select exists (select 1 from gone);
$$;
revoke all on function public.leave_playgroup(uuid) from public;
grant execute on function public.leave_playgroup(uuid) to authenticated;

-- Owner only: rename, take someone out, start a new invite link (the old one stops working), delete it.
create or replace function public.manage_playgroup(p_id uuid, p_action text, p_value text default null)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  v text := btrim(coalesce(p_value, ''));
  code text;
begin
  if not exists (select 1 from public.playgroups g where g.id = p_id and g.owner_id = me) then
    raise exception 'Only the person who made the playgroup can do that.';
  end if;
  if p_action = 'rename' then
    if char_length(v) not between 1 and 60 then raise exception 'Playgroup names can be 1 to 60 characters.'; end if;
    update public.playgroups set name = v where id = p_id;
    return v;
  elsif p_action = 'remove' then
    if v = me::text then raise exception 'You made this playgroup, so you can not take yourself out.'; end if;
    delete from public.playgroup_members m where m.group_id = p_id and m.user_id::text = v;
    return v;
  elsif p_action = 'new_invite' then
    code := substr(replace(gen_random_uuid()::text, '-', ''), 1, 16);
    update public.playgroups set invite_code = code where id = p_id;
    return code;
  elsif p_action = 'delete' then
    delete from public.playgroups where id = p_id;
    return 'deleted';
  end if;
  raise exception 'Unknown action.';
end;
$$;
revoke all on function public.manage_playgroup(uuid, text, text) from public;
grant execute on function public.manage_playgroup(uuid, text, text) to authenticated;

-- Log a game. p_players is a list of seats: each has a user_id of a member or a guest_name, an optional deck_id
-- (only that player own deck) and deck_name, and won. Two to eight players.
create or replace function public.log_playgroup_game(p_group uuid, p_played_on date, p_note text, p_players jsonb)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  n int := jsonb_array_length(coalesce(p_players, '[]'::jsonb));
  pl jsonb;
  i int := 0;
  uid uuid;
  guest text;
  did uuid;
  dname text;
  new_id uuid;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not public.is_playgroup_member(p_group) then raise exception 'You are not in that playgroup.'; end if;
  if n < 2 or n > 8 then raise exception 'A game has 2 to 8 players.'; end if;
  if char_length(v_note) > 500 then raise exception 'The note can be up to 500 characters.'; end if;
  if (select count(*) from public.playgroup_games x where x.created_by = me and x.created_at > now() - interval '10 minutes') >= 20 then
    raise exception 'That is a lot of games at once. Try again in a few minutes.';
  end if;
  insert into public.playgroup_games (group_id, played_on, note, created_by)
  values (p_group, least(coalesce(p_played_on, current_date), current_date + 1), v_note, me)
  returning id into new_id;
  for pl in select * from jsonb_array_elements(p_players) loop
    i := i + 1;
    uid := nullif(pl->>'user_id', '')::uuid;
    guest := nullif(btrim(coalesce(pl->>'guest_name', '')), '');
    did := nullif(pl->>'deck_id', '')::uuid;
    dname := nullif(btrim(coalesce(pl->>'deck_name', '')), '');
    if uid is not null then
      guest := null;
      if not exists (select 1 from public.playgroup_members m where m.group_id = p_group and m.user_id = uid) then
        raise exception 'Every player with an account must be in the playgroup.';
      end if;
    elsif guest is null then
      raise exception 'Pick a player or type a name for every seat.';
    end if;
    if did is not null and not exists (select 1 from public.decks d where d.id = did and d.owner_id = uid) then
      did := null;
    end if;
    if did is not null and dname is null then
      select d.name into dname from public.decks d where d.id = did;
    end if;
    insert into public.playgroup_game_players (game_id, seat, user_id, guest_name, deck_id, deck_name, won)
    values (new_id, i, uid, left(guest, 40), did, left(dname, 120), coalesce((pl->>'won')::boolean, false));
  end loop;
  if (select count(*) from public.playgroup_game_players gp where gp.game_id = new_id and gp.user_id is not null) <>
     (select count(distinct gp.user_id) from public.playgroup_game_players gp where gp.game_id = new_id and gp.user_id is not null) then
    raise exception 'A player can only sit once in a game.';
  end if;
  return new_id;
end;
$$;
revoke all on function public.log_playgroup_game(uuid, date, text, jsonb) from public;
grant execute on function public.log_playgroup_game(uuid, date, text, jsonb) to authenticated;

-- Delete a game: whoever logged it, or the playgroup owner.
create or replace function public.delete_playgroup_game(p_id uuid)
returns boolean
language sql security definer set search_path = '' as $$
  with gone as (
    delete from public.playgroup_games x
    using public.playgroups g
    where x.id = p_id and g.id = x.group_id
      and (x.created_by = (select auth.uid()) or g.owner_id = (select auth.uid()))
      and public.is_playgroup_member(g.id)
    returning x.id
  )
  select exists (select 1 from gone);
$$;
revoke all on function public.delete_playgroup_game(uuid) from public;
grant execute on function public.delete_playgroup_game(uuid) to authenticated;

notify pgrst, 'reload schema';
