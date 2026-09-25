begin;

-- Promote the existing rank ledger and period tables to the live product model.
-- The ledger remains append-only; weekly/monthly counters remain separate, and
-- rank is always derived from lifetime XP.

-- Release both existing gates in persisted settings as well as in code defaults.
update public.app_settings
set value_json = jsonb_set(
  jsonb_set(coalesce(value_json, '{}'::jsonb), '{leaderboard_enabled}', 'true'::jsonb, true),
  '{ranking_enabled}', 'true'::jsonb, true
), updated_at = timezone('utc', now())
where key = 'feature_flags';

-- Upgrade default tuning values while preserving settings the owner had changed.
update public.app_settings s
set value_json = jsonb_set(
  jsonb_set(
    coalesce(s.value_json, '{}'::jsonb),
    '{thresholds}',
    jsonb_build_object(
      'FAMILIAR', coalesce((s.value_json->'thresholds'->>'FAMILIAR')::integer,
        case when (s.value_json->'thresholds'->>'EXPLORER')::integer = 500 then 500 else (s.value_json->'thresholds'->>'EXPLORER')::integer end, 500),
      'COMPANION', coalesce((s.value_json->'thresholds'->>'COMPANION')::integer,
        case when (s.value_json->'thresholds'->>'COMPANION')::integer = 1500 then 2000 else (s.value_json->'thresholds'->>'COMPANION')::integer end, 2000),
      'ELITE', coalesce((s.value_json->'thresholds'->>'ELITE')::integer,
        case when (s.value_json->'thresholds'->>'ELITE')::integer = 4000 then 6000 else (s.value_json->'thresholds'->>'ELITE')::integer end, 6000),
      'MASTER', coalesce((s.value_json->'thresholds'->>'MASTER')::integer,
        case when (s.value_json->'thresholds'->>'MASTER')::integer = 9000 then 15000 else (s.value_json->'thresholds'->>'MASTER')::integer end, 15000),
      'LEGEND', coalesce((s.value_json->'thresholds'->>'LEGEND')::integer,
        case when (s.value_json->'thresholds'->>'LEGEND')::integer = 18000 then 35000 else (s.value_json->'thresholds'->>'LEGEND')::integer end, 35000)
    ), true
  ),
  '{dailyXpCap}', case when coalesce((s.value_json->>'dailyXpCap')::integer, 500) = 500 then '300'::jsonb else to_jsonb((s.value_json->>'dailyXpCap')::integer) end,
  true
), updated_by = coalesce(s.updated_by, 'migration:0024'), updated_at = timezone('utc', now())
where s.key = 'ranking';

-- Migrate rows that used the default monthly thresholds to the new defaults.
update public.rank_seasons
set thresholds = jsonb_build_object(
  'FAMILIAR', case when coalesce((thresholds->>'EXPLORER')::integer, 500) = 500 then 500 else (thresholds->>'EXPLORER')::integer end,
  'COMPANION', case when coalesce((thresholds->>'COMPANION')::integer, 1500) = 1500 then 2000 else (thresholds->>'COMPANION')::integer end,
  'ELITE', case when coalesce((thresholds->>'ELITE')::integer, 4000) = 4000 then 6000 else (thresholds->>'ELITE')::integer end,
  'MASTER', case when coalesce((thresholds->>'MASTER')::integer, 9000) = 9000 then 15000 else (thresholds->>'MASTER')::integer end,
  'LEGEND', case when coalesce((thresholds->>'LEGEND')::integer, 18000) = 18000 then 35000 else (thresholds->>'LEGEND')::integer end
)
where thresholds ? 'EXPLORER' or not (thresholds ? 'FAMILIAR');

-- Period attribution is explicit for reliable reporting/recalculation. The old
-- season_id column is retained as the monthly-period compatibility column.
alter table public.rank_xp_events
  add column if not exists weekly_period_id uuid references public.rank_seasons(id) on delete set null,
  add column if not exists monthly_period_id uuid references public.rank_seasons(id) on delete set null,
  add column if not exists quality_score smallint check (quality_score between 0 and 3);
