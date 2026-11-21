-- Security tidy-up (Nov 20, 2026), from the site audit.
-- 1. Size and count limits on what signed-in users can store, so one account cannot fill the free 500 MB database
--    and put the whole site into read-only mode. Limits sit far above real use on Nov 20, 2026: biggest deck row
--    2 KB, biggest card row 2 KB, biggest saved version 16 KB, most decks per person 17, most card rows per deck 118,
--    biggest collection 1,511 rows.
--    Checks run only for requests that carry a signed-in user (auth.uid() set). The nightly imports (direct
--    connection) and server routes using the service key have none, so they are never limited.
--    Counts run once per statement on the rows it added, so upserts that only change a row never count twice.
-- 2. Profile pictures only from our own storage, Scryfall, Discord or Google, so a picture cannot point at a
--    stranger server that logs the address of everyone who views a shared deck.
-- 3. Tidy: no write grants for API roles on deck_price_history, none on the retired collection table, and a fixed
--    search_path for set_updated_at.

-- ---------- 1. limits ----------

create or replace function public.limit_row_size()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  lim int := tg_argv[0]::int;
  sz int;
begin
  if (select auth.uid()) is null then return new; end if;
  sz := pg_column_size(new);
  if sz > lim then
    raise exception 'That is too much to save at once (% KB; the limit is % KB).', ceil(sz / 1024.0), lim / 1024
      using errcode = '54000';
  end if;
  return new;
end $$;

-- Arguments: the column the rows belong to, the most rows per value of it, and a label for the message.
create or replace function public.limit_row_count()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  col text := tg_argv[0];
  lim int := tg_argv[1]::int;
  label text := tg_argv[2];
  over text;
begin
  if (select auth.uid()) is null then return null; end if;
  execute format(
    'select a.v::text from (select distinct %1$I as v from added) a
      where (select count(*) from (select 1 from %2$I.%3$I t where t.%1$I = a.v limit %4$s) c) > %5$s
      limit 1',
    col, tg_table_schema, tg_table_name, lim + 1, lim)
  into over;
  if over is not null then
    raise exception 'You have reached the limit of % %.', lim, label using errcode = '54000';
  end if;
  return null;
end $$;

-- Card rows across all of one person decks (co-builders only see the decks they share, which is fine).
create or replace function public.limit_deck_cards_per_owner()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then return null; end if;
  if exists (
    select 1 from (select distinct d.owner_id from added a join public.decks d on d.id = a.deck_id) o
    where (select count(*) from (select 1 from public.deck_cards c join public.decks d2 on d2.id = c.deck_id
                                  where d2.owner_id = o.owner_id limit 30001) x) > 30000
  ) then
    raise exception 'You have reached the limit of 30000 card rows across your decks.' using errcode = '54000';
  end if;
  return null;
end $$;

-- Named versions only: automatic ones are already pruned to 10 per deck, and counting them could block an edit.
create or replace function public.limit_named_versions()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then return null; end if;
  if exists (
    select 1 from (select distinct deck_id from added where kind = 'manual') a
    where (select count(*) from public.deck_versions v where v.deck_id = a.deck_id and v.kind = 'manual') > 50
  ) then
    raise exception 'A deck can keep up to 50 named versions. Delete an old one first.' using errcode = '54000';
  end if;
  return null;
end $$;

revoke all on function public.limit_row_size() from public, anon, authenticated;
revoke all on function public.limit_row_count() from public, anon, authenticated;
revoke all on function public.limit_deck_cards_per_owner() from public, anon, authenticated;
revoke all on function public.limit_named_versions() from public, anon, authenticated;

