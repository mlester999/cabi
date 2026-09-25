begin;

-- Store only sanitized provider error fields for owner-only image diagnostics.
alter table public.image_generations
  add column if not exists diagnostic_provider_error jsonb;

commit;
