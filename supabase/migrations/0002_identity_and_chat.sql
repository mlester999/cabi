begin;

create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete set null,
  display_name text check (char_length(display_name) <= 100),
  preferred_name text check (char_length(preferred_name) <= 80),
  avatar_url text check (char_length(avatar_url) <= 1000),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.user_settings (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  memory_enabled boolean not null default true,
  sound_enabled boolean not null default false,
  animation_mode text not null default 'full' check (animation_mode in ('full','reduced')),
  appearance text not null default 'dark' check (appearance in ('dark','oled')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null default 'New chat' check (char_length(title) between 1 and 120),
  pinned boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  role text not null check (role in ('user','assistant','system','tool')),
  content text not null default '' check (char_length(content) <= 100000),
  status text not null default 'complete' check (status in ('streaming','complete','failed','cancelled')),
  client_request_id uuid,
  retry_of_message_id uuid references public.messages(id) on delete set null,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (conversation_id, client_request_id)
);

create table public.message_reactions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  reaction text not null check (reaction in ('heart','laugh','helpful')),
  created_at timestamptz not null default timezone('utc', now()),
  unique (message_id, user_id)
);

create table public.conversation_summaries (
  conversation_id uuid primary key references public.conversations(id) on delete cascade,
  summary text not null check (char_length(summary) <= 20000),
  last_message_id uuid references public.messages(id) on delete set null,
  last_message_seq bigint,
  updated_at timestamptz not null default timezone('utc', now())
);

create index conversations_user_updated_idx on public.conversations (user_id, updated_at desc);
create index conversations_user_pinned_idx on public.conversations (user_id, pinned desc, updated_at desc);
create index messages_conversation_created_idx on public.messages (conversation_id, created_at, id);
create index reactions_user_idx on public.message_reactions (user_id, created_at desc);

create trigger profiles_set_updated_at before update on public.profiles for each row execute function private.set_updated_at();
create trigger user_settings_set_updated_at before update on public.user_settings for each row execute function private.set_updated_at();
create trigger conversations_set_updated_at before update on public.conversations for each row execute function private.set_updated_at();
create trigger messages_set_updated_at before update on public.messages for each row execute function private.set_updated_at();

alter table public.profiles enable row level security;
alter table public.user_settings enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.message_reactions enable row level security;
alter table public.conversation_summaries enable row level security;

create policy profiles_owner_select on public.profiles for select to authenticated using (id = private.current_profile_id() or auth_user_id = auth.uid());
create policy profiles_owner_update on public.profiles for update to authenticated using (id = private.current_profile_id() or auth_user_id = auth.uid()) with check (id = private.current_profile_id() or auth_user_id = auth.uid());
create policy settings_owner_all on public.user_settings for all to authenticated using (user_id = private.current_profile_id()) with check (user_id = private.current_profile_id());
create policy conversations_owner_all on public.conversations for all to authenticated using (user_id = private.current_profile_id()) with check (user_id = private.current_profile_id());
create policy messages_owner_select on public.messages for select to authenticated using (exists (select 1 from public.conversations c where c.id = conversation_id and c.user_id = private.current_profile_id()));
create policy messages_owner_insert_user_only on public.messages for insert to authenticated with check (role = 'user' and exists (select 1 from public.conversations c where c.id = conversation_id and c.user_id = private.current_profile_id()));
create policy reactions_owner_all on public.message_reactions for all to authenticated using (user_id = private.current_profile_id()) with check (user_id = private.current_profile_id() and exists (select 1 from public.messages m join public.conversations c on c.id = m.conversation_id where m.id = message_id and c.user_id = private.current_profile_id()));
create policy summaries_owner_select on public.conversation_summaries for select to authenticated using (exists (select 1 from public.conversations c where c.id = conversation_id and c.user_id = private.current_profile_id()));

revoke all on all tables in schema public from anon, authenticated;
grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.user_settings, public.conversations, public.message_reactions to authenticated;
grant select, insert on public.messages to authenticated;
grant select on public.conversation_summaries to authenticated;

commit;
