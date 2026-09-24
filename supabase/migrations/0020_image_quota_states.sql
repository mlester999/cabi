begin;

-- ===========================================================================
-- Allowance counting after the lifecycle rename.
--
-- 0012 counted `status = 'SUCCEEDED'`. 0019 renamed that state to 'COMPLETED',
-- so without this the daily allowance would count nothing and a user could
-- generate without limit. This also reports today's usage and failures, which
-- the quota UI and the admin dashboard both need.
-- ===========================================================================

create or replace function public.image_generation_quota(
  p_wallet_account_id uuid,
  p_daily_limit integer default 5,
  p_now timestamptz default null
)
returns table (
  used integer,
  remaining integer,
  allowed boolean,
  resets_at timestamptz,
  daily_limit integer,
  failed_today integer,
  in_flight integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := coalesce(p_now, timezone('utc', now()));
  v_day timestamptz := date_trunc('day', coalesce(p_now, timezone('utc', now())));
  v_used integer;
  v_failed integer;
  v_in_flight integer;
begin
  -- Only COMPLETED generations consume the allowance, so a provider outage
  -- never costs the user one of their daily images.
  select count(*)::integer into v_used
  from public.image_generations g
  where g.wallet_account_id = p_wallet_account_id
    and g.status = 'COMPLETED'
    and g.created_at >= v_day;

  select count(*)::integer into v_failed
  from public.image_generations g
  where g.wallet_account_id = p_wallet_account_id
    and g.status = 'FAILED'
    and g.created_at >= v_day;

  -- Surfaced so a client can tell "still working" from "nothing happening"
  -- after a refresh.
  select count(*)::integer into v_in_flight
  from public.image_generations g
  where g.wallet_account_id = p_wallet_account_id
    and g.status in ('QUEUED', 'GENERATING')
    and g.created_at >= v_day;

  return query select
    v_used,
    greatest(0, p_daily_limit - v_used),
    v_used < p_daily_limit,
    v_day + interval '1 day',
    p_daily_limit,
    v_failed,
    v_in_flight;
end;
$$;

revoke all on function public.image_generation_quota(uuid, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.image_generation_quota(uuid, integer, timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- Admin counters: generations and failures for a UTC day across all users.
-- ---------------------------------------------------------------------------
create or replace function public.image_generation_admin_stats(p_now timestamptz default null)
returns table (completed_today integer, failed_today integer, in_flight integer, total_completed bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select count(*)::integer from public.image_generations g
      where g.status = 'COMPLETED' and g.created_at >= date_trunc('day', coalesce(p_now, timezone('utc', now())))),
    (select count(*)::integer from public.image_generations g
      where g.status = 'FAILED' and g.created_at >= date_trunc('day', coalesce(p_now, timezone('utc', now())))),
    (select count(*)::integer from public.image_generations g
      where g.status in ('QUEUED', 'GENERATING')),
    (select count(*)::bigint from public.image_generations g where g.status = 'COMPLETED');
$$;

revoke all on function public.image_generation_admin_stats(timestamptz) from public, anon, authenticated;
grant execute on function public.image_generation_admin_stats(timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- Abandoned generations.
--
-- A process that dies mid-generation leaves a row in GENERATING forever, which
-- would show the user a permanent "Cabi is making it..." card. This marks
-- anything older than the timeout as FAILED so the UI can offer a retry.
-- ---------------------------------------------------------------------------
create or replace function public.image_generation_reap_stale(p_timeout interval default '5 minutes')
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reaped integer;
begin
  update public.image_generations
  set status = 'FAILED',
      failure_code = 'TIMEOUT',
      failure_message = 'That one took too long.',
      failed_at = timezone('utc', now())
  where status in ('QUEUED', 'GENERATING')
    and created_at < timezone('utc', now()) - p_timeout;

  get diagnostics v_reaped = row_count;
  return v_reaped;
end;
$$;

revoke all on function public.image_generation_reap_stale(interval) from public, anon, authenticated;
grant execute on function public.image_generation_reap_stale(interval) to service_role;

commit;