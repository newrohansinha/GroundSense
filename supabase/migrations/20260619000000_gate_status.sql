-- ============================================================================
-- gate_status column + FIX 9 data cleanup.
-- gate_status is the canonical publish/watch discriminator for all SQL queries.
-- Published issue count where numeric_basis_type = 'no_numeric_basis' must be 0.
-- ============================================================================

ALTER TABLE public.risk_register
  ADD COLUMN IF NOT EXISTS gate_status text NOT NULL DEFAULT 'watch';

CREATE INDEX IF NOT EXISTS risk_register_gate_status_company_idx
  ON public.risk_register(company_id, gate_status);

-- ── FIX 9: Demote invalid published rows for Fastenal DEV ──────────────────
-- Rule: no real number means no published risk.

-- 9a. No numeric basis or value — these were never valid.
UPDATE public.risk_register
SET display_section = 'watchlist',
    issue_category  = 'watchlist',
    is_actionable_risk = false,
    gate_status     = 'watch'
WHERE company_id = '9b91cd36-7451-4252-9468-6ae6872ad4eb'
  AND display_section IN ('risk_register', 'operating_changes')
  AND (
    numeric_basis_type = 'no_numeric_basis'
    OR numeric_basis_value IS NULL
    OR numeric_basis_unit NOT IN ('pct', 'pp', 'bps', 'percent', '%')
  );

-- 9b. Demand-proxy article claim: Taiwan machine tool export decline.
--     A Taiwan export statistic is not a direct Fastenal cost shock. No Japan-specific
--     supplier spend or customer revenue exposure exists in Fastenal DEV calibration.
--     Must not publish until a direct company exposure mapping is added.
UPDATE public.risk_register
SET display_section = 'watchlist',
    issue_category  = 'watchlist',
    is_actionable_risk = false,
    gate_status     = 'watch'
WHERE company_id = '9b91cd36-7451-4252-9468-6ae6872ad4eb'
  AND issue_key = 'issue_epcpib';

-- ── Backfill gate_status for remaining valid published rows ─────────────────
UPDATE public.risk_register
SET gate_status = 'published'
WHERE display_section IN ('risk_register', 'operating_changes')
  AND numeric_basis_type IN ('article_numeric_claim', 'official_structured_metric', 'manual_structured_metric')
  AND numeric_basis_value IS NOT NULL
  AND numeric_basis_unit IN ('pct', 'pp', 'bps', 'percent', '%');

NOTIFY pgrst, 'reload schema';
