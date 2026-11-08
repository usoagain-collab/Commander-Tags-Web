-- v2 Built by name: the name and picture of the person who built a deck, for anyone allowed to open it.
-- Profiles are private to their owner, so this reads one profile on purpose (security definer), and only for a
-- deck that is unlisted, public or your own. Nothing else of the profile leaves.
create or replace function public.deck_builder(p_id uuid)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('name', nullif(btrim(p.display_name), ''), 'avatar_url', p.avatar_url)
  from public.decks d
  join public.profiles p on p.id = d.owner_id
  where d.id = p_id and (d.visibility in ('unlisted', 'public') or d.owner_id = (select auth.uid()));
$$;

revoke all on function public.deck_builder(uuid) from public;
grant execute on function public.deck_builder(uuid) to anon, authenticated;

-- A display name is at most 40 characters, so a long one cannot crowd a shared deck header.
alter table public.profiles drop constraint if exists profiles_display_name_length;
alter table public.profiles add constraint profiles_display_name_length check (char_length(display_name) <= 40) not valid;

notify pgrst, 'reload schema';
