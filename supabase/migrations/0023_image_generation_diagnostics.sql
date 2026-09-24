begin;

-- ===========================================================================
-- Safe owner diagnostics for image failures.
--
-- These fields let /admin/images explain a failed generation without exposing
-- the assembled prompt, provider response body, signed URL, or API key. The
-- scene/expression/outfit values are the already-normalised generation fields,
-- not the raw private prompt.
-- ===========================================================================

alter table public.image_generations add column if not exists pipeline_request_id text;
alter table public.image_generations add column if not exists diagnostic_stage text;
alter table public.image_generations add column if not exists provider_error_category text;
alter table public.image_generations add column if not exists http_status integer;
alter table public.image_generations add column if not exists prompt_hash text;
alter table public.image_generations add column if not exists prompt_length integer;
alter table public.image_generations add column if not exists diagnostic_scene text;
alter table public.image_generations add column if not exists diagnostic_expression text;
alter table public.image_generations add column if not exists diagnostic_outfit text;
alter table public.image_generations add column if not exists prompt_retry_count integer not null default 0;

alter table public.image_generations drop constraint if exists image_generations_http_status_check;
alter table public.image_generations add constraint image_generations_http_status_check
  check (http_status is null or http_status between 100 and 599);

alter table public.image_generations drop constraint if exists image_generations_prompt_length_check;
alter table public.image_generations add constraint image_generations_prompt_length_check
  check (prompt_length is null or prompt_length between 0 and 4000);

alter table public.image_generations drop constraint if exists image_generations_prompt_retry_count_check;
alter table public.image_generations add constraint image_generations_prompt_retry_count_check
  check (prompt_retry_count between 0 and 1);

create index if not exists image_generations_failed_diagnostics_idx
  on public.image_generations (created_at desc)
  where status = 'FAILED';

commit;
