-- GroundSense Operating Intelligence Moat
-- Migration: 20260610000000_operating_intelligence_moat
-- Tables: company_operating_assumptions, issue_model_inputs, issue_decision_memory,
--         issue_outcomes, action_roi_tracking, historical_analogs
--
-- DO NOT APPLY without reviewing RLS policies first.
-- These tables require RLS policies before production use.

-- ============================================================
-- A. company_operating_assumptions
-- Stores company-specific assumptions driving exposure math.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.company_operating_assumptions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  assumption_key      text NOT NULL,
  assumption_label    text NOT NULL,
  category            text NOT NULL,            -- freight | commodity | customer | competitor | financial
  value_numeric       numeric,
  value_text          text,
  unit                text,
  source_type         text NOT NULL DEFAULT 'inferred',  -- user_provided | benchmark | inferred | demo
  source_description  text,
  confidence_level    text NOT NULL DEFAULT 'low',       -- high | medium | low
  is_user_provided    boolean NOT NULL DEFAULT false,
  is_benchmark        boolean NOT NULL DEFAULT false,
  is_inferred         boolean NOT NULL DEFAULT true,
  last_validated_at   timestamptz,
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_coa_company_id
  ON public.company_operating_assumptions(company_id);

CREATE INDEX IF NOT EXISTS idx_coa_category
  ON public.company_operating_assumptions(company_id, category);

-- ============================================================
-- B. issue_model_inputs
-- Stores exact inputs used per issue calculation.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.issue_model_inputs (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id              uuid NOT NULL,
  issue_type            text NOT NULL,     -- risk | opportunity | operating_change | watchlist
  company_id            uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  input_key             text NOT NULL,
  input_label           text NOT NULL,
  input_value           text,
  unit                  text,
  source_type           text NOT NULL DEFAULT 'inferred',
  source_description    text,
  confidence_level      text NOT NULL DEFAULT 'low',
  required_for_accuracy boolean NOT NULL DEFAULT false,
  missing_or_present    text NOT NULL DEFAULT 'missing',  -- present | missing | partial
  created_at            timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_imi_issue_id
  ON public.issue_model_inputs(issue_id);

CREATE INDEX IF NOT EXISTS idx_imi_company_id
  ON public.issue_model_inputs(company_id);

-- ============================================================
-- C. issue_decision_memory
-- Tracks decision history and executive memory per issue.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.issue_decision_memory (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id          uuid NOT NULL,
  issue_type        text NOT NULL,
  company_id        uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  status            text NOT NULL DEFAULT 'open',         -- open | in_review | decided | closed
  triage_status     text,                                  -- Act | Validate | Watch | Ignore
  first_detected_at timestamptz DEFAULT now(),
  last_reviewed_at  timestamptz,
  next_review_at    timestamptz,
  decision_made     text,
  decision_notes    text,
  owner             text,
  action_status     text DEFAULT 'no_action',             -- no_action | pending | in_progress | complete
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_idm_issue_id
  ON public.issue_decision_memory(issue_id);

CREATE INDEX IF NOT EXISTS idx_idm_company_id
  ON public.issue_decision_memory(company_id);

-- ============================================================
-- D. issue_outcomes
-- Tracks realized outcomes vs forecasts.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.issue_outcomes (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id             uuid NOT NULL,
  issue_type           text NOT NULL,
  company_id           uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  predicted_low        numeric,
  predicted_mid        numeric,
  predicted_high       numeric,
  actual_impact        numeric,
  actual_impact_unit   text,
  outcome_status       text NOT NULL DEFAULT 'open',
    -- open | awaiting_data | resolved | missed | accurate | overestimated | underestimated
  outcome_notes        text,
  forecast_correctness text,
    -- accurate | overestimated | underestimated | not_yet_measurable
  resolved_at          timestamptz,
  created_at           timestamptz DEFAULT now(),
  updated_at           timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_io_issue_id
  ON public.issue_outcomes(issue_id);

CREATE INDEX IF NOT EXISTS idx_io_company_id
  ON public.issue_outcomes(company_id);

-- ============================================================
-- E. action_roi_tracking
-- Tracks action economics and realized value.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.action_roi_tracking (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action_id              uuid REFERENCES public.risk_actions(id) ON DELETE CASCADE,
  issue_id               uuid,
  company_id             uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  expected_benefit_low   numeric,
  expected_benefit_high  numeric,
  effort_level           text,    -- low | medium | high
  cost_estimate          numeric,
  protected_value        numeric,
  success_condition      text,
  actual_value_captured  numeric,
  outcome_notes          text,
  created_at             timestamptz DEFAULT now(),
  updated_at             timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_art_action_id
  ON public.action_roi_tracking(action_id);

CREATE INDEX IF NOT EXISTS idx_art_company_id
  ON public.action_roi_tracking(company_id);

-- ============================================================
-- F. historical_analogs
-- Future: stores analog episodes for model improvement.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.historical_analogs (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  issue_category            text NOT NULL,
  analog_title              text NOT NULL,
  analog_period             text,
  external_driver           text,
  company_impact            text,
  financial_metric_impacted text,
  basis                     text,
  confidence_level          text NOT NULL DEFAULT 'low',
  source_description        text,
  created_at                timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ha_company_id
  ON public.historical_analogs(company_id);

CREATE INDEX IF NOT EXISTS idx_ha_category
  ON public.historical_analogs(company_id, issue_category);

-- ============================================================
-- NOTES
-- ============================================================
-- 1. RLS must be added before production use.
-- 2. Demo seed data for company_operating_assumptions can be
--    inserted via a separate seed file or the app's calibration
--    flow once migration is applied.
-- 3. issue_decision_memory.issue_id is intentionally not a FK
--    because it may point to risk_register or opportunity_register.
-- 4. action_roi_tracking augments risk_actions — do not replace it.
