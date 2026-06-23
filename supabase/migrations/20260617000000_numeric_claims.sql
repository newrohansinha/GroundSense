-- ============================================================================
-- Numeric claims pipeline: body fetching, article numeric extraction,
-- risk numeric basis tracking, and run counters. ADDITIVE + IDEMPOTENT.
-- ============================================================================

-- 1. Article body fetching columns on raw_events
ALTER TABLE public.raw_events
  ADD COLUMN IF NOT EXISTS body_text text,
  ADD COLUMN IF NOT EXISTS body_fetched boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS body_word_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS body_fetch_failed boolean NOT NULL DEFAULT false;

-- 2. Extend article_metric_claims with structured numeric claim schema.
--    Existing thin columns (claim_text, extracted_value, extracted_unit, metric_key, driver)
--    are preserved and reused. New columns add claim range, source provenance, and trust labels.
ALTER TABLE public.article_metric_claims
  ADD COLUMN IF NOT EXISTS from_value numeric,
  ADD COLUMN IF NOT EXISTS to_value numeric,
  ADD COLUMN IF NOT EXISTS delta_pp numeric,
  ADD COLUMN IF NOT EXISTS direction text,
  ADD COLUMN IF NOT EXISTS commodity text,
  ADD COLUMN IF NOT EXISTS geography text,
  ADD COLUMN IF NOT EXISTS entity text,
  ADD COLUMN IF NOT EXISTS source_url text,
  ADD COLUMN IF NOT EXISTS source_domain text,
  ADD COLUMN IF NOT EXISTS article_title text,
  ADD COLUMN IF NOT EXISTS extraction_confidence text DEFAULT 'medium',
  ADD COLUMN IF NOT EXISTS trust_label text DEFAULT 'article_claim',
  ADD COLUMN IF NOT EXISTS can_drive_watch boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS can_drive_published boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS extraction_method text DEFAULT 'llm';

CREATE INDEX IF NOT EXISTS article_metric_claims_company_event_idx
  ON public.article_metric_claims (company_id, raw_event_id);

-- 3. Numeric basis tracking on risk_register.
--    numeric_basis_type: 'no_numeric_basis' | 'article_numeric_claim' | 'official_structured_metric' | 'manual_structured_metric'
--    Published issue count where numeric_basis_type = 'no_numeric_basis' must always be 0.
ALTER TABLE public.risk_register
  ADD COLUMN IF NOT EXISTS numeric_basis_type text NOT NULL DEFAULT 'no_numeric_basis',
  ADD COLUMN IF NOT EXISTS numeric_basis_value numeric,
  ADD COLUMN IF NOT EXISTS numeric_basis_from_value numeric,
  ADD COLUMN IF NOT EXISTS numeric_basis_to_value numeric,
  ADD COLUMN IF NOT EXISTS numeric_basis_unit text,
  ADD COLUMN IF NOT EXISTS numeric_basis_snippet text,
  ADD COLUMN IF NOT EXISTS numeric_basis_source_url text,
  ADD COLUMN IF NOT EXISTS numeric_basis_source_label text;

-- 4. New counters on intelligence_run_summaries for the two new pipeline stages.
ALTER TABLE public.intelligence_run_summaries
  ADD COLUMN IF NOT EXISTS article_bodies_attempted integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS article_bodies_succeeded integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS article_bodies_failed integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS article_body_words_total integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS numeric_claims_extracted integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS numeric_claims_with_percent integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS numeric_claims_with_pp_change integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS numeric_claims_with_dollar integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS numeric_claims_used_in_candidates integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS numeric_claims_used_in_published integer NOT NULL DEFAULT 0;

NOTIFY pgrst, 'reload schema';
