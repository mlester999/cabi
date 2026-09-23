begin;

create table public.user_memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  category text not null default 'general' check (char_length(category) <= 50),
  content text not null check (char_length(content) between 1 and 2000),
  normalized_key text not null check (char_length(normalized_key) between 1 and 160),
  importance numeric(4,3) not null default 0.5 check (importance between 0 and 1),
  sensitivity text not null default 'low' check (sensitivity in ('low','restricted')),
  storage_reason text not null default 'explicit_request' check (storage_reason in ('explicit_request','user_preference','manual_admin')),
  source_message_id uuid references public.messages(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (user_id, normalized_key)
);

create table public.bond_profiles (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  bond_points integer not null default 0 check (bond_points >= 0),
  bond_level smallint not null default 1 check (bond_level between 1 and 10),
  conversation_days integer not null default 0 check (conversation_days >= 0),
  last_interaction_at timestamptz,
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.bond_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete cascade,
  event_type text not null check (event_type in ('conversation_turn','memory_saved','returning_day','milestone')),
  event_date date not null default (timezone('utc', now()))::date,
  points smallint not null default 0 check (points between 0 and 20),
  created_at timestamptz not null default timezone('utc', now()),
  unique (user_id, conversation_id, event_type, event_date)
);

create table public.cabi_state (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  mood text not null default 'cozy' check (mood in ('cozy','playful','curious','sleepy','excited','focused','calm')),
  state_json jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default timezone('utc', now())
);

create index memories_user_category_idx on public.user_memories (user_id, category, importance desc);
create index memories_content_trgm_idx on public.user_memories using gin (content gin_trgm_ops);
create index bond_events_user_date_idx on public.bond_events (user_id, event_date desc);

create trigger memories_set_updated_at before update on public.user_memories for each row execute function private.set_updated_at();
create trigger bond_profiles_set_updated_at before update on public.bond_profiles for each row execute function private.set_updated_at();
create trigger cabi_state_set_updated_at before update on public.cabi_state for each row execute function private.set_updated_at();

alter table public.user_memories enable row level security;
alter table public.bond_profiles enable row level security;
alter table public.bond_events enable row level security;
alter table public.cabi_state enable row level security;

create policy memories_owner_all on public.user_memories for all to authenticated using (user_id = private.current_profile_id()) with check (user_id = private.current_profile_id());
create policy bond_profile_owner_select on public.bond_profiles for select to authenticated using (user_id = private.current_profile_id());
create policy bond_events_owner_select on public.bond_events for select to authenticated using (user_id = private.current_profile_id());
create policy cabi_state_owner_select on public.cabi_state for select to authenticated using (user_id = private.current_profile_id());

grant select, insert, update, delete on public.user_memories to authenticated;
grant select on public.bond_profiles, public.bond_events, public.cabi_state to authenticated;

create or replace function public.record_bond_event(p_user_id uuid, p_conversation_id uuid, p_event_type text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_points integer := 0;
  v_today date := (timezone('utc', now()))::date;
begin
  if p_event_type not in ('conversation_turn','memory_saved','returning_day','milestone') then raise exception 'invalid event'; end if;
  insert into public.bond_events (user_id, conversation_id, event_type, event_date, points)
  values (p_user_id, p_conversation_id, p_event_type, v_today, case p_event_type when 'memory_saved' then 5 when 'returning_day' then 6 when 'milestone' then 8 else 3 end)
  on conflict (user_id, conversation_id, event_type, event_date) do nothing;
  select coalesce(sum(points), 0) into v_points from public.bond_events where user_id = p_user_id;
  insert into public.bond_profiles (user_id, bond_points, bond_level, conversation_days, last_interaction_at)
  values (p_user_id, v_points, least(10, floor(sqrt(v_points::numeric / 18))::integer + 1), (select count(distinct event_date) from public.bond_events where user_id = p_user_id), timezone('utc', now()))
  on conflict (user_id) do update set bond_points = excluded.bond_points, bond_level = excluded.bond_level, conversation_days = excluded.conversation_days, last_interaction_at = excluded.last_interaction_at, updated_at = timezone('utc', now());
  return v_points;
end;
$$;

revoke all on function public.record_bond_event(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.record_bond_event(uuid, uuid, text) to service_role;

commit;
