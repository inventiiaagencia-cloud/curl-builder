create extension if not exists pgcrypto;

create table if not exists public.environments (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  product text not null check (product in ('evolution_api', 'evo_go', 'evo_crm')),
  base_url text not null,
  api_key text not null default '',
  extra_headers jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists environments_product_name_unique
  on public.environments (product, lower(name));

create table if not exists public.curl_history (
  id uuid primary key default gen_random_uuid(),
  endpoint_id text not null,
  environment_id uuid references public.environments(id) on delete set null,
  final_curl text not null,
  status_code int not null default 0,
  response_body jsonb,
  error_message text,
  tested_at timestamptz not null default now()
);

alter table public.environments enable row level security;
alter table public.curl_history enable row level security;

drop policy if exists "environments_all" on public.environments;
drop policy if exists "history_all" on public.curl_history;

create policy "environments_all"
  on public.environments
  for all
  using (true)
  with check (true);

create policy "history_all"
  on public.curl_history
  for all
  using (true)
  with check (true);