comment on column public.rank_xp_events.quality_score is 'Server-evaluated effort band: 0 low, 1 normal, 2 good, 3 great. Null for legacy or non-conversation events. Message bodies are never stored.';

update public.rank_xp_events e
set monthly_period_id = coalesce(e.monthly_period_id, e.season_id)
where e.monthly_period_id is null;

update public.rank_xp_events e
set weekly_period_id = s.id
from public.rank_seasons s
where s.type = 'WEEKLY'
  and e.weekly_period_id is null
  and e.created_at >= s.starts_at and e.created_at < s.ends_at;

create index if not exists rank_xp_events_weekly_period_idx
  on public.rank_xp_events (weekly_period_id, wallet_account_id, created_at, id);
create index if not exists rank_xp_events_monthly_period_idx
  on public.rank_xp_events (monthly_period_id, wallet_account_id, created_at, id);

alter table public.rank_user_stats add column if not exists score_reached_at timestamptz;
update public.rank_user_stats set score_reached_at = updated_at where score_reached_at is null;
create index if not exists rank_user_stats_period_tiebreak_idx
  on public.rank_user_stats (season_id, xp desc, score_reached_at asc, wallet_account_id asc);

-- Immutable, profile-independent final standings. Admin reward records remain
-- separate because their payout status is intentionally editable and manual.
create table if not exists public.rank_leaderboard_results (
  period_id uuid not null references public.rank_seasons(id) on delete restrict,
  position integer not null check (position >= 1),
  wallet_account_id uuid,
  display_name_snapshot text not null,
  xp bigint not null check (xp >= 0),
  rank_tier_snapshot smallint not null check (rank_tier_snapshot between 1 and 6),
  finalized_at timestamptz not null,
  primary key (period_id, position),
  unique (period_id, wallet_account_id)
);
create index if not exists rank_leaderboard_results_account_idx
  on public.rank_leaderboard_results (wallet_account_id, finalized_at desc);
alter table public.rank_leaderboard_results enable row level security;
revoke all on public.rank_leaderboard_results from anon, authenticated;

create or replace function private.prevent_leaderboard_result_mutation()
returns trigger language plpgsql security definer set search_path = ''
as $$ begin raise exception 'leaderboard result snapshots are immutable'; end; $$;
revoke all on function private.prevent_leaderboard_result_mutation() from public, anon, authenticated;
drop trigger if exists rank_leaderboard_results_immutable on public.rank_leaderboard_results;
create trigger rank_leaderboard_results_immutable
  before update or delete on public.rank_leaderboard_results
  for each row execute function private.prevent_leaderboard_result_mutation();

-- Six lifetime tiers. Season thresholds no longer reset a user's rank.
create or replace function private.rank_tier_for_xp(p_xp bigint, p_thresholds jsonb)
returns smallint language sql immutable set search_path = ''
as $$
  select case
    when p_xp >= coalesce((p_thresholds->>'LEGEND')::bigint, 35000) then 6::smallint
    when p_xp >= coalesce((p_thresholds->>'MASTER')::bigint, 15000) then 5::smallint
    when p_xp >= coalesce((p_thresholds->>'ELITE')::bigint, 6000) then 4::smallint
    when p_xp >= coalesce((p_thresholds->>'COMPANION')::bigint, 2000) then 3::smallint
    when p_xp >= coalesce((p_thresholds->>'FAMILIAR')::bigint, 500) then 2::smallint
    else 1::smallint
  end;
$$;
revoke all on function private.rank_tier_for_xp(bigint, jsonb) from public, anon, authenticated;

