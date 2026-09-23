begin;

-- ===========================================================================
-- Together AI image generation.
--
-- Adds the two columns the new endpoint needs and nothing else. The existing
-- generation table already carries wallet ownership, conversation, prompt,
-- aspect ratio, provider, model, path, status and failure code, so no new table
-- is introduced.
-- ===========================================================================

-- A client-supplied key so a double-submit cannot pay for two generations.
alter table public.image_generations add column if not exists idempotency_key text;

alter table public.image_generations drop constraint if exists image_generations_idempotency_shape;
alter table public.image_generations add constraint image_generations_idempotency_shape
  check (idempotency_key is null or char_length(idempotency_key) between 8 and 80);

-- Scoped per wallet: two users may legitimately pick the same key, and one user
-- reusing a key must find only their own prior row.
create unique index if not exists image_generations_idempotency_key
  on public.image_generations (wallet_account_id, idempotency_key)
  where idempotency_key is not null;

-- The allowance check counts SUCCEEDED rows for one wallet in a day, so give it
-- a covering index that does not have to touch the heap for the common case.
create index if not exists image_generations_allowance_idx
  on public.image_generations (wallet_account_id, created_at desc)
  where status = 'SUCCEEDED';

commit;