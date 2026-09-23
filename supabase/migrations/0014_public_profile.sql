begin;

-- ===========================================================================
-- Public profile projection, corrected.
--
-- 0012 shipped `public_profile` with `season_xp` hardcoded to 0 and the tier
-- hardcoded to 1, because the seasonal join had not been written yet. That made
-- the function worse than useless for a public page: it would confidently report
-- a real user as an unranked Novice with no points.
--
-- This replaces it with the actual projection: the current *monthly* season's XP
-- and tier, plus permanent achievements. Nothing here exposes a wallet address,
-- a memory, a conversation, or an admin field.
-- ===========================================================================

-- PostgreSQL cannot change a function's OUT-parameter row type with
-- CREATE OR REPLACE FUNCTION. 0002/0012 created this function with a smaller
-- projection, so replace it explicitly before installing the corrected shape.
drop function if exists public.public_profile(text);

create or replace function public.public_profile(p_username text)
returns table (
  username text,
  avatar_path text,
  rank_tier smallint,
  season_xp bigint,
  season_label text,
  placement integer,
  lifetime_xp bigint,
  best_rank_tier smallint,
  best_leaderboard_position integer,
  joined_at timestamptz,
  show_bond_publicly boolean,
  achievements text[]
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles;
  v_season public.rank_seasons;
  v_xp bigint := 0;
  v_tier smallint := 1;
  v_placement integer;
  v_achievements text[];
begin
  select * into v_profile
  from public.profiles p
  where p.username = lower(btrim(p_username))
  limit 1;

  if v_profile.id is null then
    return;
  end if;

  -- An ineligible account keeps its profile; it is simply not published.
  if v_profile.ranking_status = 'INELIGIBLE' then
    return;
  end if;

  /*
   * Read the live monthly season without provisioning one. A public page view
   * must never be the thing that opens a new season: that would let an
   * anonymous request create rows. If no season exists yet, the profile simply
   * shows zero, which is the truth.
   */
  select * into v_season
  from public.rank_seasons s
  where s.type = 'MONTHLY' and s.status = 'ACTIVE'
  order by s.starts_at desc
  limit 1;

  if v_season.id is not null then
    select st.xp, st.rank_tier
      into v_xp, v_tier
    from public.rank_user_stats st
    where st.season_id = v_season.id
      and st.wallet_account_id = v_profile.wallet_account_id;

    -- Placement is only meaningful against the published board, so the same
    -- eligibility filter the leaderboard uses is applied here too.
    if coalesce(v_xp, 0) > 0 then
      select count(*)::integer + 1
        into v_placement
      from public.rank_user_stats other
      join public.profiles op on op.wallet_account_id = other.wallet_account_id
      where other.season_id = v_season.id
        and other.xp > v_xp
        and other.xp > 0
        and op.ranking_status = 'NORMAL'
        and op.username is not null;
    end if;
  end if;

  select coalesce(array_agg(a.code order by a.awarded_at), array[]::text[])
    into v_achievements
  from public.profile_achievements a
  where a.wallet_account_id = v_profile.wallet_account_id;

  return query select
    v_profile.username,
    v_profile.avatar_path,
    coalesce(v_tier, 1::smallint),
    coalesce(v_xp, 0::bigint),
    v_season.label,
    v_placement,
    v_profile.lifetime_xp,
    v_profile.best_rank_tier,
    v_profile.best_leaderboard_position,
    v_profile.created_at,
    -- The bond badge is published only when the owner opted in.
    v_profile.show_bond_publicly,
    coalesce(v_achievements, array[]::text[]);
end;
$$;

revoke all on function public.public_profile(text) from public, anon, authenticated;
grant execute on function public.public_profile(text) to service_role;

-- Case-insensitive lookup needs an index that matches the function's predicate.
create index if not exists profiles_username_lower_idx on public.profiles (lower(username)) where username is not null;

commit;
