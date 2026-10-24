-- Phase 7a: share links and feedback.
--
-- shared_deck(id): one deck by its exact id when it is unlisted or public (or yours), with its card rows.
-- Unlisted decks still have no open read policy (Phase 2 decision): this function only answers for an id you
-- already know, so nobody can list them. Security definer so it can read past row-level security, with a fixed
-- search path and only the fields a read-only viewer needs.
--
-- feedback: messages from the Feedback button. Signed-in users can add, nobody can read through the API;
-- David reads them in the Supabase dashboard (Table editor, feedback).
-- Note for the migration runner: keep comments free of quote characters.

create or replace function public.shared_deck(p_id uuid)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'deck', jsonb_build_object(
      'id', d.id, 'name', d.name, 'owner_id', d.owner_id, 'visibility', d.visibility,
      'role_targets', d.role_targets, 'custom_roles', d.custom_roles, 'target_bracket', d.target_bracket),
    'rows', coalesce((select jsonb_agg(jsonb_build_object('oracle_id', c.oracle_id, 'board', c.board, 'quantity', c.quantity, 'category', c.category))
                      from public.deck_cards c where c.deck_id = d.id), '[]'::jsonb))
  from public.decks d
  where d.id = p_id and (d.visibility in ('unlisted', 'public') or d.owner_id = (select auth.uid()));
$$;
revoke execute on function public.shared_deck(uuid) from public;
grant execute on function public.shared_deck(uuid) to anon, authenticated;

create table public.feedback (
  id         bigint generated always as identity primary key,
  user_id    uuid default auth.uid() references auth.users (id) on delete set null,
  page       text,
  message    text not null check (char_length(btrim(message)) between 1 and 4000),
  created_at timestamptz not null default now()
);
alter table public.feedback enable row level security;
create policy "Signed-in users send feedback" on public.feedback for insert to authenticated
  with check (user_id = (select auth.uid()));
revoke all on public.feedback from anon, authenticated;
grant insert (page, message) on public.feedback to authenticated;
