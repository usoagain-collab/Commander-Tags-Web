-- Open feedback (Nov 14, 2026): anyone can send feedback, signed in or not, ahead of the r/EDH and Bluesky posts.
-- Sends now go through the server route /api/feedback, which writes with the server-only key, so the table still
-- has no policy for anonymous visitors and nobody can read it through the API. The route checks a hidden spam
-- trap, then limits each visitor to a few messages per ten minutes and the whole site to a cap per hour.
-- email: optional address for a reply, as the visitor typed it.
-- ip_hash: a one-way hash of the visitor IP address, only for the rate limit. The address itself is never stored.
-- Note for the migration runner: keep comments free of quote characters.

alter table public.feedback add column if not exists email text
  check (email is null or (char_length(email) <= 254 and email ~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'));
alter table public.feedback add column if not exists ip_hash text;

create index if not exists feedback_ip_hash_created_at on public.feedback (ip_hash, created_at desc);
create index if not exists feedback_created_at on public.feedback (created_at desc);
