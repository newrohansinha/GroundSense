-- ============================================================================
-- Run hardening — structured error codes, watch counter, debug payload, and a
-- resumability hook (next_stage). ADDITIVE + IDEMPOTENT.
-- ============================================================================

alter table public.intelligence_run_summaries
  -- Structured machine-readable failure reason (mirrors the start function's
  -- error_code contract: missing_auth | missing_company | demo_read_only |
  -- lock_active | db_insert_failed | invalid_payload | function_exception | ...).
  add column if not exists error_code         text,
  -- Watchlist items created (completes the candidate reconciliation:
  -- generated = published + review + quarantined + watch + blocked).
  add column if not exists watch_items_created integer not null default 0,
  -- Reserved for a future cron-resumable staged runner (Option B). Null = the
  -- background runner owns the whole run in one invocation.
  add column if not exists next_stage          text,
  -- Free-form debug snapshot (secret presence booleans, payload shape, timings).
  add column if not exists debug               jsonb not null default '{}'::jsonb;

create index if not exists intelligence_run_summaries_company_status_started
  on public.intelligence_run_summaries (company_id, status, started_at desc);
