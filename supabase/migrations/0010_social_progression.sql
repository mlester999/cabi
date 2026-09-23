begin;

-- ===========================================================================
-- Cabi social progression phase: profiles, ranked seasons, XP, leaderboards,
-- reward snapshots, achievements, and Cabi image generations.
--
-- Conventions follow 0006: wallet_account_id is the owner key, RLS is enabled
-- everywhere, anon/authenticated are revoked from server-only tables, and every
-- public function pins `set search_path = ''` with schema-qualified bodies.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Public identity.
--
-- A wallet is an account, not a person. These columns give the account the
-- public identity the leaderboard needs. `username` is the unique handle shown
-- publicly; full wallet addresses are never rendered by the leaderboard.
-- ---------------------------------------------------------------------------
alter table public.profiles add column if not exists username text;
alter table public.profiles add column if not exists display_name text;
alter table public.profiles add column if not exists avatar_path text;
alter table public.profiles add column if not exists profile_completed_at timestamptz;
alter table public.profiles add column if not exists show_bond_publicly boolean not null default false;
-- Leaderboard eligibility flag. A flagged user keeps full chat access; they are
-- only excluded from reward snapshots.
alter table public.profiles add column if not exists ranking_status text not null default 'NORMAL';
alter table public.profiles add column if not exists lifetime_xp bigint not null default 0;
alter table public.profiles add column if not exists best_rank_tier smallint;
alter table public.profiles add column if not exists best_leaderboard_position integer;

alter table public.profiles drop constraint if exists profiles_ranking_status_check;
alter table public.profiles add constraint profiles_ranking_status_check
  check (ranking_status in ('NORMAL', 'REVIEW', 'INELIGIBLE'));

alter table public.profiles drop constraint if exists profiles_username_shape;
alter table public.profiles add constraint profiles_username_shape
  check (username is null or username ~ '^[a-z0-9][a-z0-9_-]{2,19}$');

alter table public.profiles drop constraint if exists profiles_lifetime_xp_check;
alter table public.profiles add constraint profiles_lifetime_xp_check check (lifetime_xp >= 0);

-- Case-insensitive uniqueness. The shape check already forces lowercase, so this
-- index is the authority on "is this handle taken".
create unique index if not exists profiles_username_key on public.profiles (username) where username is not null;

-- ---------------------------------------------------------------------------
-- 2. Seasons: weekly leaderboard periods and monthly rank seasons.
--
-- One shared table with a `type` discriminator, because both are "a ranked
-- window with a start, an end, and a frozen result set".
-- ---------------------------------------------------------------------------
create table if not exists public.rank_seasons (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('WEEKLY', 'MONTHLY')),
  label text not null check (char_length(label) between 1 and 80),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'FINALIZED')),
  -- Rank thresholds in force for this season, frozen at creation so a later
  -- admin edit never rewrites history.
  thresholds jsonb not null default '{"EXPLORER":500,"COMPANION":1500,"ELITE":4000,"MASTER":9000,"LEGEND":18000}'::jsonb,
  finalized_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  check (ends_at > starts_at)
);

-- At most one ACTIVE season per type. This is the concurrency guard: two
-- simultaneous requests cannot both create the next week.
create unique index if not exists rank_seasons_one_active_per_type
  on public.rank_seasons (type) where status = 'ACTIVE';

create index if not exists rank_seasons_type_starts_idx on public.rank_seasons (type, starts_at desc);

alter table public.rank_seasons enable row level security;
revoke all on public.rank_seasons from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Per-user, per-season totals. Lifetime totals live on profiles.
-- ---------------------------------------------------------------------------
create table if not exists public.rank_user_stats (
  season_id uuid not null references public.rank_seasons(id) on delete cascade,
  wallet_account_id uuid not null references public.wallet_accounts(id) on delete cascade,
  xp bigint not null default 0 check (xp >= 0),
  rank_tier smallint not null default 1 check (rank_tier between 1 and 6),
  position_snapshot integer,
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (season_id, wallet_account_id)
);

create index if not exists rank_user_stats_leaderboard_idx
  on public.rank_user_stats (season_id, xp desc, updated_at asc);

