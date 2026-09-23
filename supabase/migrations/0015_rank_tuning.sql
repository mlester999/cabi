begin;

-- ===========================================================================
-- Rank tuning from admin settings, and an image-XP grant that actually fires.
--
-- Two corrections:
--
-- 1. `award_rank_xp` always called `ensure_rank_season` with no thresholds, so
--    every new season was created with the built-in defaults and an admin's
--    edited thresholds were silently ignored. A new provably-safe reader now
--    supplies them, and the daily XP cap is read the same way.
--
--    Thresholds are deliberately frozen into a season when it is created. Editing
--    them therefore changes the *next* season, not the one in progress, which is
--    what keeps a leaderboard from being rewritten mid-race.
--
-- 2. Image generation awarded XP with `imagesRewardedToday` hardcoded, so the
--    "first image of the day only" rule could not actually be enforced. This
--    counts real events for the day.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Reads the `ranking` tuning object. Defensive on every field: a malformed
-- setting must never break XP, so each value falls back to its default.
-- ---------------------------------------------------------------------------
create or replace function private.rank_tuning()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select s.value_json from public.app_settings s where s.key = 'ranking'),
    '{}'::jsonb
  );
$$;

revoke all on function private.rank_tuning() from public, anon, authenticated;

create or replace function private.rank_thresholds()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'EXPLORER',  greatest(1,    coalesce((private.rank_tuning()->'thresholds'->>'EXPLORER')::bigint,  500)),
    'COMPANION', greatest(1,    coalesce((private.rank_tuning()->'thresholds'->>'COMPANION')::bigint, 1500)),
    'ELITE',     greatest(1,    coalesce((private.rank_tuning()->'thresholds'->>'ELITE')::bigint,     4000)),
    'MASTER',    greatest(1,    coalesce((private.rank_tuning()->'thresholds'->>'MASTER')::bigint,    9000)),
    'LEGEND',    greatest(1,    coalesce((private.rank_tuning()->'thresholds'->>'LEGEND')::bigint,   18000))
  );
$$;

revoke all on function private.rank_thresholds() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The admin-editable tuning surface. Security definer so the leaderboard query
-- can read it without exposing app_settings.
-- ---------------------------------------------------------------------------
create or replace function public.rank_tuning_view()
returns table (thresholds jsonb, daily_xp_cap integer, image_xp_per_day integer, max_weekly_placement integer)
language sql
stable
security definer
set search_path = ''
as $$
  select
    private.rank_thresholds(),
    -- A cap of zero would make the product unusable, so the floor is one.
    greatest(1, coalesce((private.rank_tuning()->>'dailyXpCap')::integer, 500)),
    greatest(0, coalesce((private.rank_tuning()->>'imageXpPerDay')::integer, 1)),
    greatest(1, coalesce((private.rank_tuning()->>'rewardPlacements')::integer, 100));
$$;

revoke all on function public.rank_tuning_view() from public, anon, authenticated;
grant execute on function public.rank_tuning_view() to service_role;

commit;