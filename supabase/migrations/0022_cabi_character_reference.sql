begin;

-- ===========================================================================
-- Cabi official character reference.
--
-- Cabi must stay recognizably Cabi across every generated image. One official
-- reference render is the visual anchor, and it is a SYSTEM asset: it belongs to
-- the product, not to a user, so it lives in its own private bucket rather than
-- inside anybody's generation folder.
--
-- Two pieces:
--
--   1. storage bucket `cabi-system-assets` (private) with the object
--      `official/cabi-reference.png` as the canonical slot.
--
--   2. `cabi_references` - one row per uploaded version. Exactly one row may be
--      active at a time, enforced by a partial unique index rather than by
--      application code, so a concurrent upload cannot leave two live references.
--
-- The bundled `public/assets/cabi-cpu-model.png` remains the fallback when no row
-- is active. Nothing here ever auto-selects a different image.
-- ===========================================================================

insert into storage.buckets (id, name, public)
values ('cabi-system-assets', 'cabi-system-assets', false)
on conflict (id) do update
set name = excluded.name,
    public = false;

create table if not exists public.cabi_references (
  id uuid primary key default gen_random_uuid(),
  storage_path text not null,
  version integer not null check (version >= 1),
  active boolean not null default false,
  uploaded_at timestamptz not null default timezone('utc', now()),
  uploaded_by text,
  width integer check (width is null or width > 0),
  height integer check (height is null or height > 0),
  mime_type text not null check (mime_type in ('image/png', 'image/jpeg', 'image/webp')),
  hash text not null
);

create unique index if not exists cabi_references_version_idx on public.cabi_references (version);

-- The invariant: at most one active reference, ever.
create unique index if not exists cabi_references_single_active_idx
  on public.cabi_references (active)
  where active;

create index if not exists cabi_references_uploaded_idx
  on public.cabi_references (uploaded_at desc);

alter table public.cabi_references enable row level security;
revoke all on public.cabi_references from anon, authenticated;

-- The reference image path and its metadata are recorded on every generation, so
-- an image can always be traced back to the character reference that produced it.
alter table public.image_generations add column if not exists reference_version integer;
alter table public.image_generations add column if not exists expression text;
alter table public.image_generations add column if not exists outfit text;
alter table public.image_generations add column if not exists scene text;
alter table public.image_generations add column if not exists seed bigint;
alter table public.image_generations add column if not exists reference_conditioned boolean not null default false;

commit;