create or replace function private.rank_thresholds()
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'FAMILIAR', greatest(1, coalesce((private.rank_tuning()->'thresholds'->>'FAMILIAR')::bigint, 500)),
    'COMPANION', greatest(1, coalesce((private.rank_tuning()->'thresholds'->>'COMPANION')::bigint, 2000)),
    'ELITE', greatest(1, coalesce((private.rank_tuning()->'thresholds'->>'ELITE')::bigint, 6000)),
    'MASTER', greatest(1, coalesce((private.rank_tuning()->'thresholds'->>'MASTER')::bigint, 15000)),
    'LEGEND', greatest(1, coalesce((private.rank_tuning()->'thresholds'->>'LEGEND')::bigint, 35000))
  );
$$;
revoke all on function private.rank_thresholds() from public, anon, authenticated;

-- Bring permanent tier summaries forward without touching historical period XP.
update public.profiles p
set best_rank_tier = private.rank_tier_for_xp(p.lifetime_xp, private.rank_thresholds());
update public.rank_user_stats st
set rank_tier = private.rank_tier_for_xp(p.lifetime_xp, private.rank_thresholds())
from public.profiles p, public.rank_seasons s
where p.wallet_account_id = st.wallet_account_id
  and s.id = st.season_id and s.status = 'ACTIVE';

create or replace function public.rank_tuning_view()
returns table (thresholds jsonb, daily_xp_cap integer, image_xp_per_day integer, max_weekly_placement integer)
language sql stable security definer set search_path = ''
as $$
  select private.rank_thresholds(),
    greatest(1, coalesce((private.rank_tuning()->>'dailyXpCap')::integer, 300)),
    greatest(0, coalesce((private.rank_tuning()->>'imageXpPerDay')::integer, 1)),
    greatest(1, coalesce((private.rank_tuning()->>'rewardPlacements')::integer, 100));
$$;
revoke all on function public.rank_tuning_view() from public, anon, authenticated;
grant execute on function public.rank_tuning_view() to service_role;

-- A period read or XP award is enough to roll periods forward. Boundaries are
-- Monday 00:00 UTC and calendar-month 00:00 UTC.
create or replace function private.ensure_rank_season(
  p_type text, p_now timestamptz default null, p_thresholds jsonb default null
)
returns public.rank_seasons language plpgsql security definer set search_path = ''
as $$
declare
  v_now timestamptz := coalesce(p_now, timezone('utc', now()));
  v_season public.rank_seasons;
  v_start timestamptz;
  v_end timestamptz;
  v_label text;
begin
  if p_type not in ('WEEKLY', 'MONTHLY') then raise exception 'invalid season type'; end if;
  perform pg_advisory_xact_lock(hashtext('cabi_rank_season_' || p_type));
  perform private.finalize_rank_season(s.id)
  from public.rank_seasons s
  where s.type = p_type and s.status = 'ACTIVE' and s.ends_at <= v_now
  order by s.starts_at;

  select * into v_season from public.rank_seasons s
  where s.type = p_type and s.status = 'ACTIVE'
  order by s.starts_at desc limit 1;
  if found and v_season.ends_at > v_now then return v_season; end if;

  if p_type = 'WEEKLY' then
    v_start := date_trunc('week', v_now at time zone 'UTC') at time zone 'UTC';
    v_end := v_start + interval '7 days';
    v_label := 'Week of ' || to_char(v_start at time zone 'UTC', 'YYYY-MM-DD');
  else
    v_start := date_trunc('month', v_now at time zone 'UTC') at time zone 'UTC';
    v_end := v_start + interval '1 month';
    v_label := to_char(v_start at time zone 'UTC', 'Month YYYY');
  end if;
  insert into public.rank_seasons (type, label, starts_at, ends_at, thresholds)
  values (p_type, v_label, v_start, v_end, coalesce(p_thresholds, private.rank_thresholds()))
  on conflict do nothing returning * into v_season;
  if v_season.id is null then
    select * into v_season from public.rank_seasons s
    where s.type = p_type and s.status = 'ACTIVE' order by s.starts_at desc limit 1;
  end if;
  return v_season;
