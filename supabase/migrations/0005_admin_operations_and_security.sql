begin;

create table public.admin_users (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete cascade,
  email text not null unique,
  role text not null default 'admin' check (role in ('admin','owner','analyst')),
  active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.app_settings (
  key text primary key check (char_length(key) between 1 and 100),
  value_json jsonb not null default '{}'::jsonb,
  updated_by text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.secret_settings (
  key text primary key,
  encrypted_value jsonb not null,
  last_four text not null check (char_length(last_four) = 4),
  updated_by text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.usage_logs (
  id bigint generated always as identity primary key,
  user_id uuid references public.profiles(id) on delete set null,
  conversation_id uuid references public.conversations(id) on delete set null,
  provider text not null,
  model text,
  input_tokens integer,
  output_tokens integer,
  latency_ms integer,
  status text not null check (status in ('success','failed','cancelled')),
  created_at timestamptz not null default timezone('utc', now())
);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default timezone('utc', now()),
  request_id text,
  actor_type text not null check (actor_type in ('admin','user','system')),
  actor_id text,
  action text not null,
  target_type text,
  target_id text,
  outcome text not null check (outcome in ('success','failure')),
  ip_hash text,
  user_agent_hash text,
  metadata_json jsonb not null default '{}'::jsonb
);

create table public.rate_limit_buckets (
  scope text not null,
  key_hash text not null,
  window_start timestamptz not null,
  count integer not null default 0,
  expires_at timestamptz not null,
  primary key (scope, key_hash, window_start)
);

create index usage_logs_created_idx on public.usage_logs (created_at desc);
create index usage_logs_user_created_idx on public.usage_logs (user_id, created_at desc);
create index audit_logs_occurred_idx on public.audit_logs (occurred_at desc);
create index audit_logs_actor_idx on public.audit_logs (actor_id, occurred_at desc);
create index rate_limit_expiry_idx on public.rate_limit_buckets (expires_at);

create trigger admin_users_set_updated_at before update on public.admin_users for each row execute function private.set_updated_at();
create trigger app_settings_set_updated_at before update on public.app_settings for each row execute function private.set_updated_at();
create trigger secret_settings_set_updated_at before update on public.secret_settings for each row execute function private.set_updated_at();

alter table public.admin_users enable row level security;
alter table public.app_settings enable row level security;
alter table public.secret_settings enable row level security;
alter table public.usage_logs enable row level security;
alter table public.audit_logs enable row level security;
alter table public.rate_limit_buckets enable row level security;
revoke all on public.admin_users, public.app_settings, public.secret_settings, public.usage_logs, public.audit_logs, public.rate_limit_buckets from anon, authenticated;

create or replace function public.consume_rate_limit(p_scope text, p_key_hash text, p_limit integer, p_window_seconds integer)
returns table (allowed boolean, remaining integer, retry_after integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := timezone('utc', now());
  v_window timestamptz;
  v_count integer;
begin
  if p_limit < 1 or p_window_seconds < 1 then raise exception 'invalid rate limit'; end if;
  v_window := to_timestamp(floor(extract(epoch from v_now) / p_window_seconds) * p_window_seconds);
  insert into public.rate_limit_buckets (scope, key_hash, window_start, count, expires_at)
  values (left(p_scope, 100), left(p_key_hash, 200), v_window, 1, v_window + make_interval(secs => p_window_seconds * 2))
  on conflict (scope, key_hash, window_start) do update set count = public.rate_limit_buckets.count + 1
  returning count into v_count;
  return query select v_count <= p_limit, greatest(0, p_limit - v_count), greatest(1, ceil(extract(epoch from (v_window + make_interval(secs => p_window_seconds) - v_now)))::integer);
end;
$$;

create or replace function public.clear_user_data(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.conversations where user_id = p_user_id;
  delete from public.user_memories where user_id = p_user_id;
  delete from public.bond_events where user_id = p_user_id;
  delete from public.bond_profiles where user_id = p_user_id;
  delete from public.cabi_state where user_id = p_user_id;
  update public.profiles set display_name = null, preferred_name = null, avatar_url = null, updated_at = timezone('utc', now()) where id = p_user_id;
end;
$$;

create or replace function private.prevent_audit_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$ begin raise exception 'audit logs are append-only'; end; $$;
create trigger audit_logs_append_only before update or delete on public.audit_logs for each row execute function private.prevent_audit_mutation();

revoke all on function public.consume_rate_limit(text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.clear_user_data(uuid) from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text, text, integer, integer) to service_role;
grant execute on function public.clear_user_data(uuid) to service_role;

insert into public.app_settings (key, value_json) values
  ('branding', '{"projectName":"Cabi","ticker":"CPU","tagline":"Cute, loyal, and always by your side.","primaryColor":"#C4B5FD","secondaryColor":"#8B5CF6","xUrl":"","clankUrl":"","websiteUrl":"","contractAddress":"","mainAsset":"/assets/cabi-main.png","mascotAsset":"/assets/cabi-mascot.png"}'::jsonb),
  ('cpu_config', '{"coinName":"Cat Partner Unit","ticker":"CPU","contractAddress":"","clankUrl":"","xUrl":"","launchStatus":"Not configured","description":"","announcement":""}'::jsonb)
on conflict (key) do nothing;

commit;
