begin;

-- ===========================================================================
-- Functions for the social progression phase.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Rank tiers. Six tiers, monthly thresholds supplied per season.
-- ---------------------------------------------------------------------------
create or replace function private.rank_tier_for_xp(p_xp bigint, p_thresholds jsonb)
returns smallint
language sql
immutable
set search_path = ''
as $$
  select case
    when p_xp >= coalesce((p_thresholds->>'LEGEND')::bigint, 18000) then 6::smallint
    when p_xp >= coalesce((p_thresholds->>'MASTER')::bigint, 9000) then 5::smallint
    when p_xp >= coalesce((p_thresholds->>'ELITE')::bigint, 4000) then 4::smallint
    when p_xp >= coalesce((p_thresholds->>'COMPANION')::bigint, 1500) then 3::smallint
    when p_xp >= coalesce((p_thresholds->>'EXPLORER')::bigint, 500) then 2::smallint
    else 1::smallint
  end;
$$;

revoke all on function private.rank_tier_for_xp(bigint, jsonb) from public;

-- ---------------------------------------------------------------------------
-- Season provisioning.
--
-- `pg_advisory_xact_lock` serialises provisioning per season type, so two
-- concurrent requests cannot race past the "is there an active season?" check.
-- The partial unique index from 0010 is the second line of defence.
-- `p_now` is injectable so the rollover behaviour is deterministic under test.
-- ---------------------------------------------------------------------------
create or replace function private.ensure_rank_season(
  p_type text,
  p_now timestamptz default null,
  p_thresholds jsonb default null
)
returns public.rank_seasons
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := coalesce(p_now, timezone('utc', now()));
  v_season public.rank_seasons;
  v_start timestamptz;
  v_end timestamptz;
  v_label text;
begin
  if p_type not in ('WEEKLY', 'MONTHLY') then
    raise exception 'invalid season type';
  end if;

  -- Serialise per type for the rest of this transaction.
  perform pg_advisory_xact_lock(hashtext('cabi_rank_season_' || p_type));

  -- Finalize everything already past its end, oldest first. This is idempotent:
  -- finalize_rank_season exits immediately for a season it already finalized.
  perform private.finalize_rank_season(s.id)
  from public.rank_seasons s
  where s.type = p_type and s.status = 'ACTIVE' and s.ends_at <= v_now
  order by s.starts_at;

  select * into v_season
  from public.rank_seasons s
  where s.type = p_type and s.status = 'ACTIVE'
  order by s.starts_at desc
  limit 1;

  -- An active season that has not expired is the current one.
  if found and v_season.ends_at > v_now then
    return v_season;
  end if;

  if p_type = 'WEEKLY' then
    -- Monday 00:00 UTC boundaries.
    v_start := date_trunc('week', v_now);
    v_end := v_start + interval '7 days';
    v_label := 'Week of ' || to_char(v_start, 'YYYY-MM-DD');
  else
    v_start := date_trunc('month', v_now);
    v_end := v_start + interval '1 month';
    v_label := to_char(v_start, 'Month YYYY');
  end if;

  insert into public.rank_seasons (type, label, starts_at, ends_at, thresholds)
  values (
    p_type,
    v_label,
    v_start,
    v_end,
    coalesce(
      p_thresholds,
      '{"EXPLORER":500,"COMPANION":1500,"ELITE":4000,"MASTER":9000,"LEGEND":18000}'::jsonb
    )
  )
  -- If a concurrent transaction won the race, take its row.
  on conflict do nothing
  returning * into v_season;

  if v_season.id is null then
    select * into v_season
    from public.rank_seasons s
    where s.type = p_type and s.status = 'ACTIVE'
    order by s.starts_at desc
    limit 1;
  end if;

  return v_season;
end;
$$;

