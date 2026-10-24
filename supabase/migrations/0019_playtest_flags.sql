-- Phase 6d: underperformer flags from the playtester, counted per card per deck (David chose counts).
-- Shape: {oracle_id: count}. Changed only through the two functions below, so two quick flags never overwrite
-- each other (each is one atomic update). Security invoker: row-level security on decks still applies.
-- Note for the migration runner: keep comments free of quote characters.

alter table public.decks add column if not exists playtest_flags jsonb not null default '{}';

create or replace function public.flag_card(p_deck uuid, p_oracle uuid)
returns int
language plpgsql security invoker set search_path = '' as $$
declare
  n int;
begin
  update public.decks
     set playtest_flags = jsonb_set(playtest_flags, array[p_oracle::text],
                                    to_jsonb(coalesce((playtest_flags ->> p_oracle::text)::int, 0) + 1))
   where id = p_deck and owner_id = (select auth.uid())
  returning (playtest_flags ->> p_oracle::text)::int into n;
  if n is null then
    raise exception 'Deck not found or not yours' using errcode = '42501';
  end if;
  return n;
end $$;

create or replace function public.clear_flag(p_deck uuid, p_oracle uuid)
returns void
language sql security invoker set search_path = '' as $$
  update public.decks set playtest_flags = playtest_flags - p_oracle::text
  where id = p_deck and owner_id = (select auth.uid());
$$;

revoke execute on function public.flag_card(uuid, uuid) from anon, public;
revoke execute on function public.clear_flag(uuid, uuid) from anon, public;
grant execute on function public.flag_card(uuid, uuid) to authenticated;
grant execute on function public.clear_flag(uuid, uuid) to authenticated;
