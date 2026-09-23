begin;

-- ---------------------------------------------------------------------------
-- Repair pass for issues that only surface at runtime, not at apply time.
--
-- This file is safe to run on a database that already has 0001-0008 applied and
-- on a brand new one. It never drops or renames user data.
-- ---------------------------------------------------------------------------

-- 1. knowledge retrieval was dead.
--
-- 0004 defined `public.search_knowledge_chunks(...)` with `set search_path = ''`
-- and called `public.similarity(...)`. `similarity` is provided by pg_trgm, which
-- Supabase installs into the `extensions` schema, so there is usually no
-- `public.similarity` to call. The DDL applied fine because plpgsql only
-- raw-parses SQL bodies at CREATE time, but every call then failed with
-- `function public.similarity(text, text) does not exist`, which means
-- `lib/knowledge/search.ts` could never retrieve anything.
--
-- The replacement below resolves the trigram function through the schema the
-- extension is actually installed in, so it works whether pg_trgm ended up in
-- `extensions` (Supabase default) or `public` (plain SQL-editor apply).

do $$
declare
  v_schema text;
begin
  select n.nspname into v_schema
  from pg_extension e
  join pg_namespace n on n.oid = e.extnamespace
  where e.extname = 'pg_trgm';

  if v_schema is null then
    -- Not installed anywhere yet: put it where migrations expect to find it.
    execute 'create extension if not exists pg_trgm with schema extensions';
    v_schema := 'extensions';
  end if;

  execute format($fn$
    create or replace function public.search_knowledge_chunks(p_query text, p_limit integer default 6)
    returns table (chunk_id uuid, title text, source_url text, content text, score real, fetched_at timestamptz)
    language sql
    stable
    security definer
    set search_path = ''
    as $body$
      with query as (select websearch_to_tsquery('english', left(p_query, 500)) as value)
      select c.id, d.title, d.canonical_url, c.content,
        (ts_rank_cd(c.search_vector, query.value) + greatest(%1$I.similarity(d.title, p_query), 0) * 0.35)::real,
        d.fetched_at
      from public.knowledge_chunks c
      join public.knowledge_documents d on d.id = c.document_id
      cross join query
      where d.status = 'active'
        and (
          c.search_vector @@ query.value
          or %1$I.similarity(d.title, p_query) > 0.15
          or c.content ilike '%%' || replace(left(p_query, 120), '%%', '') || '%%'
        )
      order by 5 desc
      limit least(greatest(coalesce(p_limit, 6), 1), 10);
    $body$;
  $fn$, v_schema);
end;
$$;

revoke all on function public.search_knowledge_chunks(text, integer) from public, anon, authenticated;
grant execute on function public.search_knowledge_chunks(text, integer) to service_role;

-- 2. least privilege for the extension schema.
--
-- When pg_trgm (or pgcrypto, or the uuid-ossp family) lives in `extensions`, the
-- roles that need to call those functions must be able to resolve them. Without
-- USAGE, any future policy or view that touches a trigram index fails with
-- `permission denied for schema extensions`.

create schema if not exists extensions;
grant usage on schema extensions to anon, authenticated, service_role;

-- 3. Row level security helpers were inert.
--
-- `private.current_wallet_account_id()` and `private.current_profile_id()` read
-- `current_setting('request.jwt.claim.<name>', true)`. PostgREST removed that
-- per-claim GUC in v12, so the setting no longer exists and the helper always
-- returned NULL. That silently made every `to authenticated` policy in 0002,
-- 0003 and 0006 permanently false.
--
-- The rewritten helpers read the current `request.jwt.claims` JSON GUC instead
-- and fall back to the legacy name, so they work with either PostgREST version.
-- The regex guard matters: `current_setting(...)::uuid` raises on a malformed
-- value, and inside a policy a raised error denies the whole statement rather
-- than the single row.

create or replace function private.current_wallet_account_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $fn$
  select case
    when claim ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then claim::uuid
  end
  from (
    select coalesce(
      nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'cabi_wallet_account_id',
      nullif(current_setting('request.jwt.claim.cabi_wallet_account_id', true), '')
    ) as claim
  ) as resolved;
$fn$;

create or replace function private.current_profile_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $fn$
  select coalesce(
    (
      select case
        when claim ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then claim::uuid
      end
      from (
        select coalesce(
          nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'cabi_profile_id',
          nullif(current_setting('request.jwt.claim.cabi_profile_id', true), '')
        ) as claim
      ) as resolved
    ),
    auth.uid()
  );
$fn$;

revoke all on function private.current_wallet_account_id() from public;
revoke all on function private.current_profile_id() from public;
grant execute on function private.current_wallet_account_id() to authenticated, service_role;
grant execute on function private.current_profile_id() to authenticated, service_role;

-- 4. The four tables created in 0003 were never revoked from `anon`.
--
-- Supabase grants ALL on new public tables to anon/authenticated through ALTER
-- DEFAULT PRIVILEGES, and 0003 only added grants for `authenticated`. RLS is on
-- and there is no anon policy anywhere, so no rows leak, but this closes the
-- least-privilege gap on a fresh database.

do $$
begin
  if exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'user_memories') then
    execute 'revoke all on public.user_memories, public.bond_profiles, public.bond_events, public.cabi_state from anon, authenticated';
  end if;
end;
$$;

-- Identity sequences kept default privileges too. Nothing in the app touches
-- them through anon/authenticated, but they should not be reachable at all.
revoke all on all sequences in schema public from anon, authenticated;

commit;
