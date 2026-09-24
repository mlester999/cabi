begin;

-- An explicit, server-managed allowlist for wallet access during PRELAUNCH.
-- Lowercase addresses are unique; the application presents checksummed copies.
create table public.admin_wallets (
  id uuid primary key default gen_random_uuid(),
  wallet_address text not null unique check (wallet_address ~ '^0x[0-9a-f]{40}$'),
  label text not null default '' check (char_length(label) <= 100),
  enabled boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  last_used_at timestamptz
);

create index admin_wallets_enabled_idx on public.admin_wallets (enabled) where enabled;
alter table public.admin_wallets enable row level security;
revoke all on public.admin_wallets from anon, authenticated;
grant select, insert, update on public.admin_wallets to service_role;

commit;
