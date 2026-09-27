begin;

-- Release surfaces that already have server-backed data and authenticated APIs.
update public.app_settings
set value_json = coalesce(value_json, '{}'::jsonb) || jsonb_build_object(
  'portfolio_enabled', true,
  'rewards_enabled', true,
  'achievements_enabled', true,
  'gallery_enabled', true
), updated_at = timezone('utc', now())
where key = 'feature_flags';

-- Manual rewards remain an audited record. No automatic transfer is performed.
alter table public.rank_reward_snapshots
  add column if not exists reward_amount numeric(38,18)
    check (reward_amount is null or reward_amount > 0),
  add column if not exists transaction_hash text
    check (transaction_hash is null or transaction_hash ~ '^0x[a-fA-F0-9]{64}$');

create index if not exists profiles_lifetime_leaderboard_idx
  on public.profiles (lifetime_xp desc, updated_at asc, wallet_account_id asc)
  where ranking_status = 'NORMAL' and lifetime_xp > 0;

-- Lifetime standings are calculated from the permanent XP total and never use
-- the weekly or monthly counters. Wallet ids are used only for tie-breaking and
-- caller matching; no address is returned.
create or replace function public.rank_all_time_leaderboard(
  p_limit integer default 100,
  p_wallet_account_id uuid default null
)
returns table (placement integer, wallet_account_id uuid, username text, avatar_path text, xp bigint, rank_tier smallint, is_current_user boolean)
language plpgsql security definer set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 100);
begin
  return query
  with ranked as (
    select row_number() over (order by p.lifetime_xp desc, p.updated_at asc, p.wallet_account_id asc)::integer as place,
      p.wallet_account_id,
      coalesce(nullif(btrim(p.display_name), ''), nullif(btrim(p.username), ''), 'Cabi member ' || left(p.wallet_account_id::text, 6)) as public_name,
      p.avatar_path, p.lifetime_xp,
      private.rank_tier_for_xp(p.lifetime_xp, private.rank_thresholds()) as lifetime_tier
    from public.profiles p
    where p.ranking_status = 'NORMAL' and p.lifetime_xp > 0
  )
  select r.place, r.wallet_account_id, r.public_name, r.avatar_path, r.lifetime_xp, r.lifetime_tier,
    (p_wallet_account_id is not null and r.wallet_account_id = p_wallet_account_id)
  from ranked r
  where r.place <= v_limit or (p_wallet_account_id is not null and r.wallet_account_id = p_wallet_account_id)
  order by r.place;
end;
$$;
revoke all on function public.rank_all_time_leaderboard(integer, uuid) from public, anon, authenticated;
grant execute on function public.rank_all_time_leaderboard(integer, uuid) to service_role;

create or replace function public.rank_all_time_standing(p_wallet_account_id uuid)
returns table (placement integer, xp bigint, rank_tier smallint, participants integer)
language plpgsql security definer set search_path = ''
as $$
declare
  v_xp bigint := 0;
begin
  select coalesce(p.lifetime_xp, 0) into v_xp
  from public.profiles p where p.wallet_account_id = p_wallet_account_id;
  v_xp := coalesce(v_xp, 0);
  return query
  with ranked as (
    select row_number() over (order by p.lifetime_xp desc, p.updated_at asc, p.wallet_account_id asc)::integer as place,
      p.wallet_account_id, p.lifetime_xp
    from public.profiles p
    where p.ranking_status = 'NORMAL' and p.lifetime_xp > 0
  )
  select (select r.place from ranked r where r.wallet_account_id = p_wallet_account_id),
    v_xp,
    private.rank_tier_for_xp(v_xp, private.rank_thresholds()),
    (select count(*)::integer from ranked);
end;
$$;
revoke all on function public.rank_all_time_standing(uuid) from public, anon, authenticated;
grant execute on function public.rank_all_time_standing(uuid) to service_role;

commit;