revoke all on function private.ensure_rank_season(text, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function private.ensure_rank_season(text, timestamptz, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- Season finalization. Idempotent by construction: the UPDATE only matches a
-- season still marked ACTIVE, so a second call is a no-op.
-- ---------------------------------------------------------------------------
create or replace function private.finalize_rank_season(p_season_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_finalized uuid;
begin
  update public.rank_seasons
  set status = 'FINALIZED', finalized_at = timezone('utc', now())
  where id = p_season_id and status = 'ACTIVE'
  returning id into v_finalized;

  -- Someone else already finalized it.
  if v_finalized is null then
    return;
  end if;

  -- Freeze final placements for everyone who earned XP in this season.
  with ranked as (
    select
      st.wallet_account_id,
      st.xp,
      row_number() over (order by st.xp desc, st.updated_at asc, st.wallet_account_id asc) as placement
    from public.rank_user_stats st
    where st.season_id = p_season_id and st.xp > 0
  )
  update public.rank_user_stats st
  set position_snapshot = ranked.placement
  from ranked
  where st.season_id = p_season_id and st.wallet_account_id = ranked.wallet_account_id;

  -- Snapshot the top finishers for the manual reward workflow. Reward status
  -- starts PENDING and is only ever changed by an admin.
  insert into public.rank_reward_snapshots (season_id, wallet_account_id, placement, xp, username, wallet_address)
  select
    p_season_id,
    st.wallet_account_id,
    st.position_snapshot,
    st.xp,
    p.username,
    wa.wallet_address
  from public.rank_user_stats st
  join public.profiles p on p.wallet_account_id = st.wallet_account_id
  left join public.wallet_accounts wa on wa.id = st.wallet_account_id
  where st.season_id = p_season_id
    and st.position_snapshot is not null
    and st.position_snapshot <= 100
    and p.ranking_status = 'NORMAL'
  on conflict (season_id, placement) do nothing;

  -- Record the best-ever position per user.
  update public.profiles p
  set best_leaderboard_position = least(
        coalesce(p.best_leaderboard_position, st.position_snapshot),
        st.position_snapshot
      ),
      updated_at = timezone('utc', now())
  from public.rank_user_stats st
  where st.season_id = p_season_id
    and st.wallet_account_id = p.wallet_account_id
    and st.position_snapshot is not null;
end;
$$;

revoke all on function private.finalize_rank_season(uuid) from public, anon, authenticated;
grant execute on function private.finalize_rank_season(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- The XP award path.
--
-- This is the ONLY way XP changes. It:
--   1. resolves (and rolls over if needed) the current seasons,
--   2. enforces a daily effective cap on positive awards,
--   3. applies a daily cap specifically for image-generation awards,
--   4. writes an immutable ledger row for every change,
--   5. updates season stats, lifetime XP, rank tier, and best tier.
--
-- Rank never depends on token ownership, balance, or trading. The only inputs
-- are product activity signals computed server-side.
-- ---------------------------------------------------------------------------
create or replace function public.award_rank_xp(
  p_wallet_account_id uuid,
  p_xp integer,
  p_event_type text,
  p_reason_code text default 'GENERAL',
  p_conversation_id uuid default null,
  p_message_id uuid default null,
  p_content_fingerprint text default null,
  -- Null means "read the admin setting". An explicit value is used for tests.
  p_daily_cap integer default null,
  p_image_daily_cap integer default 5,
  p_now timestamptz default null
)
returns table (awarded integer, season_xp bigint, lifetime_xp bigint, rank_tier smallint, previous_tier smallint, capped boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := coalesce(p_now, timezone('utc', now()));
  v_today timestamptz := date_trunc('day', coalesce(p_now, timezone('utc', now())));
  v_weekly public.rank_seasons;
  v_monthly public.rank_seasons;
  v_earned_today integer;
  v_image_today integer;
  v_allowed integer;
  v_tier smallint;
  v_prev_tier smallint;
  v_season_xp bigint;
  v_lifetime bigint;
  v_capped boolean := false;
  v_cap integer;
begin
  if not exists (select 1 from public.wallet_accounts wa where wa.id = p_wallet_account_id) then
    raise exception 'wallet account not found';
  end if;
  if p_event_type not in (
    'CHAT_MEANINGFUL', 'CHAT_HIGH_QUALITY', 'CHAT_FOLLOWUP', 'MEMORY_INTERACTION',
    'IMAGE_GENERATION', 'FEATURE_DISCOVERY', 'SPAM_DUPLICATE', 'SPAM_RATE_LIMIT',
    'ADMIN_ADJUSTMENT', 'MILESTONE', 'ACHIEVEMENT'
  ) then
    raise exception 'invalid xp event type';
  end if;

  -- Thresholds come from the admin tuning setting. A season freezes them at
  -- creation, so an edit applies from the next season onward rather than
  -- rewriting the board currently being raced.
  v_weekly := private.ensure_rank_season('WEEKLY', v_now, private.rank_thresholds());
  v_monthly := private.ensure_rank_season('MONTHLY', v_now, private.rank_thresholds());

  v_allowed := p_xp;
  -- Resolve the cap once so both the check and the reported state agree.
  v_cap := coalesce(p_daily_cap, (public.rank_tuning_view()).daily_xp_cap);

  -- Caps apply only to positive, non-admin awards. An admin adjustment is an
  -- explicit human decision and bypasses the automatic caps (it is audited).
  if p_xp > 0 and p_event_type <> 'ADMIN_ADJUSTMENT' then
    select coalesce(sum(e.xp_delta), 0) into v_earned_today
    from public.rank_xp_events e
    where e.wallet_account_id = p_wallet_account_id
      and e.xp_delta > 0
      and e.event_type <> 'ADMIN_ADJUSTMENT'
      and e.created_at >= v_today;

    v_allowed := least(v_allowed, greatest(0, v_cap - v_earned_today));

    -- Image generation gets its own much tighter cap so expensive API usage can
    -- never become a way to farm the leaderboard.
    if p_event_type = 'IMAGE_GENERATION' then
      select count(*) into v_image_today
      from public.rank_xp_events e
      where e.wallet_account_id = p_wallet_account_id
        and e.event_type = 'IMAGE_GENERATION'
        and e.created_at >= v_today;
      if v_image_today >= p_image_daily_cap then
        v_allowed := 0;
      end if;
    end if;

    if v_allowed < p_xp then
      v_capped := true;
    end if;
  end if;

  -- Nothing to record (fully capped). Report the current state without writing.
  if v_allowed = 0 and p_xp >= 0 then
    select st.xp, private.rank_tier_for_xp(st.xp, v_monthly.thresholds)
      into v_season_xp, v_prev_tier
    from public.rank_user_stats st
    where st.season_id = v_monthly.id and st.wallet_account_id = p_wallet_account_id;

    select p.lifetime_xp into v_lifetime from public.profiles p where p.wallet_account_id = p_wallet_account_id;

    return query select 0, coalesce(v_season_xp, 0), coalesce(v_lifetime, 0), coalesce(v_prev_tier, 1::smallint), coalesce(v_prev_tier, 1::smallint), v_capped;
    return;
  end if;

  insert into public.rank_xp_events (
    season_id, wallet_account_id, conversation_id, message_id,
    xp_delta, event_type, reason_code, content_fingerprint, created_at
  ) values (
    v_monthly.id, p_wallet_account_id, p_conversation_id, p_message_id,
    v_allowed, p_event_type, left(coalesce(p_reason_code, 'GENERAL'), 60), p_content_fingerprint, v_now
  );

  -- Capture the tier the user held BEFORE this award, so the caller can tell
  -- whether this event caused a rank-up.
  select private.rank_tier_for_xp(st.xp, v_monthly.thresholds)
    into v_prev_tier
  from public.rank_user_stats st
  where st.season_id = v_monthly.id and st.wallet_account_id = p_wallet_account_id;
  if v_prev_tier is null then
    v_prev_tier := 1;
  end if;

  -- Monthly season stats.
  insert into public.rank_user_stats (season_id, wallet_account_id, xp, rank_tier, updated_at)
  values (v_monthly.id, p_wallet_account_id, greatest(v_allowed, 0), 1, v_now)
  on conflict (season_id, wallet_account_id) do update
    set xp = greatest(0, public.rank_user_stats.xp + v_allowed),
        updated_at = v_now;

  -- Weekly leaderboard stats.
  insert into public.rank_user_stats (season_id, wallet_account_id, xp, rank_tier, updated_at)
  values (v_weekly.id, p_wallet_account_id, greatest(v_allowed, 0), 1, v_now)
  on conflict (season_id, wallet_account_id) do update
    set xp = greatest(0, public.rank_user_stats.xp + v_allowed),
        updated_at = v_now;

  select st.xp into v_season_xp
  from public.rank_user_stats st
  where st.season_id = v_monthly.id and st.wallet_account_id = p_wallet_account_id;

  v_tier := private.rank_tier_for_xp(v_season_xp, v_monthly.thresholds);

  update public.rank_user_stats
  set rank_tier = v_tier
  where season_id = v_monthly.id and wallet_account_id = p_wallet_account_id;

  update public.profiles p
  set lifetime_xp = greatest(0, p.lifetime_xp + v_allowed),
      best_rank_tier = greatest(coalesce(p.best_rank_tier, 1), v_tier),
      updated_at = v_now
  where p.wallet_account_id = p_wallet_account_id
  returning p.lifetime_xp into v_lifetime;

  return query select v_allowed, coalesce(v_season_xp, 0), coalesce(v_lifetime, 0), v_tier, v_prev_tier, v_capped;
end;
$$;

revoke all on function public.award_rank_xp(uuid, integer, text, text, uuid, uuid, text, integer, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.award_rank_xp(uuid, integer, text, text, uuid, uuid, text, integer, integer, timestamptz) to service_role;

commit;