create extension if not exists pgcrypto;

create table if not exists public.weighted_directed_flow_map_shares (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  chart_config jsonb not null,
  created_by uuid null,
  created_at timestamptz not null default timezone('utc', now()),
  source_project_id uuid null
);

create index if not exists weighted_directed_flow_map_shares_created_at_idx
  on public.weighted_directed_flow_map_shares (created_at desc);

create unique index if not exists weighted_directed_flow_map_shares_source_project_id_unique
  on public.weighted_directed_flow_map_shares (source_project_id)
  where source_project_id is not null;

alter table public.weighted_directed_flow_map_shares enable row level security;

create policy "Anyone can read shares"
  on public.weighted_directed_flow_map_shares for select using (true);
