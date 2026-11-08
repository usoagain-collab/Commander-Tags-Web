-- Change log timeline (friend-test idea, Nov 7, 2026): every card added to, removed from or recounted in a deck,
-- newest first. A trigger on deck_cards writes it, so every way of editing lands here (quick add, search, drag,
-- import, undo, restore) without the app sending anything extra.
-- One row per card per board per edit. edit_id is the transaction id, so cards changed by one edit group together
-- (a move between boards is a removal and an addition with the same edit_id).
-- Only the newest 150 rows per deck are kept. Private to the deck owner.
-- Note for the migration runner: keep comments free of quote characters.

create table public.deck_change_log (
  id          bigint generated always as identity primary key,
  deck_id     uuid not null references public.decks (id) on delete cascade,
  edit_id     bigint not null,
  changed_at  timestamptz not null default now(),
  oracle_id   uuid not null,
  name        text not null,
  board       text not null,
  from_qty    int not null,
  to_qty      int not null
);
create index deck_change_log_deck_idx on public.deck_change_log (deck_id, id desc);

alter table public.deck_change_log enable row level security;
create policy "Owner reads own change log" on public.deck_change_log for select to authenticated
  using (exists (select 1 from public.decks d where d.id = deck_id and d.owner_id = (select auth.uid())));
revoke all on public.deck_change_log from anon, authenticated;
grant select on public.deck_change_log to authenticated;

create or replace function public.log_deck_card_change()
returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_deck  uuid := coalesce(new.deck_id, old.deck_id);
  v_card  uuid := coalesce(new.oracle_id, old.oracle_id);
  v_from  int  := case when tg_op = 'INSERT' then 0 else old.quantity end;
  v_to    int  := case when tg_op = 'DELETE' then 0 else new.quantity end;
  v_cut   bigint;
begin
  if v_from = v_to then
    return null;
  end if;
  -- Deleting a deck removes its cards too; nothing to log then.
  if not exists (select 1 from public.decks where id = v_deck) then
    return null;
  end if;

  insert into public.deck_change_log (deck_id, edit_id, oracle_id, name, board, from_qty, to_qty)
  select v_deck, txid_current(), v_card, coalesce(c.name, 'Unknown card'), coalesce(new.board, old.board), v_from, v_to
  from (select 1) one left join public.cards c on c.oracle_id = v_card;

  select id into v_cut from public.deck_change_log
  where deck_id = v_deck order by id desc offset 150 limit 1;
  if v_cut is not null then
    delete from public.deck_change_log where deck_id = v_deck and id <= v_cut;
  end if;
  return null;
end $$;
revoke execute on function public.log_deck_card_change() from anon, authenticated, public;

create trigger deck_cards_log after insert or delete or update of quantity on public.deck_cards
  for each row execute function public.log_deck_card_change();
