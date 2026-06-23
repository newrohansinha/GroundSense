-- ============================================================================
-- Run accounting — explicit reconciliation buckets so every fetched article and
-- every generated candidate lands in exactly one terminal bucket, plus brief
-- preservation flags. ADDITIVE + IDEMPOTENT.
-- ============================================================================

alter table public.intelligence_run_summaries
  -- Article accounting (fetched must reconcile across these).
  add column if not exists articles_failed_normalization integer not null default 0,
  add column if not exists articles_failed_insert         integer not null default 0,
  add column if not exists articles_skipped               integer not null default 0,
  -- Duplicate reuse for company evaluations (BUG 2).
  add column if not exists duplicate_articles_reused_for_company        integer not null default 0,
  add column if not exists company_evaluations_created_from_duplicates  integer not null default 0,
  add column if not exists company_evaluations_created_from_new_articles integer not null default 0,
  -- Candidate routing (generated must reconcile across decisions).
  add column if not exists candidates_blocked             integer not null default 0,
  -- Brief preservation (BUG 5).
  add column if not exists briefs_skipped_no_published_issues integer not null default 0,
  add column if not exists previous_brief_preserved        boolean not null default false;

-- Refresh PostgREST schema cache so the Edge Functions see the new columns.
notify pgrst, 'reload schema';