end;
$$;
revoke all on function private.ensure_rank_season(text, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function private.ensure_rank_season(text, timestamptz, jsonb) to service_role;

-- Tie order in all live and frozen results: XP descending, first time the final
-- score was reached, then the stable wallet-account UUID.
create or replace function private.finalize_rank_season(p_season_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_finalized timestamptz := timezone('utc', now());
  v_period public.rank_seasons;
  v_reward_placements integer := greatest(1, coalesce((private.rank_tuning()->>'rewardPlacements')::integer, 100));
begin
  update public.rank_seasons set status = 'FINALIZED', finalized_at = v_finalized
  where id = p_season_id and status = 'ACTIVE' returning * into v_period;
  if v_period.id is null then return; end if;

  with ranked as (
    select st.wallet_account_id, st.xp,
      row_number() over (order by st.xp desc, coalesce(st.score_reached_at, st.updated_at) asc, st.wallet_account_id asc)::integer as position
    from public.rank_user_stats st
    where st.season_id = p_season_id and st.xp > 0
  )
  update public.rank_user_stats st set position_snapshot = ranked.position
  from ranked where st.season_id = p_season_id and st.wallet_account_id = ranked.wallet_account_id;

  insert into public.rank_leaderboard_results
    (period_id, position, wallet_account_id, display_name_snapshot, xp, rank_tier_snapshot, finalized_at)
  select p_season_id, st.position_snapshot, st.wallet_account_id,
    coalesce(nullif(btrim(p.display_name), ''), nullif(btrim(p.username), ''), 'Cabi member ' || left(st.wallet_account_id::text, 6)),
    st.xp, private.rank_tier_for_xp(p.lifetime_xp, private.rank_thresholds()), v_finalized
  from public.rank_user_stats st
  join public.profiles p on p.wallet_account_id = st.wallet_account_id
  where st.season_id = p_season_id and st.position_snapshot is not null and p.ranking_status = 'NORMAL'
  on conflict do nothing;

  insert into public.rank_reward_snapshots (season_id, wallet_account_id, placement, xp, username, wallet_address)
  select p_season_id, st.wallet_account_id, st.position_snapshot, st.xp,
    coalesce(nullif(btrim(p.display_name), ''), nullif(btrim(p.username), ''), 'Cabi member ' || left(st.wallet_account_id::text, 6)),
    wa.wallet_address
  from public.rank_user_stats st
  join public.profiles p on p.wallet_account_id = st.wallet_account_id
  left join public.wallet_accounts wa on wa.id = st.wallet_account_id
  where st.season_id = p_season_id and st.position_snapshot <= v_reward_placements and p.ranking_status = 'NORMAL'
  on conflict (season_id, placement) do nothing;

  update public.profiles p
  set best_leaderboard_position = least(coalesce(p.best_leaderboard_position, st.position_snapshot), st.position_snapshot),
      updated_at = v_finalized
  from public.rank_user_stats st
  where st.season_id = p_season_id and st.wallet_account_id = p.wallet_account_id and st.position_snapshot is not null;
end;
$$;
revoke all on function private.finalize_rank_season(uuid) from public, anon, authenticated;
grant execute on function private.finalize_rank_season(uuid) to service_role;

-- The only XP write path. All values, duplicate checks, time windows and caps
-- are decided atomically on the server/database. A per-account lock prevents
-- simultaneous requests from stepping over the daily cap or duplicate check.
drop function if exists public.award_rank_xp(uuid, integer, text, text, uuid, uuid, text, integer, integer, timestamptz);
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
  v_cap := coalesce(p_daily_cap, (public.rank_tuning_view()).daily_xp_cap);
  v_image_cap := coalesce(p_image_daily_cap, (public.rank_tuning_view()).image_xp_per_day);

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

-- Public safe projection: names, avatar, lifetime rank and period XP only. Wallet
-- addresses/account IDs are never returned. Everyone, including unnamed users,
-- receives a non-identifying fallback label rather than an address.
create or replace function public.rank_leaderboard(
  p_type text, p_limit integer default 100, p_wallet_account_id uuid default null, p_now timestamptz default null
)
returns table (placement integer, wallet_account_id uuid, username text, avatar_path text, xp bigint, rank_tier smallint, is_current_user boolean)
language plpgsql security definer set search_path = ''
as $$
declare
  v_now timestamptz := coalesce(p_now, timezone('utc', now()));
  v_season public.rank_seasons;
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 100);
begin
  if p_type not in ('WEEKLY','MONTHLY') then raise exception 'invalid season type'; end if;
  v_season := private.ensure_rank_season(p_type, v_now, private.rank_thresholds());
  return query
  with ranked as (
    select row_number() over (order by st.xp desc, coalesce(st.score_reached_at, st.updated_at) asc, st.wallet_account_id asc)::integer as place,
      st.wallet_account_id,
      coalesce(nullif(btrim(p.display_name), ''), nullif(btrim(p.username), ''), 'Cabi member ' || left(st.wallet_account_id::text, 6)) as public_name,
      p.avatar_path, st.xp,
      private.rank_tier_for_xp(p.lifetime_xp, private.rank_thresholds()) as lifetime_tier
    from public.rank_user_stats st join public.profiles p on p.wallet_account_id = st.wallet_account_id
    where st.season_id = v_season.id and st.xp > 0 and p.ranking_status = 'NORMAL'
  )
  select r.place, r.wallet_account_id, r.public_name, r.avatar_path, r.xp, r.lifetime_tier,
    (p_wallet_account_id is not null and r.wallet_account_id = p_wallet_account_id)
  from ranked r where r.place <= v_limit or (p_wallet_account_id is not null and r.wallet_account_id = p_wallet_account_id)
  order by r.place;
end;
$$;
revoke all on function public.rank_leaderboard(text, integer, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.rank_leaderboard(text, integer, uuid, timestamptz) to service_role;

create or replace function public.rank_user_standing(p_type text, p_wallet_account_id uuid, p_now timestamptz default null)
returns table (season_id uuid, placement integer, xp bigint, rank_tier smallint, participants integer)
language plpgsql security definer set search_path = ''
as $$
declare
  v_now timestamptz := coalesce(p_now, timezone('utc', now()));
  v_season public.rank_seasons;
  v_lifetime bigint := 0;
begin
  if p_type not in ('WEEKLY','MONTHLY') then raise exception 'invalid season type'; end if;
  v_season := private.ensure_rank_season(p_type, v_now, private.rank_thresholds());
  select coalesce(p.lifetime_xp, 0) into v_lifetime from public.profiles p where p.wallet_account_id = p_wallet_account_id;
  return query
  with ranked as (
    select row_number() over (order by st.xp desc, coalesce(st.score_reached_at, st.updated_at) asc, st.wallet_account_id asc)::integer as place,
      st.wallet_account_id, st.xp
    from public.rank_user_stats st join public.profiles p on p.wallet_account_id = st.wallet_account_id
    where st.season_id = v_season.id and st.xp > 0 and p.ranking_status = 'NORMAL'
  )
  select v_season.id,
    (select r.place from ranked r where r.wallet_account_id = p_wallet_account_id),
    coalesce((select r.xp from ranked r where r.wallet_account_id = p_wallet_account_id), 0),
    private.rank_tier_for_xp(v_lifetime, private.rank_thresholds()),
    (select count(*)::integer from ranked);
end;
$$;
revoke all on function public.rank_user_standing(text, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.rank_user_standing(text, uuid, timestamptz) to service_role;

-- Finalize every row, with a frozen display-name/rank snapshot. Manual reward
-- snapshots remain top-100 and are handled by the owner outside the app.
create or replace function public.admin_reset_rank_season(p_type text, p_now timestamptz default null)
returns table (closed_season_id uuid, new_season_id uuid, new_starts_at timestamptz, new_ends_at timestamptz)
language plpgsql security definer set search_path = ''
as $$
declare
  v_now timestamptz := coalesce(p_now, timezone('utc', now()));
  v_closed uuid;
  v_season public.rank_seasons;
  v_end timestamptz;
begin
  if p_type not in ('WEEKLY','MONTHLY') then raise exception 'invalid season type'; end if;
  perform pg_advisory_xact_lock(hashtext('cabi_rank_season_' || p_type));
  select s.id into v_closed from public.rank_seasons s where s.type = p_type and s.status = 'ACTIVE' order by s.starts_at desc limit 1;
  if v_closed is null then
    v_season := private.ensure_rank_season(p_type, v_now, private.rank_thresholds());
    v_closed := v_season.id;
  end if;
  perform private.finalize_rank_season(v_closed);
  if p_type = 'WEEKLY' then
    v_end := (date_trunc('week', v_now at time zone 'UTC') at time zone 'UTC') + interval '7 days';
    insert into public.rank_seasons (type, label, starts_at, ends_at, thresholds)
    values ('WEEKLY', 'Week of ' || to_char(v_now at time zone 'UTC', 'YYYY-MM-DD'), v_now, v_end, private.rank_thresholds()) returning * into v_season;
  else
    v_end := (date_trunc('month', v_now at time zone 'UTC') at time zone 'UTC') + interval '1 month';
    insert into public.rank_seasons (type, label, starts_at, ends_at, thresholds)
    values ('MONTHLY', to_char(v_now at time zone 'UTC', 'Month YYYY'), v_now, v_end, private.rank_thresholds()) returning * into v_season;
  end if;
  return query select v_closed, v_season.id, v_season.starts_at, v_season.ends_at;
end;
$$;
revoke all on function public.admin_reset_rank_season(text, timestamptz) from public, anon, authenticated;
grant execute on function public.admin_reset_rank_season(text, timestamptz) to service_role;

create or replace function public.rank_season_summary(p_season_id uuid)
returns table (participants integer, total_xp bigint, top_username text, top_xp bigint)
language sql stable security definer set search_path = ''
as $$
  select
    (select count(*)::integer from public.rank_user_stats st where st.season_id = p_season_id and st.xp > 0),
    (select coalesce(sum(st.xp), 0)::bigint from public.rank_user_stats st where st.season_id = p_season_id),
    (select coalesce(nullif(btrim(p.display_name), ''), nullif(btrim(p.username), ''), 'Cabi member ' || left(st.wallet_account_id::text, 6))
      from public.rank_user_stats st join public.profiles p on p.wallet_account_id = st.wallet_account_id
      where st.season_id = p_season_id and st.xp > 0
      order by st.xp desc, coalesce(st.score_reached_at, st.updated_at) asc, st.wallet_account_id asc limit 1),
    (select st.xp from public.rank_user_stats st where st.season_id = p_season_id and st.xp > 0
      order by st.xp desc, coalesce(st.score_reached_at, st.updated_at) asc, st.wallet_account_id asc limit 1);
$$;
revoke all on function public.rank_season_summary(uuid) from public, anon, authenticated;
grant execute on function public.rank_season_summary(uuid) to service_role;

-- Manual ledger-driven repair. Active periods only: finalized snapshots are
-- immutable. Running totals floor at zero after each event, matching award_xp.
create or replace function public.rank_recalculate_period(p_period_id uuid)
returns table (participants integer, total_xp bigint)
language plpgsql security definer set search_path = ''
as $$
declare
  v_period public.rank_seasons;
begin
  select * into v_period from public.rank_seasons where id = p_period_id for update;
  if v_period.id is null or v_period.status <> 'ACTIVE' then raise exception 'only active periods can be recalculated'; end if;
  perform pg_advisory_xact_lock(hashtext('cabi_rank_season_' || v_period.type));

  delete from public.rank_user_stats where season_id = p_period_id;
  with recursive scoped as (
    select e.wallet_account_id, e.xp_delta, e.created_at, e.id
    from public.rank_xp_events e
    where case when v_period.type = 'WEEKLY' then e.weekly_period_id else e.monthly_period_id end = p_period_id
  ), ordered as (
    select s.*, row_number() over (partition by s.wallet_account_id order by s.created_at, s.id) as seq
    from scoped s
  ), balances as (
    select o.wallet_account_id, o.seq, greatest(0, o.xp_delta)::bigint as balance, o.created_at
    from ordered o where o.seq = 1
    union all
    select o.wallet_account_id, o.seq, greatest(0, b.balance + o.xp_delta)::bigint, o.created_at
    from balances b join ordered o on o.wallet_account_id = b.wallet_account_id and o.seq = b.seq + 1
  ), totals as (
    select distinct on (b.wallet_account_id) b.wallet_account_id, b.balance as xp
    from balances b order by b.wallet_account_id, b.seq desc
  ), score_times as (
    select b.wallet_account_id, min(b.created_at) filter (where b.balance = t.xp) as score_reached_at
    from balances b join totals t on t.wallet_account_id = b.wallet_account_id group by b.wallet_account_id, t.xp
  )
  insert into public.rank_user_stats (season_id, wallet_account_id, xp, rank_tier, score_reached_at, updated_at)
  select p_period_id, t.wallet_account_id, t.xp,
    private.rank_tier_for_xp(p.lifetime_xp, private.rank_thresholds()), st.score_reached_at, timezone('utc', now())
  from totals t join score_times st on st.wallet_account_id = t.wallet_account_id
  join public.profiles p on p.wallet_account_id = t.wallet_account_id
  where t.xp > 0;

  return query select
    (select count(*)::integer from public.rank_user_stats s where s.season_id = p_period_id and s.xp > 0),
    (select coalesce(sum(s.xp), 0)::bigint from public.rank_user_stats s where s.season_id = p_period_id);
end;
$$;
revoke all on function public.rank_recalculate_period(uuid) from public, anon, authenticated;
grant execute on function public.rank_recalculate_period(uuid) to service_role;

-- Initialize current periods and carry recent ledger activity into their
-- materialized totals. This keeps the launch week/month accurate even if the
-- previous release tracked only monthly periods.
do $$
declare
  v_now timestamptz := timezone('utc', now());
  v_weekly public.rank_seasons;
  v_monthly public.rank_seasons;
begin
  v_weekly := private.ensure_rank_season('WEEKLY', v_now, private.rank_thresholds());
  v_monthly := private.ensure_rank_season('MONTHLY', v_now, private.rank_thresholds());

  update public.rank_xp_events e
  set weekly_period_id = v_weekly.id
  where e.weekly_period_id is null and e.created_at >= v_weekly.starts_at and e.created_at < v_weekly.ends_at;
  update public.rank_xp_events e
  set monthly_period_id = v_monthly.id
  where e.monthly_period_id is null and e.created_at >= v_monthly.starts_at and e.created_at < v_monthly.ends_at;

  perform public.rank_recalculate_period(v_weekly.id);
  perform public.rank_recalculate_period(v_monthly.id);
end;
$$;

-- Human-review signals only. No status or XP is changed by this reader.
create or replace function public.rank_suspicious_activity(p_since timestamptz default null, p_limit integer default 50)
returns table (wallet_account_id uuid, username text, message_events bigint, duplicate_events bigint, cap_hits bigint, rapid_events bigint, last_event_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  with events as (
    select e.wallet_account_id, e.event_type, e.reason_code, e.created_at,
      count(*) filter (where e.created_at >= timezone('utc', now()) - interval '10 minutes') over (partition by e.wallet_account_id) as rapid_count
    from public.rank_xp_events e
    where e.created_at >= coalesce(p_since, timezone('utc', now()) - interval '24 hours')
  ), summary as (
    select e.wallet_account_id,
      count(*) filter (where e.event_type in ('CHAT_MEANINGFUL','CHAT_HIGH_QUALITY','CHAT_FOLLOWUP','MEMORY_INTERACTION','FEATURE_DISCOVERY')) as message_events,
      count(*) filter (where e.event_type = 'SPAM_DUPLICATE' or e.reason_code = 'DUPLICATE_MESSAGE') as duplicate_events,
      count(*) filter (where e.reason_code = 'DAILY_CAP') as cap_hits,
      max(e.rapid_count) as rapid_events,
      max(e.created_at) as last_event_at
    from events e group by e.wallet_account_id
  )
  select s.wallet_account_id, p.username, s.message_events, s.duplicate_events, s.cap_hits, s.rapid_events, s.last_event_at
  from summary s join public.profiles p on p.wallet_account_id = s.wallet_account_id
  where s.message_events >= 100 or s.duplicate_events >= 8 or s.cap_hits >= 5 or s.rapid_events >= 20
  order by s.duplicate_events desc, s.rapid_events desc, s.cap_hits desc, s.message_events desc
  limit least(greatest(coalesce(p_limit, 50), 1), 100);
$$;
revoke all on function public.rank_suspicious_activity(timestamptz, integer) from public, anon, authenticated;
grant execute on function public.rank_suspicious_activity(timestamptz, integer) to service_role;

-- Public profile tier is lifetime-based too; period XP and placement remain
-- monthly board values. This preserves the established safe projection shape.
create or replace function public.public_profile(p_username text)
returns table (
  username text, avatar_path text, rank_tier smallint, season_xp bigint,
  season_label text, placement integer, lifetime_xp bigint, best_rank_tier smallint,
  best_leaderboard_position integer, joined_at timestamptz,
  show_bond_publicly boolean, achievements text[]
)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_profile public.profiles;
  v_season public.rank_seasons;
  v_xp bigint := 0;
  v_tier smallint := 1;
  v_placement integer;
  v_achievements text[];
begin
  select * into v_profile from public.profiles p
  where p.username = lower(btrim(p_username)) limit 1;
  if v_profile.id is null or v_profile.ranking_status = 'INELIGIBLE' then return; end if;

  select * into v_season from public.rank_seasons s
  where s.type = 'MONTHLY' and s.status = 'ACTIVE' order by s.starts_at desc limit 1;
  if v_season.id is not null then
    select st.xp into v_xp from public.rank_user_stats st
    where st.season_id = v_season.id and st.wallet_account_id = v_profile.wallet_account_id;
    if coalesce(v_xp, 0) > 0 then
      select ranked.place into v_placement from (
        select st.wallet_account_id,
          row_number() over (order by st.xp desc, coalesce(st.score_reached_at, st.updated_at) asc, st.wallet_account_id asc)::integer as place
        from public.rank_user_stats st join public.profiles p on p.wallet_account_id = st.wallet_account_id
        where st.season_id = v_season.id and st.xp > 0 and p.ranking_status = 'NORMAL'
      ) ranked where ranked.wallet_account_id = v_profile.wallet_account_id;
    end if;
  end if;
  v_tier := private.rank_tier_for_xp(v_profile.lifetime_xp, private.rank_thresholds());

  select coalesce(array_agg(a.code order by a.awarded_at), array[]::text[]) into v_achievements
  from public.profile_achievements a where a.wallet_account_id = v_profile.wallet_account_id;

  return query select v_profile.username, v_profile.avatar_path, v_tier, coalesce(v_xp, 0),
    v_season.label, v_placement, v_profile.lifetime_xp, v_profile.best_rank_tier,
    v_profile.best_leaderboard_position, v_profile.created_at, v_profile.show_bond_publicly,
    coalesce(v_achievements, array[]::text[]);
end;
$$;
revoke all on function public.public_profile(text) from public, anon, authenticated;
grant execute on function public.public_profile(text) to service_role;

commit;
