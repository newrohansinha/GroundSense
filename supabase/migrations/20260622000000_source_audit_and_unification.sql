-- ============================================================================
-- One-truth-system unification: raw source-observation audit, first-class risk
-- basis columns, and real run counters. ADDITIVE + IDEMPOTENT.
-- ============================================================================

-- 1. Raw source observation audit — every official numeric_shock links here so
--    the UI can prove the displayed number came from a real API response.
create table if not exists public.source_observations (
  id uuid primary key default gen_random_uuid(),
  source_run_id uuid,
  source_name text,
  endpoint text,
  request_params jsonb default '{}',
  status_code integer,
  fetched_at timestamptz default now(),
  source_series_id text,
  source_metric_name text,
  source_period text,
  raw_current_value text,
  raw_previous_value text,
  parsed_current_value numeric,
  parsed_previous_value numeric,
  parsed_percent_change numeric,
  raw_payload jsonb default '{}',
  parse_status text,
  parse_error text,
  numeric_shock_id uuid,
  created_at timestamptz default now()
);
create index if not exists source_observations_run_idx on public.source_observations(source_run_id);
create index if not exists source_observations_source_idx on public.source_observations(source_name);
create index if not exists source_observations_shock_idx on public.source_observations(numeric_shock_id);

alter table public.numeric_shocks
  add column if not exists source_observation_id uuid;

-- 2. First-class basis columns on risk_register (so audits/joins don't dig in JSON).
alter table public.risk_register
  add column if not exists numeric_shock_id uuid,
  add column if not exists formula text,
  add column if not exists formula_inputs jsonb default '{}',
  add column if not exists business_estimate numeric,
  add column if not exists source_observation_id uuid;

-- 3. Real run counters (one truth system).
alter table public.intelligence_run_summaries
  add column if not exists sources_attempted integer not null default 0,
  add column if not exists sources_succeeded integer not null default 0,
  add column if not exists sources_failed integer not null default 0,
  add column if not exists source_observations_created integer not null default 0,
  add column if not exists numeric_shocks_used_in_candidates integer not null default 0,
  add column if not exists numeric_shocks_used_in_published integer not null default 0,
  add column if not exists published_metric_backed integer not null default 0,
  add column if not exists published_article_claim_backed integer not null default 0,
  add column if not exists published_scenario_backed integer not null default 0;

-- RLS read for the audit table (service role writes).
alter table public.source_observations enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='source_observations' and policyname='source_observations_read') then
    create policy source_observations_read on public.source_observations for select to authenticated using (true);
  end if;
end $$;

notify pgrst, 'reload schema';
