begin;

-- ===========================================================================
-- Leaderboard reads, image quota accounting, and achievement awarding.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Leaderboard.
--
-- Tie-break order is deterministic: higher XP, then whoever reached that total
-- first (`updated_at`), then wallet id. Without the last key two identical rows
-- could swap places between requests and the displayed placement would flicker.
--
-- Wallet addresses are deliberately NOT returned. The leaderboard shows a public
-- handle, so a ranking page can never expose an address.
-- ---------------------------------------------------------------------------
create or replace function public.rank_leaderboard(
  p_type text,
  p_limit integer default 100,
  p_wallet_account_id uuid default null,
  p_now timestamptz default null
)
returns table (
  placement integer,
  wallet_account_id uuid,
  username text,
  avatar_path text,
  xp bigint,
  rank_tier smallint,
  is_current_user boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := coalesce(p_now, timezone('utc', now()));
  v_season public.rank_seasons;
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 100);
begin
  if p_type not in ('WEEKLY', 'MONTHLY') then
    raise exception 'invalid season type';
  end if;

  v_season := private.ensure_rank_season(p_type, v_now);

  return query
  with ranked as (
    select
      row_number() over (order by st.xp desc, st.updated_at asc, st.wallet_account_id asc)::integer as placement,
      st.wallet_account_id,
      p.username,
      p.avatar_path,
      st.xp,
      st.rank_tier
    from public.rank_user_stats st
    join public.profiles p on p.wallet_account_id = st.wallet_account_id
    -- A flagged account keeps chatting but drops off the reward leaderboard.
    where st.season_id = v_season.id
      and st.xp > 0
      and p.ranking_status = 'NORMAL'
      and p.username is not null
  )
  select
    r.placement,
    r.wallet_account_id,
    r.username,
    r.avatar_path,
    r.xp,
    r.rank_tier,
    (p_wallet_account_id is not null and r.wallet_account_id = p_wallet_account_id)
  from ranked r
  where r.placement <= v_limit
     -- Always include the caller's own row, even outside the top N.
     or (p_wallet_account_id is not null and r.wallet_account_id = p_wallet_account_id)
  order by r.placement;
end;
$$;

revoke all on function public.rank_leaderboard(text, integer, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.rank_leaderboard(text, integer, uuid, timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- A single user's standing in one season, including placement.
-- ---------------------------------------------------------------------------
create or replace function public.rank_user_standing(
  p_type text,
  p_wallet_account_id uuid,
  p_now timestamptz default null
)
returns table (season_id uuid, placement integer, xp bigint, rank_tier smallint, participants integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := coalesce(p_now, timezone('utc', now()));
  v_season public.rank_seasons;
begin
  v_season := private.ensure_rank_season(p_type, v_now);

  return query
  with ranked as (
    select
      row_number() over (order by st.xp desc, st.updated_at asc, st.wallet_account_id asc)::integer as placement,
      st.wallet_account_id,
      st.xp,
      st.rank_tier
    from public.rank_user_stats st
    join public.profiles p on p.wallet_account_id = st.wallet_account_id
    where st.season_id = v_season.id and st.xp > 0 and p.ranking_status = 'NORMAL' and p.username is not null
  )
  select
    v_season.id,
    (select r.placement from ranked r where r.wallet_account_id = p_wallet_account_id),
    coalesce((select r.xp from ranked r where r.wallet_account_id = p_wallet_account_id), 0),
    coalesce((select r.rank_tier from ranked r where r.wallet_account_id = p_wallet_account_id), 1::smallint),
    (select count(*)::integer from ranked);
end;
$$;

revoke all on function public.rank_user_standing(text, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.rank_user_standing(text, uuid, timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- Image generation quota.
--
-- Counted in the database rather than in application memory so two concurrent
-- requests cannot both consume the last slot. Only SUCCEEDED rows count, so a
-- provider failure does not burn the user's daily allowance.
-- ---------------------------------------------------------------------------
create or replace function public.image_generation_quota(
  p_wallet_account_id uuid,
  p_daily_limit integer default 5,
  p_now timestamptz default null
)
returns table (used integer, remaining integer, allowed boolean, resets_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := coalesce(p_now, timezone('utc', now()));
  v_day timestamptz := date_trunc('day', coalesce(p_now, timezone('utc', now())));
  v_used integer;
begin
  select count(*)::integer into v_used
  from public.image_generations g
  where g.wallet_account_id = p_wallet_account_id
    and g.status = 'SUCCEEDED'
    and g.created_at >= v_day;

  return query select
    v_used,
    greatest(0, p_daily_limit - v_used),
    v_used < p_daily_limit,
    v_day + interval '1 day';
end;
$$;

revoke all on function public.image_generation_quota(uuid, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.image_generation_quota(uuid, integer, timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- Achievements. Permanent, and idempotent by primary key.
-- ---------------------------------------------------------------------------
create or replace function public.award_achievement(
  p_wallet_account_id uuid,
  p_code text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inserted integer;
begin
  if char_length(p_code) not between 1 and 40 then
    raise exception 'invalid achievement code';
  end if;
  insert into public.profile_achievements (wallet_account_id, code)
  values (p_wallet_account_id, p_code)
  on conflict do nothing;
  get diagnostics v_inserted = row_count;
  return v_inserted > 0;
end;
$$;

revoke all on function public.award_achievement(uuid, text) from public, anon, authenticated;
grant execute on function public.award_achievement(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- XP spent today, so the API can report remaining daily allowance.
-- ---------------------------------------------------------------------------
create or replace function public.rank_daily_xp_used(
  p_wallet_account_id uuid,
  p_now timestamptz default null
)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(e.xp_delta), 0)::integer
  from public.rank_xp_events e
  where e.wallet_account_id = p_wallet_account_id
    and e.xp_delta > 0
    and e.event_type <> 'ADMIN_ADJUSTMENT'
    and e.created_at >= date_trunc('day', coalesce(p_now, timezone('utc', now())));
$$;

revoke all on function public.rank_daily_xp_used(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.rank_daily_xp_used(uuid, timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- Anonymous public profile projection.
--
-- Returns only fields that are safe to show on /u/[username]: no wallet, no
-- memories, no conversation data, and the bond badge only when the owner opted
-- in.
-- ---------------------------------------------------------------------------
create or replace function public.public_profile(p_username text)
returns table (
  username text,
  avatar_path text,
  rank_tier smallint,
  season_xp bigint,
  lifetime_xp bigint,
  best_rank_tier smallint,
  best_leaderboard_position integer,
  joined_at timestamptz,
  show_bond_publicly boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.username,
    p.avatar_path,
    1::smallint,
    0::bigint,
    p.lifetime_xp,
    p.best_rank_tier,
    p.best_leaderboard_position,
    p.created_at,
    p.show_bond_publicly
  from public.profiles p
  where p.username = lower(btrim(p_username))
    and p.ranking_status <> 'INELIGIBLE'
  limit 1;
$$;

revoke all on function public.public_profile(text) from public, anon, authenticated;
grant execute on function public.public_profile(text) to service_role;

-- ---------------------------------------------------------------------------
-- Indexes the read paths rely on.
-- ---------------------------------------------------------------------------
-- Leaderboard reads filter on eligibility, so index that predicate directly.
create index if not exists profiles_ranking_status_idx on public.profiles (ranking_status) where username is not null;

commit;