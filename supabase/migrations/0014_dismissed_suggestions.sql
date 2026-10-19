-- Phase 4c: suggestions dismissed with Not for this deck, per deck (spec, Accounts section). Card oracle ids.
alter table public.decks add column if not exists dismissed_suggestions uuid[] not null default '{}';
