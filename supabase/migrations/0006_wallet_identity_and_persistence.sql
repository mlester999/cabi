begin;

-- `$CPU` has one authoritative configuration surface from this migration on.
delete from public.app_settings where key = 'cpu_config';
update public.app_settings
set value_json = value_json - 'ticker' - 'clankUrl' - 'contractAddress'
where key = 'branding';

-- Wallet identity is the only durable end-user identity. No chain is seeded here:
-- chain metadata must be verified by the owner before it is enabled.
create table public.chain_configs (
  chain_id bigint primary key check (chain_id > 0),
  chain_name text not null check (char_length(chain_name) between 1 and 100),
  native_currency_name text not null check (char_length(native_currency_name) between 1 and 80),
  native_currency_symbol text not null check (char_length(native_currency_symbol) between 1 and 20),
  native_currency_decimals smallint not null default 18 check (native_currency_decimals between 0 and 36),
  rpc_url text not null check (rpc_url ~ '^https://'),
  block_explorer_url text check (block_explorer_url is null or block_explorer_url ~ '^https://'),
  icon_url text check (icon_url is null or char_length(icon_url) <= 1000),
  enabled boolean not null default false,
  is_primary boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check (not is_primary or enabled)
);

create unique index chain_configs_one_primary_idx on public.chain_configs (is_primary) where is_primary;
create index chain_configs_enabled_idx on public.chain_configs (enabled, chain_name);
create trigger chain_configs_set_updated_at before update on public.chain_configs for each row execute function private.set_updated_at();

