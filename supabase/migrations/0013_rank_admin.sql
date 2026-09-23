begin;

-- ===========================================================================
-- Service-role entry points for the season lifecycle.
--
-- The provisioning helpers live in the `private` schema because they finalize
-- and provision. These thin wrappers are the only surface the server calls, and
-- they are granted to service_role alone.
-- ===========================================================================

-- Current season for a type, provisioning or rolling over as needed.
create or replace function public.rank_season_view(
  p_type text,
  p_now timestamptz default null
)
returns table (
  id uuid,
  type text,
  label text,
  starts_at timestamptz,
  ends_at timestamptz,
  status text,
  thresholds jsonb,
  ms_remaining bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := coalesce(p_now, timezone('utc', now()));
  v_season public.rank_seasons;
begin
  if p_type not in ('WEEKLY', 'MONTHLY') then
    raise exception 'invalid season type';
  end if;

  v_season := private.ensure_rank_season(p_type, v_now);

  return query select
    v_season.id,
    v_season.type,
    v_season.label,
    v_season.starts_at,
    v_season.ends_at,
    v_season.status,
    v_season.thresholds,
    greatest(0, (extract(epoch from (v_season.ends_at - v_now)) * 1000)::bigint);
end;
$$;

revoke all on function public.rank_season_view(text, timestamptz) from public, anon, authenticated;
grant execute on function public.rank_season_view(text, timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- Admin-triggered finalize / reset.
--
-- "Reset" closes the current period and provisions the next one. It never
-- deletes history: the old season keeps its stats, its frozen placements, and
-- its reward snapshots, and is simply marked FINALIZED.
--
-- `p_force` closes a period even if it has not reached its natural end.
-- ---------------------------------------------------------------------------
create or replace function public.admin_reset_rank_season(
  p_type text,
  p_now timestamptz default null
)
returns table (closed_season_id uuid, new_season_id uuid, new_starts_at timestamptz, new_ends_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := coalesce(p_now, timezone('utc', now()));
  v_closed uuid;
  v_season public.rank_seasons;
begin
  if p_type not in ('WEEKLY', 'MONTHLY') then
    raise exception 'invalid season type';
  end if;

  perform pg_advisory_xact_lock(hashtext('cabi_rank_season_' || p_type));

  select s.id into v_closed
  from public.rank_seasons s
  where s.type = p_type and s.status = 'ACTIVE'
  order by s.starts_at desc
  limit 1;

  if v_closed is not null then
    perform private.finalize_rank_season(v_closed);

    -- A season closed early never reached its natural end, so anyone who earned
    -- XP in it was never ranked or snapshotted by the window logic. Freeze their
    -- placements and snapshot the winners now, which is what makes an early
    -- close behave like a normal period end rather than silently discarding the
    -- period's results.
    with ranked as (
      select
        st.wallet_account_id,
        row_number() over (order by st.xp desc, st.updated_at asc, st.wallet_account_id asc) as placement
      from public.rank_user_stats st
      where st.season_id = v_closed and st.xp > 0
    )
    update public.rank_user_stats st
    set position_snapshot = ranked.placement
    from ranked
    where st.season_id = v_closed
      and st.wallet_account_id = ranked.wallet_account_id
      and st.position_snapshot is null;

    insert into public.rank_reward_snapshots (season_id, wallet_account_id, placement, xp, username, wallet_address)
    select
      v_closed,
      st.wallet_account_id,
      st.position_snapshot,
      st.xp,
      p.username,
      wa.wallet_address
    from public.rank_user_stats st
    join public.profiles p on p.wallet_account_id = st.wallet_account_id
    left join public.wallet_accounts wa on wa.id = st.wallet_account_id
    where st.season_id = v_closed
      and st.position_snapshot is not null
      and st.position_snapshot <= 100
      and p.ranking_status = 'NORMAL'
    -- Never overwrite a snapshot whose reward an admin may already have recorded.
    on conflict (season_id, placement) do nothing;
  end if;

  -- Provision the next period starting now, so a manual reset gives a clean
  -- window rather than inheriting the remainder of the old one.
  if p_type = 'WEEKLY' then
    insert into public.rank_seasons (type, label, starts_at, ends_at, thresholds)
    values (
      p_type,
      'Week of ' || to_char(v_now, 'YYYY-MM-DD'),
      v_now,
      v_now + interval '7 days',
      coalesce(
        (select s.thresholds from public.rank_seasons s where s.id = v_closed),
        '{"EXPLORER":500,"COMPANION":1500,"ELITE":4000,"MASTER":9000,"LEGEND":18000}'::jsonb
      )
    )
    returning * into v_season;
  else
    insert into public.rank_seasons (type, label, starts_at, ends_at, thresholds)
    values (
      p_type,
      to_char(v_now, 'Month YYYY'),
      v_now,
      v_now + interval '1 month',
      coalesce(
        (select s.thresholds from public.rank_seasons s where s.id = v_closed),
        '{"EXPLORER":500,"COMPANION":1500,"ELITE":4000,"MASTER":9000,"LEGEND":18000}'::jsonb
      )
    )
    returning * into v_season;
  end if;

  return query select v_closed, v_season.id, v_season.starts_at, v_season.ends_at;
end;
$$;

revoke all on function public.admin_reset_rank_season(text, timestamptz) from public, anon, authenticated;
grant execute on function public.admin_reset_rank_season(text, timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- Season roster for the admin dashboard: how many people are competing and who
-- is leading, without exposing wallet addresses.
-- ---------------------------------------------------------------------------
create or replace function public.rank_season_summary(p_season_id uuid)
returns table (participants integer, total_xp bigint, top_username text, top_xp bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select count(*)::integer from public.rank_user_stats st where st.season_id = p_season_id and st.xp > 0),
    (select coalesce(sum(st.xp), 0)::bigint from public.rank_user_stats st where st.season_id = p_season_id),
    (
      select p.username
      from public.rank_user_stats st
      join public.profiles p on p.wallet_account_id = st.wallet_account_id
      where st.season_id = p_season_id and st.xp > 0
      order by st.xp desc, st.updated_at asc
      limit 1
    ),
    (
      select st.xp
      from public.rank_user_stats st
      where st.season_id = p_season_id and st.xp > 0
      order by st.xp desc, st.updated_at asc
      limit 1
    );
$$;

revoke all on function public.rank_season_summary(uuid) from public, anon, authenticated;
grant execute on function public.rank_season_summary(uuid) to service_role;

commit;