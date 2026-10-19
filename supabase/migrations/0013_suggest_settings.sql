-- Phase 4b: the suggestion style is saved per deck (spec, Accounts section): style, price cap and custom weights.
-- Shape: {style: best|gems|budget|custom, priceCap: number, weights: {fit, pop, price}}; empty = defaults.
-- Owners already have update rights on their decks (0003), so no new policy is needed.
alter table public.decks add column if not exists suggest_settings jsonb not null default '{}';
