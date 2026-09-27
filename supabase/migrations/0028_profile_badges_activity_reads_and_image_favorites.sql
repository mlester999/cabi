begin;

-- Private activity cursor. The feed itself is assembled from existing durable
-- product records; this single per-account timestamp tracks what the owner has
-- already seen without copying those records into another notification table.
create table if not exists public.cabi_activity_read_state (
  wallet_account_id uuid primary key references public.wallet_accounts(id) on delete cascade,
  last_read_at timestamptz not null default '-infinity'::timestamptz,
  updated_at timestamptz not null default timezone('utc', now())
);
alter table public.cabi_activity_read_state enable row level security;
revoke all on public.cabi_activity_read_state from anon, authenticated;

-- A favorite belongs to the wallet owner and one of their own generated images.
-- Ownership is checked in the authenticated route before writes and in the
-- query predicates before reads.
create table if not exists public.image_generation_favorites (
  wallet_account_id uuid not null references public.wallet_accounts(id) on delete cascade,
  image_generation_id uuid not null references public.image_generations(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (wallet_account_id, image_generation_id)
);
create index if not exists image_generation_favorites_recent_idx
  on public.image_generation_favorites (wallet_account_id, created_at desc);
alter table public.image_generation_favorites enable row level security;
revoke all on public.image_generation_favorites from anon, authenticated;

-- Profile badges are curated by an admin and remain separate from earned
-- achievements. Users may showcase at most three badges they have been awarded.
create table if not exists public.cabi_profile_badges (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' and char_length(slug) <= 64),
  label text not null check (char_length(label) between 2 and 40),
  description text not null default '' check (char_length(description) <= 240),
  icon_key text not null default 'award' check (icon_key in ('award','star','sparkles','crown','heart','image','leaf')),
  color_key text not null default 'violet' check (color_key in ('violet','teal','amber','rose','blue')),
  created_by text not null,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.cabi_profile_badge_awards (
  badge_id uuid not null references public.cabi_profile_badges(id) on delete restrict,
  wallet_account_id uuid not null references public.wallet_accounts(id) on delete cascade,
  assigned_by text not null,
  assigned_at timestamptz not null default timezone('utc', now()),
  is_showcased boolean not null default false,
  primary key (badge_id, wallet_account_id)
);
create index if not exists cabi_profile_badge_awards_owner_idx
  on public.cabi_profile_badge_awards (wallet_account_id, assigned_at desc);
create index if not exists cabi_profile_badge_awards_showcase_idx
  on public.cabi_profile_badge_awards (wallet_account_id, assigned_at desc)
  where is_showcased;
alter table public.cabi_profile_badges enable row level security;
alter table public.cabi_profile_badge_awards enable row level security;
revoke all on public.cabi_profile_badges from anon, authenticated;
revoke all on public.cabi_profile_badge_awards from anon, authenticated;

-- The service role invokes this function after authenticating the profile
-- owner. One transaction changes the whole selection, so partial showcases
-- cannot be left behind if a request fails.
create or replace function public.set_profile_badge_showcase(
  p_wallet_account_id uuid,
  p_badge_ids uuid[]
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_badge_ids uuid[] := coalesce(p_badge_ids, array[]::uuid[]);
  v_count integer;
begin
  if cardinality(v_badge_ids) > 3 then
    raise exception 'at most three profile badges may be showcased';
  end if;

  select count(*) into v_count from (select distinct badge_id from unnest(v_badge_ids) as badges(badge_id)) unique_badges;
  if v_count <> cardinality(v_badge_ids) then
    raise exception 'duplicate profile badge selection';
  end if;

  select count(*) into v_count
  from public.cabi_profile_badge_awards a
  join public.cabi_profile_badges b on b.id = a.badge_id
  where a.wallet_account_id = p_wallet_account_id
    and a.badge_id = any(v_badge_ids);
  if v_count <> cardinality(v_badge_ids) then
    raise exception 'profile badge is not assigned to this account';
  end if;

  update public.cabi_profile_badge_awards a
  set is_showcased = (a.badge_id = any(v_badge_ids))
  where a.wallet_account_id = p_wallet_account_id;

  return true;
end;
$$;
revoke all on function public.set_profile_badge_showcase(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.set_profile_badge_showcase(uuid, uuid[]) to service_role;

-- The admin dashboard needs exact hourly counts and latency without fetching a
-- capped sample of usage rows into the application server.
create or replace function public.admin_dashboard_usage_summary(
  p_day_start timestamptz,
  p_activity_start timestamptz,
  p_hours integer default 12
)
returns table (activity_series bigint[], average_latency_ms numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce((
      select array_agg(hourly.request_count order by hourly.bucket_start)
      from (
        select bucket.bucket_start, count(usage.id)::bigint as request_count
        from generate_series(
          p_activity_start,
          p_activity_start + (greatest(1, least(coalesce(p_hours, 12), 24)) - 1) * interval '1 hour',
          interval '1 hour'
        ) as bucket(bucket_start)
        left join public.usage_logs as usage
          on usage.created_at >= bucket.bucket_start
         and usage.created_at < bucket.bucket_start + interval '1 hour'
        group by bucket.bucket_start
      ) as hourly
    ), '{}'::bigint[]),
    (
      select round(avg(usage.latency_ms))::numeric
      from public.usage_logs as usage
      where usage.created_at >= p_day_start
        and usage.latency_ms is not null
    );
$$;
revoke all on function public.admin_dashboard_usage_summary(timestamptz, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.admin_dashboard_usage_summary(timestamptz, timestamptz, integer) to service_role;

commit;
