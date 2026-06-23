-- Persisted calibration / formula-input provenance foundation.
--
-- Moves buyer trust data (per-input provenance + company calibration coverage) out
-- of localStorage/view heuristics and into DB-backed records. Does NOT change any
-- formula, estimate, numeric_shock, or publication logic — provenance is metadata
-- attached to inputs that already exist on risk_register.formula_inputs.

-- ── Per-input formula provenance ────────────────────────────────────────────
create table if not exists formula_input_provenance (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  issue_id uuid,                 -- risk_register.id (nullable: company-level inputs)
  issue_key text,
  input_name text not null,      -- e.g. freight_spend, spot_exposure_pct, commodity_spend, unpassed_share, fuel_exposed_freight
  input_label text,              -- human label e.g. "freight spend"
  input_value numeric,
  unit text,                     -- usd, pct, share
  source_type text not null,     -- uploaded_csv | demo_seed | calibration_table | inferred_assumption | manual
  source_label text,             -- e.g. "company_logistics_exposure", "demo seed", "default 80% pass-through"
  last_validated_at timestamptz,
  owner text,
  confidence text,               -- high | medium | low
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_fip_company on formula_input_provenance(company_id);
create index if not exists idx_fip_issue on formula_input_provenance(issue_id);
create unique index if not exists uq_fip_issue_input on formula_input_provenance(issue_id, input_name);

alter table formula_input_provenance enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='formula_input_provenance' and policyname='Allow all formula input provenance MVP') then
    create policy "Allow all formula input provenance MVP" on formula_input_provenance for all to public using (true) with check (true);
  end if;
end $$;

-- ── Company-level persisted calibration coverage (DB/demo, never localStorage) ──
create table if not exists company_calibration_coverage (
  company_id uuid primary key,
  coverage_pct numeric not null default 0,
  domains_populated int not null default 0,
  domains_total int not null default 7,
  inputs_calibrated int,
  inputs_required int,
  source text not null default 'db_exposure',  -- db_exposure | demo_seed | persisted
  notes text,
  computed_at timestamptz not null default now()
);

alter table company_calibration_coverage enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='company_calibration_coverage' and policyname='Allow all company calibration coverage MVP') then
    create policy "Allow all company calibration coverage MVP" on company_calibration_coverage for all to public using (true) with check (true);
  end if;
end $$;
