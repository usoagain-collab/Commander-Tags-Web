-- Phase 6c: which tokens each card makes, for the editor Tokens list and playtester tokens.
-- Scryfall lists them per card in all_parts (component token) as a token PRINTING id plus its name and type
-- line, not an oracle id, so that is what we keep. The token image loads from Scryfall by that printing id.
-- Rebuilt by the daily import inside its tag transaction.
-- Note for the migration runner: keep comments free of quote characters.

create table public.card_tokens (
  oracle_id uuid not null references public.cards (oracle_id) on delete cascade,
  token_id  uuid not null,          -- Scryfall card id of the token printing
  name      text not null,
  type_line text not null default '',
  primary key (oracle_id, token_id)
);

alter table public.card_tokens enable row level security;
create policy "Anyone reads card tokens" on public.card_tokens for select to anon, authenticated using (true);
revoke all on public.card_tokens from anon, authenticated;
grant select on public.card_tokens to anon, authenticated;

-- [{token_id, name, type_line, made_by: [oracle_id, ...]}, ...] for the given cards, one entry per token.
create or replace function public.tokens_for(p_ids uuid[])
returns jsonb
language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(t order by t.name), '[]'::jsonb)
  from (
    select ct.token_id, min(ct.name) as name, min(ct.type_line) as type_line, jsonb_agg(distinct ct.oracle_id) as made_by
    from public.card_tokens ct
    where ct.oracle_id = any(p_ids[1:1000])
    group by ct.token_id
  ) t;
$$;
grant execute on function public.tokens_for(uuid[]) to anon, authenticated;
