begin;

-- ===========================================================================
-- $CPU holder access gate.
--
-- Access to the Cabi application now requires holding at least 1,000,000 $CPU,
-- read on the server from the official contract on Robinhood Chain (4663):
--
--   0x1a421a5065316d9b4062939e9959ddece6630528
--
-- Two pieces of state belong in the database:
--
--   1. app_settings.cpu_access_gate  - the owner-editable minimum, the gate's
--      server-side feature flag, and the admin-bypass switch. The contract,
--      chain, and buy URL are stored for the audit trail only: the server
--      accepts them back solely when they equal the shipped official values, so
--      no row can redirect the gate at another token, chain, or host.
--
--   2. cpu_gate_events               - four coarse, privacy-conscious analytics
--      events. There is deliberately no balance column and no wallet address:
--      the actor is a salted hash, so "how many distinct wallets saw the gate"
--      is answerable without keeping a record of what anyone owns.
-- ===========================================================================

-- Seed the gate row with the product defaults. `on conflict do nothing` means an
-- owner's saved values are never overwritten by a redeploy.
insert into public.app_settings (key, value_json) values
  ('cpu_access_gate', '{
    "enabled": true,
    "minimumBalance": 1000000,
    "allowAdminBypass": true,
    "contract": "0x1a421a5065316d9b4062939e9959ddece6630528",
    "chainId": 4663,
    "buyUrl": "https://clank.trade/coin/0x1a421a5065316d9b4062939e9959ddece6630528"
  }'::jsonb)
on conflict (key) do nothing;

-- Bound the stored shape. The checks are strictly looser than the Zod schema in
-- /api/admin/cpu: they only reject values that could not be a working gate, so a
-- malformed write fails loudly instead of silently lowering the requirement.
alter table public.app_settings
  drop constraint if exists app_settings_cpu_access_gate_shape;

alter table public.app_settings
  add constraint app_settings_cpu_access_gate_shape check (
    key <> 'cpu_access_gate'
    or ((
      jsonb_typeof(value_json) = 'object'
      and jsonb_typeof(value_json->'enabled') = 'boolean'
      and jsonb_typeof(value_json->'allowAdminBypass') = 'boolean'
      and jsonb_typeof(value_json->'minimumBalance') = 'number'
      and (value_json->>'minimumBalance')::numeric >= 1
      and (value_json->>'minimumBalance')::numeric <= 1000000000000
      and value_json->>'contract' = '0x1a421a5065316d9b4062939e9959ddece6630528'
      and (value_json->>'chainId')::numeric = 4663
    ) is true)
  );

create table if not exists public.cpu_gate_events (
  id uuid primary key default gen_random_uuid(),
  event text not null check (event in ('cpu_gate_viewed', 'cpu_gate_passed', 'cpu_gate_failed', 'cpu_buy_link_opened')),
  -- Salted hash of the internal wallet account id. Nullable for events that are
  -- attributed to nobody.
  actor_hash text,
  site_mode text,
  created_at timestamptz not null default now()
);

create index if not exists cpu_gate_events_event_created_at_idx
  on public.cpu_gate_events (event, created_at desc);

-- Server-only table: the service role writes it, and no client policy exists.
alter table public.cpu_gate_events enable row level security;

drop policy if exists cpu_gate_events_no_client_access on public.cpu_gate_events;
create policy cpu_gate_events_no_client_access on public.cpu_gate_events
  for select using (false);

commit;
