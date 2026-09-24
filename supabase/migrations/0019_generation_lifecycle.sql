begin;

-- ===========================================================================
-- Durable generation lifecycle.
--
-- The existing status values (PENDING/SUCCEEDED/FAILED) described an outcome,
-- not a process, and carried no timestamps. This widens them to a real state
-- machine and records when each transition happened, so the UI can render a
-- generation honestly and recover after a refresh.
-- ===========================================================================

-- Widen the status set. Existing rows keep their meaning: PENDING becomes
-- QUEUED and SUCCEEDED becomes COMPLETED.
alter table public.image_generations drop constraint if exists image_generations_status_check;
alter table public.image_generations add constraint image_generations_status_check
  check (status in ('QUEUED', 'GENERATING', 'COMPLETED', 'FAILED'));

update public.image_generations set status = 'QUEUED' where status = 'PENDING';
update public.image_generations set status = 'COMPLETED' where status = 'SUCCEEDED';

alter table public.image_generations alter column status set default 'QUEUED';

-- Transition timestamps. Nullable because a row only earns one once it reaches
-- that state.
alter table public.image_generations add column if not exists queued_at timestamptz;
alter table public.image_generations add column if not exists started_at timestamptz;
alter table public.image_generations add column if not exists completed_at timestamptz;
alter table public.image_generations add column if not exists failed_at timestamptz;

-- Backfill so existing rows have a coherent history rather than nulls.
update public.image_generations
set queued_at = coalesce(queued_at, created_at)
where queued_at is null;

update public.image_generations
set completed_at = coalesce(completed_at, created_at)
where status = 'COMPLETED' and completed_at is null;

update public.image_generations
set failed_at = coalesce(failed_at, created_at)
where status = 'FAILED' and failed_at is null;

-- Human-readable failure reason for the UI, and the safe scene actually used.
-- `failure_code` already holds the machine-readable code.
alter table public.image_generations add column if not exists failure_message text;
alter table public.image_generations add column if not exists safety_code text;

/*
 * Link a generation to the assistant message that displays it.
 *
 * This is what makes an image behave like a real conversation message: a
 * reopened conversation can find the generation by message id and mint a FRESH
 * signed URL. Without it the only reference is the signed URL baked into
 * metadata_json, which expires in ten minutes and leaves the user looking at
 * "this image link has expired".
 */
alter table public.image_generations add column if not exists assistant_message_id uuid
  references public.messages(id) on delete set null;

create index if not exists image_generations_message_idx
  on public.image_generations (assistant_message_id)
  where assistant_message_id is not null;

-- Regenerating from an existing image creates a NEW row and points back at the
-- original, so the earlier image is preserved rather than overwritten.
alter table public.image_generations add column if not exists parent_generation_id uuid
  references public.image_generations(id) on delete set null;

create index if not exists image_generations_parent_idx
  on public.image_generations (parent_generation_id)
  where parent_generation_id is not null;

-- The daily-allowance and admin counters both filter on status and recency.
create index if not exists image_generations_status_created_idx
  on public.image_generations (status, created_at desc);

commit;