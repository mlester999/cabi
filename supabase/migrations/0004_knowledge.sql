begin;

create table public.knowledge_sync_runs (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  status text not null check (status in ('queued','running','complete','failed')),
  pages_indexed integer not null default 0,
  chunks_indexed integer not null default 0,
  errors_json jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  completed_at timestamptz
);

create table public.knowledge_documents (
  id uuid primary key default gen_random_uuid(),
  source_url text not null,
  canonical_url text not null unique,
  title text not null,
  content text not null,
  content_hash text not null,
  etag text,
  last_modified text,
  fetched_at timestamptz not null default timezone('utc', now()),
  status text not null default 'active' check (status in ('active','stale','failed','quarantined')),
  search_vector tsvector generated always as (to_tsvector('english', coalesce(title,'') || ' ' || coalesce(content,''))) stored
);

create table public.knowledge_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.knowledge_documents(id) on delete cascade,
  chunk_index integer not null check (chunk_index >= 0),
  content text not null,
  content_hash text not null,
  token_estimate integer not null default 0,
  metadata_json jsonb not null default '{}'::jsonb,
  search_vector tsvector generated always as (to_tsvector('english', coalesce(content,''))) stored,
  created_at timestamptz not null default timezone('utc', now()),
  unique (document_id, chunk_index),
  unique (document_id, content_hash)
);

create index knowledge_documents_search_idx on public.knowledge_documents using gin (search_vector);
create index knowledge_documents_title_trgm_idx on public.knowledge_documents using gin (title gin_trgm_ops);
create index knowledge_documents_status_fetched_idx on public.knowledge_documents (status, fetched_at desc);
create index knowledge_chunks_search_idx on public.knowledge_chunks using gin (search_vector);
create index knowledge_chunks_document_idx on public.knowledge_chunks (document_id, chunk_index);
create index knowledge_sync_runs_created_idx on public.knowledge_sync_runs (created_at desc);

alter table public.knowledge_sync_runs enable row level security;
alter table public.knowledge_documents enable row level security;
alter table public.knowledge_chunks enable row level security;
revoke all on public.knowledge_sync_runs, public.knowledge_documents, public.knowledge_chunks from anon, authenticated;

create or replace function public.search_knowledge_chunks(p_query text, p_limit integer default 6)
returns table (chunk_id uuid, title text, source_url text, content text, score real, fetched_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  with query as (select websearch_to_tsquery('english', left(p_query, 500)) as value)
  select c.id, d.title, d.canonical_url, c.content,
    (ts_rank_cd(c.search_vector, query.value) + greatest(similarity(d.title, p_query), 0) * 0.35)::real,
    d.fetched_at
  from public.knowledge_chunks c
  join public.knowledge_documents d on d.id = c.document_id
  cross join query
  where d.status = 'active' and (c.search_vector @@ query.value or similarity(d.title, p_query) > 0.15 or c.content ilike '%' || replace(left(p_query, 120), '%', '') || '%')
  order by 5 desc
  limit least(greatest(p_limit, 1), 10);
$$;

revoke all on function public.search_knowledge_chunks(text, integer) from public, anon, authenticated;
grant execute on function public.search_knowledge_chunks(text, integer) to service_role;

commit;
