-- Monthly check-in email (V3; David, Nov 13 2026): once a month, signed-up players get a short email that links to
-- three quick questions (are you happy with your decks, is the site easy, have your decks gotten better) and an
-- optional note. Every email has a one-click unsubscribe link, and Settings has the same switch.
--
-- The server reads and writes both tables with the service-role key only (the admin page sends, the check-in page
-- saves answers from a signed link), so neither table has any grant for anon or authenticated.
-- profiles.checkin_emails is the person's own switch; the existing Update own profile policy covers it.

alter table public.profiles add column if not exists checkin_emails boolean not null default true;

-- One row per person per month that an email went to, so a second press of Send never emails anyone twice.
create table if not exists public.checkin_sends (
  user_id  uuid not null references public.profiles (id) on delete cascade,
  month    text not null check (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  sent_at  timestamptz not null default now(),
  primary key (user_id, month)
);

-- One answer per person per month; answering again the same month replaces it.
create table if not exists public.checkin_answers (
  user_id     uuid not null references public.profiles (id) on delete cascade,
  month       text not null check (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  liked       smallint not null check (liked between 1 and 5),
  easy        smallint not null check (easy between 1 and 5),
  better      smallint not null check (better between 1 and 5),
  note        text check (note is null or char_length(note) <= 1000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (user_id, month)
);
create index if not exists checkin_answers_month on public.checkin_answers (month);

alter table public.checkin_sends enable row level security;
alter table public.checkin_answers enable row level security;
revoke all on public.checkin_sends, public.checkin_answers from anon, authenticated;

notify pgrst, 'reload schema';
