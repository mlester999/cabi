-- Fix tuning lookup in award_rank_xp. The set-returning view function must be selected
-- into local variables before COALESCE can use its values.

create or replace function public.award_rank_xp(
  p_wallet_account_id uuid,
  p_xp integer,
  p_event_type text,
  p_reason_code text default 'GENERAL',
  p_conversation_id uuid default null,
  p_message_id uuid default null,
  p_content_fingerprint text default null,
  p_daily_cap integer default null,
  p_image_daily_cap integer default null,
  p_now timestamptz default null,
  p_quality_score integer default null
)
returns table (awarded integer, season_xp bigint, lifetime_xp bigint, rank_tier smallint, previous_tier smallint, capped boolean)
language plpgsql security definer set search_path = ''
as $$
declare
  v_now timestamptz := coalesce(p_now, timezone('utc', now()));
  v_today timestamptz;
  v_weekly public.rank_seasons;
  v_monthly public.rank_seasons;
  v_earned_today integer := 0;
  v_image_today integer := 0;
  v_allowed integer := p_xp;
  v_tier smallint;
  v_prev_tier smallint;
  v_season_xp bigint := 0;
  v_weekly_xp bigint := 0;
  v_lifetime bigint := 0;
  v_capped boolean := false;
  v_cap integer;
  v_image_cap integer;
  v_duplicate boolean := false;
