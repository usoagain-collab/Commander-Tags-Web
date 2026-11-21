-- Security fix (Nov 20, 2026): only the precon import may set decks.precon.
-- Before this, a signed-in user could set precon on their own public deck through the API, which made it show
-- on the precons page as an official precon. By claiming the file name of an upcoming MTGJSON deck first, they
-- also kept ownership after the nightly import filled it in, because the import upsert never reset owner_id.
-- The import connects as postgres and admin routes use service_role, so the check only stops the two API roles.

create or replace function public.guard_deck_precon()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('anon', 'authenticated') then
    if (tg_op = 'INSERT' and new.precon is not null)
       or (tg_op = 'UPDATE' and new.precon is distinct from old.precon) then
      raise exception 'Only the precon import can set this field.' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

revoke all on function public.guard_deck_precon() from public, anon, authenticated;

drop trigger if exists decks_guard_precon on public.decks;
create trigger decks_guard_precon
  before insert or update of precon on public.decks
  for each row execute function public.guard_deck_precon();
