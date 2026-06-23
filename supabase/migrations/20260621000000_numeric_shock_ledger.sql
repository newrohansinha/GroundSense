-- ============================================================================
-- PHASE 1 — Canonical Numeric Shock Ledger.
--
-- One table that unifies every numeric signal the product can reason about:
--   official structured metrics (BLS/FRED/EIA/Census/USITC/UN Comtrade),
--   manual + company structured metrics, SEC company baselines, and
--   article numeric claims. Candidate generation reads from THIS table, not
--   from generic article summaries.
--
-- Plus a source_health table the server connectors upsert after each refresh,
-- and a source_health_v view that augments it with live ledger counts.
--
-- ADDITIVE + IDEMPOTENT. Safe to re-run.
-- ============================================================================

create extension if not exists pgcrypto;

create table if not exists public.numeric_shocks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid,                       -- null = global/context shock not yet company-mapped

  -- Provenance ---------------------------------------------------------------
  source_type text not null default 'context_only',
    -- official_structured_metric | manual_structured_metric | company_structured_metric
    -- | article_numeric_claim | company_baseline | context_only
  source_name text,                      -- 'BLS','FRED','EIA','Census','USITC','UN Comtrade','SEC', domain, etc.
  source_tier integer,                   -- 1 = official, 2 = trade press, 3 = other
  source_trust text,                     -- official | company | corroborated | article | context
  source_url text,
  source_domain text,
  source_period text,                    -- human label e.g. 'May 2026','2026-06 (weekly)'
  period_start date,
  period_end date,
  observed_at timestamptz,
  refreshed_at timestamptz default now(),

  -- What it is ---------------------------------------------------------------
  driver text,                           -- canonical driver e.g. freight_logistics_cost
  driver_category text,                  -- freight | metals | tariff | fuel | fx | demand | trade_flow | context
  commodity text,
  geography text,
  entity text,
  metric_name text,
  metric_id text,                        -- series id (BLS series, FRED series_id, etc.)
  claim_text text,
  snippet text,

  -- The numbers --------------------------------------------------------------
  current_value numeric,
  previous_value numeric,
  numeric_value numeric,                 -- the headline magnitude (usually the change)
  numeric_unit text,                     -- pct | pp | bps | index | usd | usd_per_gal | level | volume
  percent_change numeric,
  percentage_point_change numeric,
  bps_change numeric,
  change_type text,
    -- percent_change | percentage_point_change | bps_change | index_change
    -- | price_change | dollar_change | volume_change | rate_change | level
  direction text,                        -- up | down | mixed | unknown

  -- Quality / routing --------------------------------------------------------
  freshness_level text,                  -- fresh | latest_official | acceptable_lag | stale | context_only
  confidence numeric,                    -- 0..1
  extraction_method text,                -- official_api | csv_upload | sec_parser | article_body_llm | article_regex | manual
  corroboration_status text default 'uncorroborated',
    -- official | company | corroborated | uncorroborated | contradicted | context_only
  can_publish boolean not null default false,
  cannot_publish_reason text,
  company_mapping_status text default 'context_only',
    -- mapped | partially_mapped | missing_company_exposure | context_only

  -- Linkage / dedupe ---------------------------------------------------------
  shock_key text,                        -- stable key for idempotent upsert
  run_summary_id uuid,                   -- run that created/last-touched this shock
  article_claim_id uuid,                 -- -> article_metric_claims.id (when source_type=article_numeric_claim)
  raw_event_id uuid,                     -- -> raw_events.id

  raw_source_payload jsonb not null default '{}',
  created_at timestamptz default now()
);

-- Stable idempotent upsert key (connectors compute a deterministic shock_key).
create unique index if not exists numeric_shocks_shock_key_uidx
  on public.numeric_shocks(shock_key) where shock_key is not null;

create index if not exists numeric_shocks_company_driver_idx
  on public.numeric_shocks(company_id, driver);
create index if not exists numeric_shocks_source_type_idx
  on public.numeric_shocks(source_type);
create index if not exists numeric_shocks_can_publish_idx
  on public.numeric_shocks(can_publish);
create index if not exists numeric_shocks_driver_category_idx
  on public.numeric_shocks(driver_category);
create index if not exists numeric_shocks_run_idx
  on public.numeric_shocks(run_summary_id);

comment on table public.numeric_shocks is
  'Canonical numeric signal ledger. Candidate generation reads from here. SEC rows are company_baseline, never publishable external shocks.';

-- ── Source health (connectors upsert one row per source per refresh) ────────
create table if not exists public.source_health (
  source_key text primary key,           -- bls | fred | eia | census | usitc | un_comtrade | sec
  source_name text,
  configured boolean not null default false,
  key_present boolean not null default false,
  last_run_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  metrics_fetched integer not null default 0,
  metrics_inserted integer not null default 0,
  metrics_updated integer not null default 0,
  numeric_shocks_created integer not null default 0,
  latest_period text,
  freshness_level text,
  warnings jsonb not null default '[]',
  errors jsonb not null default '[]',
  updated_at timestamptz not null default now()
);

comment on table public.source_health is
  'Per-source refresh health written by the server connector layer. key_present reflects an Edge Function secret, never exposed to the browser.';

-- View: source health + live ledger counts (matched by display name).
create or replace view public.source_health_v as
select
  h.source_key,
  h.source_name,
  h.configured,
  h.key_present,
  h.last_run_at,
  h.last_success_at,
  h.last_error,
  h.metrics_fetched,
  h.numeric_shocks_created,
  h.latest_period,
  h.freshness_level,
  coalesce(s.metrics_stored, 0)      as metrics_stored,
  coalesce(s.numeric_shocks_stored, 0) as numeric_shocks_stored,
  coalesce(s.publishable_shocks, 0)  as publishable_shocks,
  h.warnings,
  h.errors,
  h.updated_at
from public.source_health h
left join (
  select source_name,
         count(*) as metrics_stored,
         count(*) as numeric_shocks_stored,
         count(*) filter (where can_publish) as publishable_shocks
  from public.numeric_shocks
  group by source_name
) s on s.source_name = h.source_name;

-- ── New run-summary counters for the source + ledger stages ─────────────────
alter table public.intelligence_run_summaries
  add column if not exists bls_metrics_refreshed        integer not null default 0,
  add column if not exists fred_metrics_refreshed       integer not null default 0,
  add column if not exists eia_metrics_refreshed        integer not null default 0,
  add column if not exists census_metrics_refreshed     integer not null default 0,
  add column if not exists usitc_metrics_refreshed      integer not null default 0,
  add column if not exists un_comtrade_metrics_refreshed integer not null default 0,
  add column if not exists source_refresh_errors        integer not null default 0,
  add column if not exists numeric_shocks_created        integer not null default 0,
  add column if not exists numeric_shocks_publishable    integer not null default 0,
  add column if not exists numeric_shocks_context_only   integer not null default 0;

-- ── RLS: service role writes; authenticated users may read (read-only) ──────
alter table public.numeric_shocks enable row level security;
alter table public.source_health enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='numeric_shocks' and policyname='numeric_shocks_read') then
    create policy numeric_shocks_read on public.numeric_shocks for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='source_health' and policyname='source_health_read') then
    create policy source_health_read on public.source_health for select to authenticated using (true);
  end if;
end $$;

notify pgrst, 'reload schema';
