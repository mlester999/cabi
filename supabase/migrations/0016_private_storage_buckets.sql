begin;

-- Generated images and avatars are served through short-lived signed URLs.
-- Keep both buckets private even if they were created manually beforehand.
insert into storage.buckets (id, name, public)
values
  ('cabi-generations', 'cabi-generations', false),
  ('avatars', 'avatars', false)
on conflict (id) do update
set name = excluded.name,
    public = false;

commit;