-- Row size per table (bytes).
create trigger limit_size before insert or update on public.decks for each row execute function public.limit_row_size('32768');
create trigger limit_size before insert or update on public.deck_cards for each row execute function public.limit_row_size('8192');
create trigger limit_size before insert or update on public.deck_versions for each row execute function public.limit_row_size('1048576');
create trigger limit_size before insert or update on public.profiles for each row execute function public.limit_row_size('65536');
create trigger limit_size before insert or update on public.collection_cards for each row execute function public.limit_row_size('8192');
create trigger limit_size before insert or update on public.preferred_printings for each row execute function public.limit_row_size('8192');
create trigger limit_size before insert or update on public.wishlist for each row execute function public.limit_row_size('4096');
create trigger limit_size before insert or update on public.user_tags for each row execute function public.limit_row_size('2048');
create trigger limit_size before insert or update on public.user_tag_cards for each row execute function public.limit_row_size('1024');
create trigger limit_size before insert or update on public.deck_games for each row execute function public.limit_row_size('16384');
create trigger limit_size before insert or update on public.deck_card_notes for each row execute function public.limit_row_size('4096');
create trigger limit_size before insert or update on public.card_packages for each row execute function public.limit_row_size('2048');
create trigger limit_size before insert or update on public.card_package_cards for each row execute function public.limit_row_size('1024');
create trigger limit_size before insert or update on public.deck_folders for each row execute function public.limit_row_size('1024');

-- Row counts.
create trigger limit_count after insert on public.decks referencing new table as added
  for each statement execute function public.limit_row_count('owner_id', '300', 'decks');
create trigger limit_count after insert on public.deck_cards referencing new table as added
  for each statement execute function public.limit_row_count('deck_id', '1000', 'card rows in one deck');
create trigger limit_owner_count after insert on public.deck_cards referencing new table as added
  for each statement execute function public.limit_deck_cards_per_owner();
create trigger limit_count after insert on public.deck_versions referencing new table as added
  for each statement execute function public.limit_named_versions();
create trigger limit_count after insert on public.collection_cards referencing new table as added
  for each statement execute function public.limit_row_count('owner_id', '30000', 'collection rows');
create trigger limit_count after insert on public.preferred_printings referencing new table as added
  for each statement execute function public.limit_row_count('owner_id', '30000', 'default printings');
create trigger limit_count after insert on public.wishlist referencing new table as added
  for each statement execute function public.limit_row_count('owner_id', '2000', 'wish list cards');
create trigger limit_count after insert on public.user_tags referencing new table as added
  for each statement execute function public.limit_row_count('owner_id', '500', 'tags');
create trigger limit_count after insert on public.user_tag_cards referencing new table as added
  for each statement execute function public.limit_row_count('tag_id', '2000', 'cards on one tag');
create trigger limit_count after insert on public.deck_games referencing new table as added
  for each statement execute function public.limit_row_count('deck_id', '3000', 'games for one deck');
create trigger limit_count after insert on public.deck_card_notes referencing new table as added
  for each statement execute function public.limit_row_count('deck_id', '1000', 'card notes in one deck');
create trigger limit_count after insert on public.card_packages referencing new table as added
  for each statement execute function public.limit_row_count('owner_id', '200', 'packages');
create trigger limit_count after insert on public.card_package_cards referencing new table as added
  for each statement execute function public.limit_row_count('package_id', '300', 'cards in one package');
create trigger limit_count after insert on public.deck_folders referencing new table as added
  for each statement execute function public.limit_row_count('owner_id', '200', 'folders');

-- ---------- 2. profile pictures ----------

create or replace function public.avatar_url_ok(u text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select u is null or u ~ '^https://(cards\.scryfall\.io|cdn\.discordapp\.com|lh[0-9]\.googleusercontent\.com|edsjqsnsobmryltrwsca\.supabase\.co/storage/v1/object/public/avatars)/[A-Za-z0-9._~/?=&%+-]*$';
$$;

alter table public.profiles add constraint profiles_avatar_host check (public.avatar_url_ok(avatar_url));

-- A new sign-in whose provider picture is somewhere else starts with no picture instead of failing.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  pic text := new.raw_user_meta_data->>'avatar_url';
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    case when public.avatar_url_ok(pic) then pic end
  );
  return new;
end $$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

-- ---------- 3. tidy ----------

revoke insert, update, delete, truncate, references, trigger on public.deck_price_history from anon, authenticated;
revoke insert, update, delete on public.collection from authenticated;
alter function public.set_updated_at() set search_path = '';