begin
  if p_xp is null or abs(p_xp) > 100000 then raise exception 'invalid xp amount'; end if;
  if p_quality_score is not null and (p_quality_score < 0 or p_quality_score > 3) then raise exception 'invalid quality score'; end if;
  if not exists (select 1 from public.wallet_accounts wa where wa.id = p_wallet_account_id) then raise exception 'wallet account not found'; end if;
  if p_event_type not in ('CHAT_MEANINGFUL','CHAT_HIGH_QUALITY','CHAT_FOLLOWUP','MEMORY_INTERACTION','IMAGE_GENERATION','FEATURE_DISCOVERY','SPAM_DUPLICATE','SPAM_RATE_LIMIT','ADMIN_ADJUSTMENT','MILESTONE','ACHIEVEMENT') then
    raise exception 'invalid xp event type';
  end if;

  perform pg_advisory_xact_lock(hashtext('cabi_xp_account_' || p_wallet_account_id::text));
  v_today := date_trunc('day', v_now at time zone 'UTC') at time zone 'UTC';
  v_weekly := private.ensure_rank_season('WEEKLY', v_now, private.rank_thresholds());
  v_monthly := private.ensure_rank_season('MONTHLY', v_now, private.rank_thresholds());
  select daily_xp_cap, image_xp_per_day into v_cap, v_image_cap
  from public.rank_tuning_view();
  v_cap := coalesce(p_daily_cap, v_cap);
  v_image_cap := coalesce(p_image_daily_cap, v_image_cap);

  -- A saved chat message can produce at most one award, even if the stream is retried.
  if p_message_id is not null and exists (
    select 1 from public.rank_xp_events e where e.wallet_account_id = p_wallet_account_id and e.message_id = p_message_id
  ) then
    select coalesce(st.xp, 0) into v_season_xp from public.rank_user_stats st where st.season_id = v_monthly.id and st.wallet_account_id = p_wallet_account_id;
    select coalesce(st.xp, 0) into v_weekly_xp from public.rank_user_stats st where st.season_id = v_weekly.id and st.wallet_account_id = p_wallet_account_id;
    select coalesce(p.lifetime_xp, 0) into v_lifetime from public.profiles p where p.wallet_account_id = p_wallet_account_id;
    v_tier := private.rank_tier_for_xp(v_lifetime, private.rank_thresholds());
    return query select 0, v_season_xp, v_lifetime, v_tier, v_tier, false;
    return;
  end if;

  -- An owner may block future automatic awards without blocking chat. Admin
  -- adjustments remain available for audited corrections and rewards.
  if p_event_type <> 'ADMIN_ADJUSTMENT' and exists (
    select 1 from public.profiles p
    where p.wallet_account_id = p_wallet_account_id and p.ranking_status = 'INELIGIBLE'
  ) then
    insert into public.rank_xp_events (season_id, weekly_period_id, monthly_period_id, wallet_account_id, conversation_id, message_id, xp_delta, event_type, reason_code, content_fingerprint, quality_score, created_at)
    values (v_monthly.id, v_weekly.id, v_monthly.id, p_wallet_account_id, p_conversation_id, p_message_id, 0, p_event_type, 'RANKING_INELIGIBLE', p_content_fingerprint, p_quality_score, v_now);
    select coalesce(st.xp, 0) into v_season_xp from public.rank_user_stats st where st.season_id = v_monthly.id and st.wallet_account_id = p_wallet_account_id;
    select coalesce(st.xp, 0) into v_weekly_xp from public.rank_user_stats st where st.season_id = v_weekly.id and st.wallet_account_id = p_wallet_account_id;
    select coalesce(p.lifetime_xp, 0) into v_lifetime from public.profiles p where p.wallet_account_id = p_wallet_account_id;
    v_tier := private.rank_tier_for_xp(v_lifetime, private.rank_thresholds());
    return query select 0, v_season_xp, v_lifetime, v_tier, v_tier, false;
    return;
  end if;

  if p_event_type = 'SPAM_DUPLICATE' and p_xp = 0 then
    insert into public.rank_xp_events (season_id, weekly_period_id, monthly_period_id, wallet_account_id, conversation_id, message_id, xp_delta, event_type, reason_code, content_fingerprint, quality_score, created_at)
    values (v_monthly.id, v_weekly.id, v_monthly.id, p_wallet_account_id, p_conversation_id, p_message_id, 0, 'SPAM_DUPLICATE', left(coalesce(p_reason_code, 'DUPLICATE_MESSAGE'), 60), p_content_fingerprint, coalesce(p_quality_score, 0), v_now);
    select coalesce(st.xp, 0) into v_season_xp from public.rank_user_stats st where st.season_id = v_monthly.id and st.wallet_account_id = p_wallet_account_id;
    select coalesce(st.xp, 0) into v_weekly_xp from public.rank_user_stats st where st.season_id = v_weekly.id and st.wallet_account_id = p_wallet_account_id;
    select coalesce(p.lifetime_xp, 0) into v_lifetime from public.profiles p where p.wallet_account_id = p_wallet_account_id;
    v_tier := private.rank_tier_for_xp(v_lifetime, private.rank_thresholds());
    return query select 0, v_season_xp, v_lifetime, v_tier, v_tier, false;
    return;
  end if;

  if p_xp > 0 and p_event_type <> 'ADMIN_ADJUSTMENT' then
    select coalesce(sum(e.xp_delta), 0)::integer into v_earned_today
    from public.rank_xp_events e
    where e.wallet_account_id = p_wallet_account_id and e.xp_delta > 0
      and e.event_type <> 'ADMIN_ADJUSTMENT' and e.created_at >= v_today;
    v_allowed := least(v_allowed, greatest(0, v_cap - v_earned_today));

    if p_event_type = 'IMAGE_GENERATION' then
      select count(*)::integer into v_image_today from public.rank_xp_events e
      where e.wallet_account_id = p_wallet_account_id and e.event_type = 'IMAGE_GENERATION'
        and e.xp_delta > 0 and e.created_at >= v_today;
      if v_image_today >= v_image_cap then v_allowed := 0; end if;
    end if;
    v_capped := v_allowed < p_xp;
  end if;

  -- Exact repeats across different conversations are suppressed for 24 hours.
  if p_xp > 0 and p_event_type in ('CHAT_MEANINGFUL','CHAT_HIGH_QUALITY','CHAT_FOLLOWUP','MEMORY_INTERACTION','FEATURE_DISCOVERY')
    and p_content_fingerprint is not null then
    select exists(
      select 1 from public.rank_xp_events e
      where e.wallet_account_id = p_wallet_account_id and e.content_fingerprint = p_content_fingerprint
        and e.created_at >= v_now - interval '24 hours' and e.xp_delta > 0
    ) into v_duplicate;
  end if;

  if v_duplicate then
    insert into public.rank_xp_events (season_id, weekly_period_id, monthly_period_id, wallet_account_id, conversation_id, message_id, xp_delta, event_type, reason_code, content_fingerprint, quality_score, created_at)
    values (v_monthly.id, v_weekly.id, v_monthly.id, p_wallet_account_id, p_conversation_id, p_message_id, 0, 'SPAM_DUPLICATE', 'DUPLICATE_MESSAGE', p_content_fingerprint, coalesce(p_quality_score, 0), v_now);
    v_allowed := 0;
    v_capped := false;
  elsif v_allowed = 0 and p_xp > 0 and v_capped then
    -- Zero-value cap records power the admin review view without changing totals.
    insert into public.rank_xp_events (season_id, weekly_period_id, monthly_period_id, wallet_account_id, conversation_id, message_id, xp_delta, event_type, reason_code, content_fingerprint, quality_score, created_at)
    values (v_monthly.id, v_weekly.id, v_monthly.id, p_wallet_account_id, p_conversation_id, p_message_id, 0, p_event_type, 'DAILY_CAP', p_content_fingerprint, p_quality_score, v_now);
  end if;

  if v_allowed = 0 and p_xp >= 0 then
    -- Keep a body-free quality record for a low-effort zero award. Duplicate
    -- and cap rows were already written above, so avoid writing them twice.
    if not v_duplicate and not v_capped then
      insert into public.rank_xp_events (season_id, weekly_period_id, monthly_period_id, wallet_account_id, conversation_id, message_id, xp_delta, event_type, reason_code, content_fingerprint, quality_score, created_at)
      values (v_monthly.id, v_weekly.id, v_monthly.id, p_wallet_account_id, p_conversation_id, p_message_id, 0, p_event_type, left(coalesce(p_reason_code, 'GENERAL'), 60), p_content_fingerprint, p_quality_score, v_now);
    end if;
    select coalesce(st.xp, 0) into v_season_xp from public.rank_user_stats st where st.season_id = v_monthly.id and st.wallet_account_id = p_wallet_account_id;
    select coalesce(st.xp, 0) into v_weekly_xp from public.rank_user_stats st where st.season_id = v_weekly.id and st.wallet_account_id = p_wallet_account_id;
    select coalesce(p.lifetime_xp, 0) into v_lifetime from public.profiles p where p.wallet_account_id = p_wallet_account_id;
    v_tier := private.rank_tier_for_xp(v_lifetime, private.rank_thresholds());
    return query select 0, v_season_xp, v_lifetime, v_tier, v_tier, v_capped;
    return;
  end if;

  select private.rank_tier_for_xp(p.lifetime_xp, private.rank_thresholds()) into v_prev_tier
  from public.profiles p where p.wallet_account_id = p_wallet_account_id;
  v_prev_tier := coalesce(v_prev_tier, 1);

  insert into public.rank_xp_events (season_id, weekly_period_id, monthly_period_id, wallet_account_id, conversation_id, message_id, xp_delta, event_type, reason_code, content_fingerprint, quality_score, created_at)
  values (v_monthly.id, v_weekly.id, v_monthly.id, p_wallet_account_id, p_conversation_id, p_message_id, v_allowed, p_event_type, left(coalesce(p_reason_code, 'GENERAL'), 60), p_content_fingerprint, p_quality_score, v_now);

  insert into public.rank_user_stats (season_id, wallet_account_id, xp, rank_tier, score_reached_at, updated_at)
  values (v_monthly.id, p_wallet_account_id, greatest(v_allowed, 0), v_prev_tier, v_now, v_now)
  on conflict (season_id, wallet_account_id) do update set
    xp = greatest(0, public.rank_user_stats.xp + v_allowed),
    score_reached_at = case when greatest(0, public.rank_user_stats.xp + v_allowed) > public.rank_user_stats.xp then v_now else coalesce(public.rank_user_stats.score_reached_at, v_now) end,
    updated_at = v_now;
  insert into public.rank_user_stats (season_id, wallet_account_id, xp, rank_tier, score_reached_at, updated_at)
  values (v_weekly.id, p_wallet_account_id, greatest(v_allowed, 0), v_prev_tier, v_now, v_now)
  on conflict (season_id, wallet_account_id) do update set
    xp = greatest(0, public.rank_user_stats.xp + v_allowed),
    score_reached_at = case when greatest(0, public.rank_user_stats.xp + v_allowed) > public.rank_user_stats.xp then v_now else coalesce(public.rank_user_stats.score_reached_at, v_now) end,
    updated_at = v_now;

  update public.profiles p set lifetime_xp = greatest(0, p.lifetime_xp + v_allowed), updated_at = v_now
  where p.wallet_account_id = p_wallet_account_id returning p.lifetime_xp into v_lifetime;
  v_tier := private.rank_tier_for_xp(v_lifetime, private.rank_thresholds());
  update public.profiles set best_rank_tier = greatest(coalesce(best_rank_tier, 1), v_tier) where wallet_account_id = p_wallet_account_id;
  update public.rank_user_stats set rank_tier = v_tier where wallet_account_id = p_wallet_account_id and season_id in (v_weekly.id, v_monthly.id);

  select st.xp into v_season_xp from public.rank_user_stats st where st.season_id = v_monthly.id and st.wallet_account_id = p_wallet_account_id;
  return query select v_allowed, coalesce(v_season_xp, 0), coalesce(v_lifetime, 0), v_tier, v_prev_tier, v_capped;
end;
$$;
revoke all on function public.award_rank_xp(uuid, integer, text, text, uuid, uuid, text, integer, integer, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.award_rank_xp(uuid, integer, text, text, uuid, uuid, text, integer, integer, timestamptz, integer) to service_role;