create table public.wallet_accounts (
  id uuid primary key default gen_random_uuid(),
  wallet_address text not null check (wallet_address ~ '^0x[0-9a-fA-F]{40}$'),
  wallet_address_unique_key text not null unique check (
    wallet_address_unique_key ~ '^0x[0-9a-f]{40}$'
    and wallet_address_unique_key = lower(wallet_address)
  ),
  primary_chain_id bigint references public.chain_configs(chain_id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  last_login_at timestamptz
);

create index wallet_accounts_last_login_idx on public.wallet_accounts (last_login_at desc nulls last);
create trigger wallet_accounts_set_updated_at before update on public.wallet_accounts for each row execute function private.set_updated_at();

create table public.wallet_nonces (
  id uuid primary key default gen_random_uuid(),
  wallet_address text not null check (wallet_address ~ '^0x[0-9a-fA-F]{40}$'),
  wallet_address_unique_key text not null check (
    wallet_address_unique_key ~ '^0x[0-9a-f]{40}$'
    and wallet_address_unique_key = lower(wallet_address)
  ),
  nonce_hash text not null unique check (char_length(nonce_hash) between 43 and 128),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  check (expires_at > created_at),
  check (used_at is null or used_at >= created_at)
);

create index wallet_nonces_address_created_idx on public.wallet_nonces (wallet_address_unique_key, created_at desc);
create index wallet_nonces_unused_expiry_idx on public.wallet_nonces (expires_at) where used_at is null;

create table public.auth_sessions (
  id uuid primary key default gen_random_uuid(),
  wallet_account_id uuid not null references public.wallet_accounts(id) on delete cascade,
  session_token_hash text not null unique check (char_length(session_token_hash) between 43 and 128),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  check (expires_at > created_at),
  check (revoked_at is null or revoked_at >= created_at)
);

create index auth_sessions_wallet_expiry_idx on public.auth_sessions (wallet_account_id, expires_at desc);
create index auth_sessions_active_expiry_idx on public.auth_sessions (expires_at) where revoked_at is null;

-- Profiles keep an internal UUID for display metadata, but are one-to-one with a
-- cryptographically authenticated wallet account.
alter table public.profiles add column wallet_account_id uuid references public.wallet_accounts(id) on delete cascade;

-- Rows created by the old signed-guest-cookie model have no cryptographic owner.
-- They cannot be safely assigned to a wallet, and retaining them would violate the
-- new no-guest-persistence guarantee. A real Supabase-auth profile cannot be
-- mapped to a wallet automatically, so abort rather than silently erase it.
do $$
begin
  if exists (select 1 from public.profiles where auth_user_id is not null) then
    raise exception using
      message = 'wallet migration stopped: legacy authenticated profiles require an explicit wallet backfill',
      hint = 'Export or backfill profiles.auth_user_id to wallet accounts, then rerun this migration.';
  end if;
end;
$$;
delete from public.profiles where auth_user_id is null and wallet_account_id is null;

alter table public.profiles alter column wallet_account_id set not null;
alter table public.profiles add constraint profiles_wallet_account_id_key unique (wallet_account_id);
create index profiles_wallet_account_idx on public.profiles (wallet_account_id);

-- Replace profile/guest ownership with direct wallet ownership. Dropping the old
-- owner policies first also prevents a stale Supabase JWT from matching these rows.
drop policy if exists settings_owner_all on public.user_settings;
drop policy if exists conversations_owner_all on public.conversations;
drop policy if exists messages_owner_select on public.messages;
drop policy if exists messages_owner_insert_user_only on public.messages;
drop policy if exists reactions_owner_all on public.message_reactions;
drop policy if exists summaries_owner_select on public.conversation_summaries;
drop policy if exists memories_owner_all on public.user_memories;
drop policy if exists bond_profile_owner_select on public.bond_profiles;
drop policy if exists bond_events_owner_select on public.bond_events;
drop policy if exists cabi_state_owner_select on public.cabi_state;
drop policy if exists profiles_owner_select on public.profiles;
drop policy if exists profiles_owner_update on public.profiles;

alter table public.profiles drop column auth_user_id;
drop function if exists private.current_profile_id();

alter table public.user_settings drop column user_id;
alter table public.user_settings add column wallet_account_id uuid not null references public.wallet_accounts(id) on delete cascade;
alter table public.user_settings add constraint user_settings_pkey primary key (wallet_account_id);
alter table public.user_settings add column settings_json jsonb not null default '{}'::jsonb;

alter table public.conversations drop column user_id;
alter table public.conversations add column wallet_account_id uuid not null references public.wallet_accounts(id) on delete cascade;

alter table public.message_reactions drop column user_id;
alter table public.message_reactions add column wallet_account_id uuid not null references public.wallet_accounts(id) on delete cascade;
alter table public.message_reactions add constraint message_reactions_message_wallet_key unique (message_id, wallet_account_id);

alter table public.user_memories drop column user_id;
alter table public.user_memories add column wallet_account_id uuid not null references public.wallet_accounts(id) on delete cascade;
alter table public.user_memories add constraint user_memories_wallet_normalized_key_key unique (wallet_account_id, normalized_key);

alter table public.bond_profiles drop column user_id;
alter table public.bond_profiles add column wallet_account_id uuid not null references public.wallet_accounts(id) on delete cascade;
alter table public.bond_profiles add constraint bond_profiles_pkey primary key (wallet_account_id);

alter table public.bond_events drop column user_id;
alter table public.bond_events add column wallet_account_id uuid not null references public.wallet_accounts(id) on delete cascade;
alter table public.bond_events add constraint bond_events_wallet_conversation_type_date_key unique (wallet_account_id, conversation_id, event_type, event_date);

alter table public.cabi_state drop column user_id;
alter table public.cabi_state add column wallet_account_id uuid not null references public.wallet_accounts(id) on delete cascade;
alter table public.cabi_state add constraint cabi_state_pkey primary key (wallet_account_id);

-- Usage rows retain the optional profile UUID for historical/admin compatibility,
-- while wallet_account_id is the authoritative owner for new requests.
alter table public.usage_logs add column wallet_account_id uuid references public.wallet_accounts(id) on delete set null;

create index conversations_wallet_updated_idx on public.conversations (wallet_account_id, updated_at desc);
create index conversations_wallet_pinned_idx on public.conversations (wallet_account_id, pinned desc, updated_at desc);
create index conversations_title_trgm_idx on public.conversations using gin (title gin_trgm_ops);
create index reactions_wallet_idx on public.message_reactions (wallet_account_id, created_at desc);
create index memories_wallet_category_idx on public.user_memories (wallet_account_id, category, importance desc);
create index bond_events_wallet_date_idx on public.bond_events (wallet_account_id, event_date desc);
create index usage_logs_wallet_created_idx on public.usage_logs (wallet_account_id, created_at desc);

-- Foreign-key existence alone is not an ownership guarantee. Keep retry links
-- inside one conversation and memory-source links inside one wallet tenant.
create or replace function private.enforce_retry_same_conversation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.retry_of_message_id is not null and not exists (
    select 1 from public.messages original
    where original.id = new.retry_of_message_id
      and original.conversation_id = new.conversation_id
  ) then
    raise exception 'retry target must belong to the same conversation';
  end if;
  return new;
end;
$$;
create trigger messages_enforce_retry_owner
  before insert or update of retry_of_message_id, conversation_id on public.messages
  for each row execute function private.enforce_retry_same_conversation();

create or replace function private.enforce_memory_source_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.source_message_id is not null and not exists (
    select 1
    from public.messages source
    join public.conversations conversation on conversation.id = source.conversation_id
    where source.id = new.source_message_id
      and conversation.wallet_account_id = new.wallet_account_id
  ) then
    raise exception 'memory source must belong to the same wallet account';
  end if;
  return new;
end;
$$;
create trigger memories_enforce_source_owner
  before insert or update of source_message_id, wallet_account_id on public.user_memories
  for each row execute function private.enforce_memory_source_owner();

create or replace function private.current_wallet_account_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select nullif(current_setting('request.jwt.claim.cabi_wallet_account_id', true), '')::uuid;
$$;

revoke all on function private.current_wallet_account_id() from public;
grant execute on function private.current_wallet_account_id() to authenticated, service_role;

create policy wallet_accounts_owner_select on public.wallet_accounts
  for select to authenticated
  using (id = private.current_wallet_account_id());
create policy profiles_wallet_owner_select on public.profiles
  for select to authenticated
  using (wallet_account_id = private.current_wallet_account_id());
create policy profiles_wallet_owner_update on public.profiles
  for update to authenticated
  using (wallet_account_id = private.current_wallet_account_id())
  with check (wallet_account_id = private.current_wallet_account_id());
create policy settings_wallet_owner_all on public.user_settings
  for all to authenticated
  using (wallet_account_id = private.current_wallet_account_id())
  with check (wallet_account_id = private.current_wallet_account_id());
create policy conversations_wallet_owner_all on public.conversations
  for all to authenticated
  using (wallet_account_id = private.current_wallet_account_id())
  with check (wallet_account_id = private.current_wallet_account_id());
create policy messages_wallet_owner_select on public.messages
  for select to authenticated
  using (exists (
    select 1 from public.conversations c
    where c.id = conversation_id and c.wallet_account_id = private.current_wallet_account_id()
  ));
create policy messages_wallet_owner_insert_user_only on public.messages
  for insert to authenticated
  with check (role = 'user' and exists (
    select 1 from public.conversations c
    where c.id = conversation_id and c.wallet_account_id = private.current_wallet_account_id()
  ));
create policy reactions_wallet_owner_all on public.message_reactions
  for all to authenticated
  using (wallet_account_id = private.current_wallet_account_id())
  with check (
    wallet_account_id = private.current_wallet_account_id()
    and exists (
      select 1 from public.messages m
      join public.conversations c on c.id = m.conversation_id
      where m.id = message_id and c.wallet_account_id = private.current_wallet_account_id()
    )
  );
create policy summaries_wallet_owner_select on public.conversation_summaries
  for select to authenticated
  using (exists (
    select 1 from public.conversations c
    where c.id = conversation_id and c.wallet_account_id = private.current_wallet_account_id()
  ));
create policy memories_wallet_owner_all on public.user_memories
  for all to authenticated
  using (wallet_account_id = private.current_wallet_account_id())
  with check (wallet_account_id = private.current_wallet_account_id());
create policy bond_profile_wallet_owner_select on public.bond_profiles
  for select to authenticated
  using (wallet_account_id = private.current_wallet_account_id());
create policy bond_events_wallet_owner_select on public.bond_events
  for select to authenticated
  using (wallet_account_id = private.current_wallet_account_id());
create policy cabi_state_wallet_owner_select on public.cabi_state
  for select to authenticated
  using (wallet_account_id = private.current_wallet_account_id());

alter table public.chain_configs enable row level security;
alter table public.wallet_accounts enable row level security;
alter table public.wallet_nonces enable row level security;
alter table public.auth_sessions enable row level security;

revoke all on public.chain_configs, public.wallet_accounts, public.wallet_nonces, public.auth_sessions from anon, authenticated;
grant select on public.wallet_accounts to authenticated;
grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.user_settings, public.conversations, public.message_reactions, public.user_memories to authenticated;
grant select, insert on public.messages to authenticated;
grant select on public.conversation_summaries, public.bond_profiles, public.bond_events, public.cabi_state to authenticated;

-- A single, owner-managed CPU configuration. PRELAUNCH is deliberately seeded
-- without a contract, explorer, or trade URL so the public product cannot invent one.
create table public.cpu_settings (
  singleton boolean primary key default true check (singleton),
  launch_status text not null default 'PRELAUNCH' check (launch_status in ('PRELAUNCH', 'LIVE')),
  token_name text not null default 'Cat Partner Unit' check (char_length(token_name) between 1 and 100),
  ticker text not null default 'CPU' check (char_length(ticker) between 1 and 20),
  contract_address text check (contract_address is null or contract_address ~ '^0x[0-9a-fA-F]{40}$'),
  chain_id bigint references public.chain_configs(chain_id) on delete set null,
  clank_trade_url text check (clank_trade_url is null or clank_trade_url ~ '^https://(www\.)?clank\.trade(/|$)'),
  block_explorer_url text check (block_explorer_url is null or block_explorer_url ~ '^https://'),
  x_url text check (x_url is null or x_url ~ '^https://'),
  website_url text check (website_url is null or website_url ~ '^https://'),
  description text not null default '' check (char_length(description) <= 4000),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check (
    launch_status = 'PRELAUNCH'
    or (contract_address is not null and chain_id is not null and clank_trade_url is not null)
  )
);

create trigger cpu_settings_set_updated_at before update on public.cpu_settings for each row execute function private.set_updated_at();
create or replace function private.validate_live_cpu_chain()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.launch_status = 'LIVE' and not exists (
    select 1 from public.chain_configs c
    where c.chain_id = new.chain_id and c.enabled
  ) then
    raise exception 'live CPU chain must be enabled';
  end if;
  return new;
end;
$$;
create trigger cpu_settings_validate_live_chain
  before insert or update on public.cpu_settings
  for each row execute function private.validate_live_cpu_chain();
alter table public.cpu_settings enable row level security;
revoke all on public.cpu_settings from anon, authenticated;
insert into public.cpu_settings (singleton) values (true) on conflict (singleton) do nothing;

-- Server-only, atomic import used only after an authenticated user explicitly
-- chooses "Save Chat" for an in-memory guest conversation.
create or replace function public.import_guest_conversation(
  p_wallet_account_id uuid,
  p_title text,
  p_messages jsonb
)
returns table (
  id uuid,
  title text,
  pinned boolean,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conversation_id uuid := gen_random_uuid();
  v_created_at timestamptz := timezone('utc', now());
begin
  if not exists (select 1 from public.wallet_accounts wa where wa.id = p_wallet_account_id) then
    raise exception 'wallet account not found';
  end if;
  if jsonb_typeof(p_messages) <> 'array' or jsonb_array_length(p_messages) not between 1 and 100 then
    raise exception 'invalid guest conversation';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_messages) as item
    where item->>'role' not in ('user', 'assistant')
       or nullif(btrim(item->>'content'), '') is null
       or char_length(item->>'content') > 50000
       or (item ? 'metadata' and jsonb_typeof(item->'metadata') <> 'object')
  ) then
    raise exception 'invalid guest message';
  end if;

  insert into public.conversations (id, wallet_account_id, title, pinned, created_at, updated_at)
  values (v_conversation_id, p_wallet_account_id, left(coalesce(nullif(btrim(p_title), ''), 'New chat'), 120), false, v_created_at, v_created_at);

  insert into public.messages (conversation_id, role, content, status, metadata_json, created_at, updated_at)
  select
    v_conversation_id,
    item.value->>'role',
    item.value->>'content',
    'complete',
    coalesce(item.value->'metadata', '{}'::jsonb),
    v_created_at + ((item.ordinality - 1) * interval '1 microsecond'),
    v_created_at + ((item.ordinality - 1) * interval '1 microsecond')
  from jsonb_array_elements(p_messages) with ordinality as item(value, ordinality);

  return query
    select c.id, c.title, c.pinned, c.created_at, c.updated_at
    from public.conversations c
    where c.id = v_conversation_id;
