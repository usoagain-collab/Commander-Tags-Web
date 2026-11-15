-- V3 Needs help flag (Nov 15, 2026). An owner can ask for feedback on a deck, with an optional short note of what
-- they want help with. Browse can then list public decks that want feedback, and the deck page shows the ask above
-- its comments. Run after 0059 (deck comments and likes): this replaces deck_social to add the two fields.
-- Note for the migration runner: keep comments free of quote characters.

alter table public.decks add column if not exists needs_help boolean not null default false;
alter table public.decks add column if not exists help_note text;
alter table public.decks drop constraint if exists decks_help_note_length;
alter table public.decks add constraint decks_help_note_length
  check (help_note is null or char_length(help_note) <= 200);
create index if not exists decks_needs_help_idx on public.decks (updated_at desc)
  where needs_help and visibility = 'public';

create or replace function public.deck_social(p_id uuid)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'description', d.description,
    'comments_open', d.comments_open,
    'needs_help', d.needs_help,
    'help_note', d.help_note,
    'likes', (select count(*) from public.deck_likes l where l.deck_id = d.id),
    'liked', exists (select 1 from public.deck_likes l where l.deck_id = d.id and l.user_id = (select auth.uid())),
    'comments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id,
        'body', c.body,
        'created_at', c.created_at,
        'author', nullif(btrim(p.display_name), ''),
        'avatar_url', p.avatar_url,
        'is_owner', c.author_id = d.owner_id,
        'mine', c.author_id = (select auth.uid()),
        'can_delete', c.author_id = (select auth.uid()) or d.owner_id = (select auth.uid())
      ) order by c.created_at)
      from (select * from public.deck_comments x where x.deck_id = d.id order by x.created_at desc limit 200) c
      join public.profiles p on p.id = c.author_id), '[]'::jsonb)
  )
  from public.decks d
  where d.id = p_id and (d.visibility in ('unlisted', 'public') or d.owner_id = (select auth.uid()));
$$;
revoke all on function public.deck_social(uuid) from public;
grant execute on function public.deck_social(uuid) to anon, authenticated;

notify pgrst, 'reload schema';
