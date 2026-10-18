-- Phase 2a: user profiles and decks.
-- Row-level security on every table: a user can only read and change their own rows.
-- Public decks are readable by anyone. Unlisted decks (share links) are read through a server route in Phase 7,
-- never by an open policy, because an open policy would let anyone list every unlisted deck.

-- ---------- second lock on the card data ----------
-- Supabase grants every privilege to the website roles by default; RLS already blocks writes,
-- but revoking them means a mistake in a future policy can't open the card data to edits.
revoke insert, update, delete, truncate, references, trigger
  on public.cards, public.tags, public.tag_links, public.card_tags, public.illustration_tags,
     public.import_runs, public.schema_migrations
  from anon, authenticated;

-- ---------- helpers ----------
create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------- profiles: one per signed-in user ----------
create table public.profiles (
  id                   uuid primary key references auth.users (id) on delete cascade,
  display_name         text,
  avatar_url           text,
  default_role_targets jsonb  not null default '{}',   -- {"ramp": 12, ...}; missing keys use the app defaults
  custom_roles         jsonb  not null default '[]',   -- [{"slug": "sacrifice-outlet", "name": "Sac outlets", "target": 6}]
  hidden_tags          text[] not null default '{}',   -- "o:<slug>" or "a:<slug>"
  tag_view             jsonb  not null default '{}',   -- last-used Gameplay/Flavor, Specific/Broad, sort
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- Create the profile automatically on first sign-in, using the name and avatar from Discord/Google.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data->>'avatar_url'
  );
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
create policy "Read own profile"   on public.profiles for select to authenticated using (id = (select auth.uid()));
create policy "Update own profile" on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- ---------- decks ----------
create table public.decks (
  id               uuid primary key default gen_random_uuid(),
  owner_id         uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  name             text not null default 'Untitled deck' check (length(name) between 1 and 120),
  description      text,
  visibility       text not null default 'private' check (visibility in ('private', 'unlisted', 'public')),
  target_bracket   smallint check (target_bracket between 1 and 5),
  suggestion_style text not null default 'best_fit'
                   check (suggestion_style in ('best_fit', 'hidden_gems', 'budget', 'custom')),
  role_targets     jsonb not null default '{}',   -- copied from the profile defaults when the deck is created
  custom_roles     jsonb not null default '[]',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index decks_owner_idx on public.decks (owner_id, updated_at desc);
create trigger decks_updated_at before update on public.decks
  for each row execute function public.set_updated_at();

alter table public.decks enable row level security;
create policy "Owner reads own decks" on public.decks for select to authenticated
  using (owner_id = (select auth.uid()));
create policy "Anyone reads public decks" on public.decks for select to anon, authenticated
  using (visibility = 'public');
create policy "Owner creates decks" on public.decks for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy "Owner updates own decks" on public.decks for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "Owner deletes own decks" on public.decks for delete to authenticated
  using (owner_id = (select auth.uid()));

-- ---------- deck_cards: one row per card per board ----------
create table public.deck_cards (
  deck_id     uuid not null references public.decks (id) on delete cascade,
  oracle_id   uuid not null references public.cards (oracle_id),
  board       text not null default 'main' check (board in ('commander', 'main', 'maybe', 'companion')),
  quantity    smallint not null default 1 check (quantity between 1 and 99),   -- >1 only for basics and "any number" cards
  printing_id uuid,           -- Scryfall card id of the chosen printing; null = default printing (picker comes later)
  category    text,           -- manual category override; null = automatic from tags (Phase 3)
  added_at    timestamptz not null default now(),
  primary key (deck_id, oracle_id, board)
);
create index deck_cards_oracle_idx on public.deck_cards (oracle_id);

-- Any change to a deck's cards bumps the deck's updated_at (so "My decks" sorts by last edit).
create or replace function public.touch_deck() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.decks set updated_at = now() where id = coalesce(new.deck_id, old.deck_id);
  return null;
end $$;
create trigger deck_cards_touch after insert or update or delete on public.deck_cards
  for each row execute function public.touch_deck();

alter table public.deck_cards enable row level security;
create policy "Owner reads own deck cards" on public.deck_cards for select to authenticated
  using (exists (select 1 from public.decks d where d.id = deck_id and d.owner_id = (select auth.uid())));
create policy "Anyone reads public deck cards" on public.deck_cards for select to anon, authenticated
  using (exists (select 1 from public.decks d where d.id = deck_id and d.visibility = 'public'));
create policy "Owner adds deck cards" on public.deck_cards for insert to authenticated
  with check (exists (select 1 from public.decks d where d.id = deck_id and d.owner_id = (select auth.uid())));
create policy "Owner updates deck cards" on public.deck_cards for update to authenticated
  using (exists (select 1 from public.decks d where d.id = deck_id and d.owner_id = (select auth.uid())))
  with check (exists (select 1 from public.decks d where d.id = deck_id and d.owner_id = (select auth.uid())));
create policy "Owner removes deck cards" on public.deck_cards for delete to authenticated
  using (exists (select 1 from public.decks d where d.id = deck_id and d.owner_id = (select auth.uid())));

-- Website roles get only what their policies can use.
revoke all on public.profiles, public.decks, public.deck_cards from anon, authenticated;
grant select, update                 on public.profiles   to authenticated;
grant select, insert, update, delete on public.decks      to authenticated;
grant select, insert, update, delete on public.deck_cards to authenticated;
grant select                         on public.decks, public.deck_cards to anon;
