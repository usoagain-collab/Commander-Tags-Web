-- Phase 5a fix: decks.target_bracket already existed from 0003 (nullable, no default), so the add column in
-- 0015 was skipped. Make it what David chose: default 3 (Upgraded), never empty.
update public.decks set target_bracket = 3 where target_bracket is null;
alter table public.decks alter column target_bracket set default 3;
alter table public.decks alter column target_bracket set not null;