alter table public.rank_user_stats enable row level security;
revoke all on public.rank_user_stats from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Immutable XP ledger. XP is never mutated without a row here.
-- ---------------------------------------------------------------------------
create table if not exists public.rank_xp_events (
  id bigint generated always as identity primary key,
  season_id uuid references public.rank_seasons(id) on delete set null,
  wallet_account_id uuid not null references public.wallet_accounts(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  message_id uuid references public.messages(id) on delete set null,
  xp_delta integer not null,
  event_type text not null check (event_type in (
    'CHAT_MEANINGFUL', 'CHAT_HIGH_QUALITY', 'CHAT_FOLLOWUP', 'MEMORY_INTERACTION',
    'IMAGE_GENERATION', 'FEATURE_DISCOVERY', 'SPAM_DUPLICATE', 'SPAM_RATE_LIMIT',
    'ADMIN_ADJUSTMENT', 'MILESTONE', 'ACHIEVEMENT'
  )),
  reason_code text not null default 'GENERAL' check (char_length(reason_code) between 1 and 60),
  -- Deterministic fingerprint of the message that earned this, used for
  -- duplicate detection without storing message bodies here.
  content_fingerprint text,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists rank_xp_events_wallet_created_idx on public.rank_xp_events (wallet_account_id, created_at desc);
create index if not exists rank_xp_events_season_idx on public.rank_xp_events (season_id, created_at desc);
create index if not exists rank_xp_events_fingerprint_idx on public.rank_xp_events (wallet_account_id, content_fingerprint, created_at desc);
create index if not exists rank_xp_events_created_idx on public.rank_xp_events (created_at desc);

alter table public.rank_xp_events enable row level security;
revoke all on public.rank_xp_events from anon, authenticated;

-- XP events are an audit trail: append-only, like audit_logs.
create or replace function private.prevent_xp_event_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$ begin raise exception 'xp events are append-only'; end; $$;

drop trigger if exists rank_xp_events_append_only on public.rank_xp_events;
create trigger rank_xp_events_append_only
  before update or delete on public.rank_xp_events
  for each row execute function private.prevent_xp_event_mutation();

-- ---------------------------------------------------------------------------
-- 5. Reward snapshots. The site never transfers value; the owner marks winners
--    as rewarded manually. History is never deleted.
-- ---------------------------------------------------------------------------
create table if not exists public.rank_reward_snapshots (
  id bigint generated always as identity primary key,
  season_id uuid not null references public.rank_seasons(id) on delete cascade,
  wallet_account_id uuid references public.wallet_accounts(id) on delete set null,
  placement integer not null check (placement >= 1),
  xp bigint not null check (xp >= 0),
  username text,
  wallet_address text,
  reward_status text not null default 'PENDING' check (reward_status in ('PENDING', 'REWARDED', 'SKIPPED')),
  admin_note text check (admin_note is null or char_length(admin_note) <= 500),
  rewarded_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  unique (season_id, placement)
);

create index if not exists rank_reward_snapshots_season_idx on public.rank_reward_snapshots (season_id, placement);
create index if not exists rank_reward_snapshots_status_idx on public.rank_reward_snapshots (reward_status);

alter table public.rank_reward_snapshots enable row level security;
revoke all on public.rank_reward_snapshots from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Achievements. Permanent, unlike ranks which reset monthly.
-- ---------------------------------------------------------------------------
create table if not exists public.profile_achievements (
  wallet_account_id uuid not null references public.wallet_accounts(id) on delete cascade,
  code text not null check (char_length(code) between 1 and 40),
  awarded_at timestamptz not null default timezone('utc', now()),
  primary key (wallet_account_id, code)
);

alter table public.profile_achievements enable row level security;
revoke all on public.profile_achievements from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. Cabi image generations.
--
-- `user_prompt` is the user's own words, sanitised. The internal character
-- specification is never stored here, so a gallery can never leak it.
-- ---------------------------------------------------------------------------
create table if not exists public.image_generations (
  id uuid primary key default gen_random_uuid(),
  wallet_account_id uuid not null references public.wallet_accounts(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  message_id uuid references public.messages(id) on delete set null,
  user_prompt text not null check (char_length(user_prompt) between 1 and 800),
  aspect_ratio text not null default '1:1' check (aspect_ratio in ('1:1', '16:9', '9:16', '3:2', '2:3')),
  image_path text,
  provider text not null default 'configured',
  model text,
  status text not null default 'SUCCEEDED' check (status in ('PENDING', 'SUCCEEDED', 'FAILED')),
  failure_code text,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists image_generations_wallet_created_idx on public.image_generations (wallet_account_id, created_at desc);
create index if not exists image_generations_quota_idx on public.image_generations (wallet_account_id, created_at desc) where status = 'SUCCEEDED';

alter table public.image_generations enable row level security;
revoke all on public.image_generations from anon, authenticated;

commit;