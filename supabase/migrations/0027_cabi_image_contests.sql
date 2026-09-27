begin;

update public.app_settings
set value_json = coalesce(value_json, '{}'::jsonb) || jsonb_build_object('contest_enabled', true),
    updated_at = timezone('utc', now())
where key = 'feature_flags';

create table if not exists public.cabi_image_contests (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 3 and 120),
  description text not null default '' check (char_length(description) <= 2000),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'DRAFT' check (status in ('DRAFT','OPEN','CLOSED','FINALIZED')),
  winner_entry_id uuid,
  created_by text,
  created_at timestamptz not null default timezone('utc', now()),
  finalized_at timestamptz,
  check (ends_at > starts_at)
);

create table if not exists public.cabi_image_contest_entries (
  id uuid primary key default gen_random_uuid(),
  contest_id uuid not null references public.cabi_image_contests(id) on delete restrict,
  wallet_account_id uuid not null references public.wallet_accounts(id) on delete restrict,
  image_generation_id uuid not null references public.image_generations(id) on delete restrict,
  image_path text not null,
  username_snapshot text,
  display_name_snapshot text,
  submitted_at timestamptz not null default timezone('utc', now()),
  unique (contest_id, wallet_account_id),
  unique (contest_id, image_generation_id)
);

alter table public.cabi_image_contests
  add constraint cabi_image_contests_winner_entry_fk
  foreign key (winner_entry_id) references public.cabi_image_contest_entries(id) on delete set null;

create index if not exists cabi_image_contests_status_dates_idx
  on public.cabi_image_contests (status, starts_at, ends_at desc);
create index if not exists cabi_image_contest_entries_contest_idx
  on public.cabi_image_contest_entries (contest_id, submitted_at desc);
create index if not exists cabi_image_contest_entries_wallet_idx
  on public.cabi_image_contest_entries (wallet_account_id, submitted_at desc);

alter table public.cabi_image_contests enable row level security;
alter table public.cabi_image_contest_entries enable row level security;
revoke all on public.cabi_image_contests from anon, authenticated;
revoke all on public.cabi_image_contest_entries from anon, authenticated;

commit;