end;
$$;

-- Search both titles and message bodies, always constrained to one wallet owner.
create or replace function public.search_wallet_conversations(
  p_wallet_account_id uuid,
  p_query text,
  p_limit integer default 60
)
returns table (
  id uuid,
  title text,
  pinned boolean,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select c.id, c.title, c.pinned, c.created_at, c.updated_at
  from public.conversations c
  where c.wallet_account_id = p_wallet_account_id
    and (
      c.title ilike ('%' || replace(replace(replace(left(btrim(p_query), 120), '!', '!!'), '%', '!%'), '_', '!_') || '%') escape '!'
      or exists (
        select 1 from public.messages m
        where m.conversation_id = c.id
          and m.content ilike ('%' || replace(replace(replace(left(btrim(p_query), 120), '!', '!!'), '%', '!%'), '_', '!_') || '%') escape '!'
      )
    )
  order by c.pinned desc, c.updated_at desc
  limit least(greatest(coalesce(p_limit, 60), 1), 100);
$$;

-- Atomically replace the owner-managed supported-chain and CPU configuration.
-- The admin route performs richer viem/Zod validation; these checks are the
-- database boundary and prevent a malformed service call from publishing data.
create or replace function public.replace_wallet_product_config(
  p_chains jsonb,
  p_primary_chain_id bigint,
  p_cpu jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_launch_status text := p_cpu->>'launchStatus';
  v_contract_address text := nullif(btrim(p_cpu->>'contractAddress'), '');
  v_cpu_chain_id bigint := nullif(p_cpu->>'chainId', '')::bigint;
  v_clank_trade_url text := nullif(btrim(p_cpu->>'clankTradeUrl'), '');
begin
  if jsonb_typeof(p_chains) <> 'array' or jsonb_array_length(p_chains) > 20 then
    raise exception 'invalid chain configuration';
  end if;
  if jsonb_typeof(p_cpu) <> 'object' then
    raise exception 'invalid CPU configuration';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_chains) item
    where (item->>'id')::bigint <= 0
       or nullif(btrim(item->>'name'), '') is null
       or nullif(btrim(item#>>'{nativeCurrency,name}'), '') is null
       or nullif(btrim(item#>>'{nativeCurrency,symbol}'), '') is null
       or coalesce(item->>'rpcUrl', '') !~ '^https://'
       or coalesce(item->>'blockExplorerUrl', '') !~ '^https://'
       or jsonb_typeof(item->'enabled') <> 'boolean'
  ) then
    raise exception 'invalid supported chain';
  end if;
  if (
    select count(*) <> count(distinct (item->>'id')::bigint)
    from jsonb_array_elements(p_chains) item
  ) then
    raise exception 'duplicate chain id';
  end if;
  if p_primary_chain_id is not null and not exists (
    select 1 from jsonb_array_elements(p_chains) item
    where (item->>'id')::bigint = p_primary_chain_id and (item->>'enabled')::boolean
  ) then
    raise exception 'primary chain must be enabled';
  end if;
  if v_launch_status not in ('PRELAUNCH', 'LIVE') then
    raise exception 'invalid CPU launch status';
  end if;
  if v_contract_address is not null and v_contract_address !~ '^0x[0-9a-fA-F]{40}$' then
    raise exception 'invalid CPU contract address';
  end if;
  if v_cpu_chain_id is not null and not exists (
    select 1 from jsonb_array_elements(p_chains) item
    where (item->>'id')::bigint = v_cpu_chain_id and (item->>'enabled')::boolean
  ) then
    raise exception 'CPU chain must be enabled';
  end if;
  if v_launch_status = 'LIVE' and (v_contract_address is null or v_cpu_chain_id is null or v_clank_trade_url is null) then
    raise exception 'live CPU configuration is incomplete';
  end if;
  if v_clank_trade_url is not null and v_clank_trade_url !~ '^https://(www\.)?clank\.trade(/|$)' then
    raise exception 'invalid Clank.trade URL';
  end if;

  -- Break the existing CPU foreign-key reference without violating the LIVE
  -- completeness check, then replace the supported-chain set atomically.
  update public.cpu_settings
  set launch_status = 'PRELAUNCH',
      contract_address = null,
      chain_id = null,
      clank_trade_url = null
  where singleton;
  -- Preserve rows whose chain IDs still exist so wallet preferences are not
  -- nulled by ON DELETE SET NULL on every routine configuration save.
  update public.chain_configs set is_primary = false where is_primary;
  insert into public.chain_configs (
    chain_id,
    chain_name,
    native_currency_name,
    native_currency_symbol,
    native_currency_decimals,
    rpc_url,
    block_explorer_url,
    icon_url,
    enabled,
    is_primary
  )
  select
    (item->>'id')::bigint,
    btrim(item->>'name'),
    btrim(item#>>'{nativeCurrency,name}'),
    btrim(item#>>'{nativeCurrency,symbol}'),
    coalesce((item#>>'{nativeCurrency,decimals}')::smallint, 18),
    btrim(item->>'rpcUrl'),
    nullif(btrim(item->>'blockExplorerUrl'), ''),
    nullif(btrim(item->>'iconUrl'), ''),
    (item->>'enabled')::boolean,
    (item->>'id')::bigint = p_primary_chain_id
  from jsonb_array_elements(p_chains) item
  on conflict (chain_id) do update set
    chain_name = excluded.chain_name,
    native_currency_name = excluded.native_currency_name,
    native_currency_symbol = excluded.native_currency_symbol,
    native_currency_decimals = excluded.native_currency_decimals,
    rpc_url = excluded.rpc_url,
    block_explorer_url = excluded.block_explorer_url,
    icon_url = excluded.icon_url,
    enabled = excluded.enabled,
    is_primary = excluded.is_primary;

  delete from public.chain_configs existing
  where not exists (
    select 1 from jsonb_array_elements(p_chains) item
    where (item->>'id')::bigint = existing.chain_id
  );

  insert into public.cpu_settings (
    singleton,
    launch_status,
    token_name,
    ticker,
    contract_address,
    chain_id,
    clank_trade_url,
    block_explorer_url,
    x_url,
    website_url,
    description
  ) values (
    true,
    v_launch_status,
    left(coalesce(nullif(btrim(p_cpu->>'tokenName'), ''), 'Cat Partner Unit'), 100),
    left(upper(coalesce(nullif(btrim(p_cpu->>'ticker'), ''), 'CPU')), 20),
    v_contract_address,
    v_cpu_chain_id,
    v_clank_trade_url,
    nullif(btrim(p_cpu->>'explorerUrl'), ''),
    nullif(btrim(p_cpu->>'xUrl'), ''),
    nullif(btrim(p_cpu->>'websiteUrl'), ''),
    left(coalesce(p_cpu->>'description', ''), 4000)
  )
  on conflict (singleton) do update set
    launch_status = excluded.launch_status,
    token_name = excluded.token_name,
    ticker = excluded.ticker,
    contract_address = excluded.contract_address,
    chain_id = excluded.chain_id,
    clank_trade_url = excluded.clank_trade_url,
    block_explorer_url = excluded.block_explorer_url,
    x_url = excluded.x_url,
    website_url = excluded.website_url,
    description = excluded.description,
    updated_at = timezone('utc', now());
end;
$$;

drop function if exists public.record_bond_event(uuid, uuid, text);
create function public.record_bond_event(p_wallet_account_id uuid, p_conversation_id uuid, p_event_type text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_points integer := 0;
  v_today date := (timezone('utc', now()))::date;
begin
  if p_event_type not in ('conversation_turn','memory_saved','returning_day','milestone') then
    raise exception 'invalid event';
  end if;
  if not exists (
    select 1 from public.conversations c
    where c.id = p_conversation_id and c.wallet_account_id = p_wallet_account_id
  ) then
    raise exception 'conversation not owned by wallet';
  end if;

  insert into public.bond_events (wallet_account_id, conversation_id, event_type, event_date, points)
  values (p_wallet_account_id, p_conversation_id, p_event_type, v_today, case p_event_type when 'memory_saved' then 5 when 'returning_day' then 6 when 'milestone' then 8 else 3 end)
  on conflict (wallet_account_id, conversation_id, event_type, event_date) do nothing;

  select coalesce(sum(be.points), 0) into v_points
  from public.bond_events be
  where be.wallet_account_id = p_wallet_account_id;

  insert into public.bond_profiles (wallet_account_id, bond_points, bond_level, conversation_days, last_interaction_at)
  values (
    p_wallet_account_id,
    v_points,
    least(10, floor(sqrt(v_points::numeric / 18))::integer + 1),
    (select count(distinct be.event_date) from public.bond_events be where be.wallet_account_id = p_wallet_account_id),
    timezone('utc', now())
  )
  on conflict (wallet_account_id) do update set
    bond_points = excluded.bond_points,
    bond_level = excluded.bond_level,
    conversation_days = excluded.conversation_days,
    last_interaction_at = excluded.last_interaction_at,
    updated_at = timezone('utc', now());
  return v_points;
end;
$$;

drop function if exists public.clear_user_data(uuid);
create function public.clear_user_data(p_wallet_account_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.conversations where wallet_account_id = p_wallet_account_id;
  delete from public.user_memories where wallet_account_id = p_wallet_account_id;
  delete from public.bond_events where wallet_account_id = p_wallet_account_id;
  delete from public.bond_profiles where wallet_account_id = p_wallet_account_id;
  delete from public.cabi_state where wallet_account_id = p_wallet_account_id;
  delete from public.user_settings where wallet_account_id = p_wallet_account_id;
  update public.profiles
  set display_name = null, preferred_name = null, avatar_url = null, updated_at = timezone('utc', now())
  where wallet_account_id = p_wallet_account_id;
end;
$$;

revoke all on function public.import_guest_conversation(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.search_wallet_conversations(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.replace_wallet_product_config(jsonb, bigint, jsonb) from public, anon, authenticated;
revoke all on function public.record_bond_event(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.clear_user_data(uuid) from public, anon, authenticated;
grant execute on function public.import_guest_conversation(uuid, text, jsonb) to service_role;
grant execute on function public.search_wallet_conversations(uuid, text, integer) to service_role;
grant execute on function public.replace_wallet_product_config(jsonb, bigint, jsonb) to service_role;
grant execute on function public.record_bond_event(uuid, uuid, text) to service_role;
grant execute on function public.clear_user_data(uuid) to service_role;

commit;
