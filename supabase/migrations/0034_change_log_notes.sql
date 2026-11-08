-- Smart Cutter C2: the change log keeps why a card was cut.
-- apply_deck_changes takes p_notes, an object with label (the edit, e.g. Smart Cutter) and cards (oracle id to
-- reason), and hands it to the change log trigger through a setting that lasts only for this transaction, so
-- every other way of editing stays exactly as before and logs no label.
-- Note for the migration runner: keep comments free of quote characters.

alter table public.deck_change_log add column if not exists label text;
alter table public.deck_change_log add column if not exists note text;

create or replace function public.log_deck_card_change()
returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_deck  uuid := coalesce(new.deck_id, old.deck_id);
  v_card  uuid := coalesce(new.oracle_id, old.oracle_id);
  v_from  int  := case when tg_op = 'INSERT' then 0 else old.quantity end;
  v_to    int  := case when tg_op = 'DELETE' then 0 else new.quantity end;
  v_cut   bigint;
  v_notes jsonb := nullif(current_setting('deckgenome.change_notes', true), '')::jsonb;
begin
  if v_from = v_to then
    return null;
  end if;
  -- Deleting a deck removes its cards too; nothing to log then.
  if not exists (select 1 from public.decks where id = v_deck) then
    return null;
  end if;

  insert into public.deck_change_log (deck_id, edit_id, oracle_id, name, board, from_qty, to_qty, label, note)
  select v_deck, txid_current(), v_card, coalesce(c.name, 'Unknown card'), coalesce(new.board, old.board), v_from, v_to,
         v_notes->>'label', v_notes->'cards'->>(v_card::text)
  from (select 1) one left join public.cards c on c.oracle_id = v_card;

  select id into v_cut from public.deck_change_log
  where deck_id = v_deck order by id desc offset 150 limit 1;
  if v_cut is not null then
    delete from public.deck_change_log where deck_id = v_deck and id <= v_cut;
  end if;
  return null;
end $$;

-- ---------- apply_deck_changes: same as 0025, plus p_notes ----------
drop function public.apply_deck_changes(uuid, jsonb, jsonb, jsonb, text, jsonb);
create function public.apply_deck_changes(
  p_deck uuid, p_changes jsonb, p_categories jsonb default '[]', p_tag_cards jsonb default '[]', p_snapshot_name text default null,
  p_printings jsonb default '[]', p_notes jsonb default null
)
returns void
language plpgsql security invoker set search_path = '' as $$
declare
  ch jsonb;
  qty int;
  pr jsonb;
begin
  if not exists (select 1 from public.decks where id = p_deck and owner_id = (select auth.uid())) then
    raise exception 'Deck not found or not yours' using errcode = '42501';
  end if;

  -- Notes for the change log trigger, for this transaction only.
  perform set_config('deckgenome.change_notes', coalesce(p_notes::text, ''), true);

  if p_snapshot_name is not null then
    perform public.snapshot_deck(p_deck, 'auto', p_snapshot_name);
  elsif not exists (select 1 from public.deck_versions
                    where deck_id = p_deck and created_at > now() - interval '30 minutes') then
    perform public.snapshot_deck(p_deck, 'auto', null);
  end if;

  for ch in select * from jsonb_array_elements(coalesce(p_changes, '[]')) loop
    qty := coalesce((ch->>'quantity')::int, 0);
    if qty <= 0 then
      delete from public.deck_cards
      where deck_id = p_deck and oracle_id = (ch->>'oracle_id')::uuid and board = ch->>'board';
    else
      insert into public.deck_cards (deck_id, oracle_id, board, quantity)
      values (p_deck, (ch->>'oracle_id')::uuid, ch->>'board', qty)
      on conflict (deck_id, oracle_id, board) do update set quantity = excluded.quantity;
    end if;
  end loop;

  for ch in select * from jsonb_array_elements(coalesce(p_categories, '[]')) loop
    update public.deck_cards set category = nullif(btrim(ch->>'category'), '')
    where deck_id = p_deck and oracle_id = (ch->>'oracle_id')::uuid and board = ch->>'board';
  end loop;

  for ch in select * from jsonb_array_elements(coalesce(p_printings, '[]')) loop
    pr := nullif(ch->'printing', 'null'::jsonb);
    update public.deck_cards
    set printing_id = (pr->>'id')::uuid,
        foil = coalesce((pr->>'foil')::boolean, false),
        printing_info = pr - 'id' - 'foil'
    where deck_id = p_deck and oracle_id = (ch->>'oracle_id')::uuid and board = ch->>'board';
  end loop;

  for ch in select * from jsonb_array_elements(coalesce(p_tag_cards, '[]')) loop
    if not exists (select 1 from public.user_tags t
                   where t.id = (ch->>'tag_id')::uuid and t.owner_id = (select auth.uid())
                     and (t.deck_id is null or t.deck_id = p_deck)) then
      raise exception 'Tag not found or not usable in this deck' using errcode = '42501';
    end if;
    if coalesce((ch->>'on')::boolean, false) then
      insert into public.user_tag_cards (tag_id, oracle_id)
      values ((ch->>'tag_id')::uuid, (ch->>'oracle_id')::uuid) on conflict do nothing;
    else
      delete from public.user_tag_cards
      where tag_id = (ch->>'tag_id')::uuid and oracle_id = (ch->>'oracle_id')::uuid;
    end if;
  end loop;
end $$;
revoke execute on function public.apply_deck_changes(uuid, jsonb, jsonb, jsonb, text, jsonb, jsonb) from anon, public;
grant execute on function public.apply_deck_changes(uuid, jsonb, jsonb, jsonb, text, jsonb, jsonb) to authenticated;

notify pgrst, 'reload schema';
