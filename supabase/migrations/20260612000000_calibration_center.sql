-- Calibration Center 2.0 — Company Operating Model Workbench
-- Idempotent. Non-destructive. Does NOT touch existing intelligence/company-model tables.
-- DO NOT apply with `supabase migration repair` or `supabase db reset`.
-- Apply manually after schema review: `supabase db push` (local) or via dashboard.

-- ── Data sources: every calibration input set has a provenance record ──────────
create table if not exists company_data_sources (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies(id) on delete cascade,
  source_name         text not null,
  source_type         text not null,   -- manual_entry | csv_upload | api_connector | demo_seed | inferred | approved_assumption
  category            text not null,   -- freight | supplier_procurement | crm_demand | financial_anchor | inventory_service | competitive | outcome_history
  status              text not null default 'active',  -- active | draft | failed | archived
  completeness_score  numeric,
  quality_score       numeric,
  row_count           integer,
  valid_row_count     integer,
  invalid_row_count   integer,
  last_imported_at    timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- ── Calibration inputs: every model value, with source + provenance ───────────
create table if not exists company_calibration_inputs (
  id                       uuid primary key default gen_random_uuid(),
  company_id               uuid not null references companies(id) on delete cascade,
  category                 text not null,
  input_key                text not null,
  input_label              text not null,
  value_numeric            numeric,
  value_text               text,
  unit                     text,
  source_type              text,        -- imported_csv | manual | approved | demo | inferred | derived
  source_id                uuid references company_data_sources(id) on delete set null,
  confidence_level         text,        -- high | medium | low
  is_user_provided         boolean default false,
  is_imported              boolean default false,
  is_inferred              boolean default false,
  approved                 boolean default false,
  used_by                  jsonb,
  replaced_assumption_key  text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  unique (company_id, input_key)
);

-- ── Freight & logistics lane-level exposure ───────────────────────────────────
create table if not exists freight_lane_exposure (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references companies(id) on delete cascade,
  data_source_id        uuid references company_data_sources(id) on delete set null,
  lane_name             text,
  origin                text,
  destination           text,
  carrier               text,
  mode                  text,           -- ocean | air | truckload | ltl | rail | intermodal
  annual_spend          numeric,
  spot_or_contract      text,           -- spot | contract | mixed | unknown
  contract_coverage_pct numeric,
  surcharge_exposed     boolean,
  surcharge_type        text,
  volume_units          numeric,
  volume_unit_label     text,
  lead_time_days        numeric,
  priority_lane         boolean default false,
  confidence_level      text,
  notes                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- ── Supplier / procurement exposure ───────────────────────────────────────────
create table if not exists supplier_procurement_exposure (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references companies(id) on delete cascade,
  data_source_id        uuid references company_data_sources(id) on delete set null,
  supplier_name         text,
  country_of_origin     text,
  supplier_region       text,
  category              text,
  commodity             text,
  annual_spend          numeric,
  tariff_exposed        boolean,
  tariff_rate           numeric,
  pass_through_terms    text,
  lead_time_days        numeric,
  single_source         boolean,
  open_po_exposure      numeric,
  sku_count             integer,
  landed_cost_updated   boolean,
  contract_expiry_date  date,
  confidence_level      text,
  notes                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- ── CRM / customer demand signals ─────────────────────────────────────────────
create table if not exists crm_demand_signals (
  id                       uuid primary key default gen_random_uuid(),
  company_id               uuid not null references companies(id) on delete cascade,
  data_source_id           uuid references company_data_sources(id) on delete set null,
  segment                  text,
  account_name             text,
  customer_region          text,
  industry                 text,
  pipeline_value           numeric,
  quote_volume             numeric,
  quote_volume_change_pct  numeric,
  order_growth_pct         numeric,
  revenue_last_period      numeric,
  revenue_current_period   numeric,
  win_rate                 numeric,
  churn_risk_score         numeric,
  sales_owner              text,
  signal_period            text,
  source_system            text,
  confidence_level         text,
  notes                    text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

-- ── Financial anchors ─────────────────────────────────────────────────────────
create table if not exists financial_anchors (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references companies(id) on delete cascade,
  data_source_id    uuid references company_data_sources(id) on delete set null,
  period            text,
  revenue           numeric,
  gross_margin      numeric,
  gross_margin_pct  numeric,
  ebitda            numeric,
  eps               numeric,
  cogs              numeric,
  sgna              numeric,
  working_capital   numeric,
  inventory_turns   numeric,
  freight_spend     numeric,
  commodity_spend   numeric,
  operating_income  numeric,
  cash_flow         numeric,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- ── Inventory & service levels ────────────────────────────────────────────────
create table if not exists inventory_service_levels (
  id                       uuid primary key default gen_random_uuid(),
  company_id               uuid not null references companies(id) on delete cascade,
  data_source_id           uuid references company_data_sources(id) on delete set null,
  product_category         text,
  location                 text,
  inventory_value          numeric,
  inventory_units          numeric,
  fill_rate_pct            numeric,
  backorder_rate_pct       numeric,
  service_level_sla_pct    numeric,
  safety_stock_days        numeric,
  supplier_lead_time_days  numeric,
  stockout_events          integer,
  notes                    text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

-- ── Competitive / win-loss signals ────────────────────────────────────────────
create table if not exists competitive_signals (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references companies(id) on delete cascade,
  data_source_id    uuid references company_data_sources(id) on delete set null,
  competitor_name   text,
  segment           text,
  account_name      text,
  win_loss          text,            -- win | loss | unknown
  deal_value        numeric,
  price_gap_pct     numeric,
  churn_reason      text,
  displacement_risk text,
  signal_period     text,
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- ── Forecast outcomes (closes the accuracy loop) ──────────────────────────────
create table if not exists forecast_outcomes (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references companies(id) on delete cascade,
  issue_id         uuid,
  issue_type       text,
  forecast_date    timestamptz,
  predicted_low    numeric,
  predicted_mid    numeric,
  predicted_high   numeric,
  actual_impact    numeric,
  actual_metric    text,
  action_taken     text,
  protected_value  numeric,
  outcome_status   text,
  accuracy_class   text,
  notes            text,
  resolved_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- ── Calibration runs (activity log of model changes) ──────────────────────────
create table if not exists calibration_runs (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references companies(id) on delete cascade,
  run_type          text not null,   -- manual_entry | csv_upload | recalculation | approval | reset
  category          text,
  before_score      numeric,
  after_score       numeric,
  inputs_added      integer,
  estimates_changed jsonb,
  affected_issues   jsonb,
  notes             text,
  created_at        timestamptz not null default now()
);

-- ── CSV imports (preview/apply audit) ─────────────────────────────────────────
create table if not exists calibration_csv_imports (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies(id) on delete cascade,
  category            text not null,
  file_name           text,
  row_count           integer,
  valid_row_count     integer,
  invalid_row_count   integer,
  status              text,           -- preview | applied | failed | discarded
  validation_errors   jsonb,
  validation_warnings jsonb,
  parsed_preview      jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- ── Indexes ───────────────────────────────────────────────────────────────────
create index if not exists company_data_sources_company_idx        on company_data_sources(company_id);
create index if not exists company_calibration_inputs_company_idx   on company_calibration_inputs(company_id);
create index if not exists freight_lane_exposure_company_idx        on freight_lane_exposure(company_id);
create index if not exists supplier_procurement_exposure_company_idx on supplier_procurement_exposure(company_id);
create index if not exists crm_demand_signals_company_idx           on crm_demand_signals(company_id);
create index if not exists financial_anchors_company_idx            on financial_anchors(company_id);
create index if not exists inventory_service_levels_company_idx     on inventory_service_levels(company_id);
create index if not exists competitive_signals_company_idx          on competitive_signals(company_id);
create index if not exists forecast_outcomes_company_idx            on forecast_outcomes(company_id);
create index if not exists calibration_runs_company_idx             on calibration_runs(company_id);
create index if not exists calibration_csv_imports_company_idx      on calibration_csv_imports(company_id);
