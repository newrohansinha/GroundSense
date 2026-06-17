-- Free Source Fusion + Verified Shock Engine
-- Canonical external-metric storage, kept separate from raw news and company calibration.
-- Non-destructive: CREATE TABLE IF NOT EXISTS only. RLS left disabled to match the
-- existing GroundSense schema (the app uses the anon key directly). Surface RLS to the
-- user separately — do not enable here without policies or the client loses access.

-- Registered free/public data sources.
create table if not exists public.external_sources (
  id uuid primary key default gen_random_uuid(),
  source_id text unique not null,
  name text not null,
  category text,
  source_type text,
  trust_tier text,
  access_mode text,
  requires_key boolean default false,
  configured boolean default false,
  status text default 'unknown',
  last_run_at timestamptz,
  coverage_domains jsonb default '[]'::jsonb,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Canonical structured metrics (one row per metric/period/source).
create table if not exists public.external_metrics (
  id uuid primary key default gen_random_uuid(),
  source_id text,
  metric_key text,
  metric_name text,
  category text,
  driver text,
  commodity text,
  geography text,
  lane text,
  hts_code text,
  unit text,
  value numeric,
  baseline_value numeric,
  current_value numeric,
  percent_change numeric,
  period_start date,
  period_end date,
  observed_at timestamptz,
  published_at timestamptz,
  source_url text,
  source_name text,
  source_record_id text,
  trust_tier text,
  company_id uuid,
  created_at timestamptz default now()
);

-- Time-series observations behind a metric.
create table if not exists public.external_metric_observations (
  id uuid primary key default gen_random_uuid(),
  metric_key text,
  source_id text,
  value numeric,
  unit text,
  observed_at timestamptz,
  period_start date,
  period_end date,
  source_record_id text,
  source_url text,
  created_at timestamptz default now()
);

-- Numeric claims extracted from article/event text (claims, not shocks).
create table if not exists public.article_metric_claims (
  id uuid primary key default gen_random_uuid(),
  raw_event_id uuid,
  company_id uuid,
  claim_text text,
  extracted_value numeric,
  extracted_unit text,
  metric_key text,
  driver text,
  period_text text,
  verification_status text,
  matched_verified_shock_id uuid,
  mismatch_reason text,
  created_at timestamptz default now()
);

-- Verified external shocks (a number backed by a trusted source).
create table if not exists public.verified_shocks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid,
  driver text,
  shock_type text,
  metric_key text,
  baseline_value numeric,
  current_value numeric,
  absolute_change numeric,
  percent_change numeric,
  unit text,
  period_start date,
  period_end date,
  source_count integer default 1,
  primary_source_id text,
  verification_status text,
  confidence_score numeric,
  source_agreement_score numeric,
  notes text,
  created_at timestamptz default now()
);

-- One row per source-fusion run.
create table if not exists public.source_fusion_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid,
  run_status text,
  sources_checked jsonb default '[]'::jsonb,
  metrics_ingested integer default 0,
  shocks_verified integer default 0,
  claims_verified integer default 0,
  claims_rejected integer default 0,
  errors jsonb default '[]'::jsonb,
  created_at timestamptz default now()
);

-- Manual structured-metric CSV import audit log.
create table if not exists public.manual_external_metric_imports (
  id uuid primary key default gen_random_uuid(),
  company_id uuid,
  category text,
  file_name text,
  row_count integer default 0,
  valid_row_count integer default 0,
  invalid_row_count integer default 0,
  duplicate_row_count integer default 0,
  status text,
  parsed_preview jsonb,
  validation_errors jsonb,
  created_at timestamptz default now()
);

-- Indexes
create index if not exists idx_external_metrics_company on public.external_metrics (company_id);
create index if not exists idx_external_metrics_metric_key on public.external_metrics (metric_key);
create index if not exists idx_external_metrics_driver on public.external_metrics (driver);
create index if not exists idx_external_metric_obs_metric_key on public.external_metric_observations (metric_key);
create index if not exists idx_article_metric_claims_company on public.article_metric_claims (company_id);
create index if not exists idx_article_metric_claims_event on public.article_metric_claims (raw_event_id);
create index if not exists idx_verified_shocks_company on public.verified_shocks (company_id);
create index if not exists idx_verified_shocks_driver on public.verified_shocks (driver);
create index if not exists idx_source_fusion_runs_company on public.source_fusion_runs (company_id);
create index if not exists idx_manual_metric_imports_company on public.manual_external_metric_imports (company_id);
