-- Account settings: light or dark look, and a profile picture.
-- The picture stays in profiles.avatar_url: a Scryfall card art address, an uploaded file address, or the sign-in provider picture.

alter table public.profiles
  add column if not exists theme text not null default 'dark' check (theme in ('light', 'dark'));

-- Uploaded pictures. The browser shrinks them to 256 px first, so 1 MB is plenty. No SVG: it can carry scripts.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 1048576, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Each user works only inside a folder named after their own id. Showing a picture uses its public address,
-- which needs no policy, so nobody can list the pictures of other users.
create policy "Read own avatars" on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "Add own avatars" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "Delete own avatars" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
