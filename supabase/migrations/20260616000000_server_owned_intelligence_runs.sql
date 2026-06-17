-- ============================================================================
-- Server-owned intelligence runs — persisted progress, run-event log, and a
-- corrected stale-run expiry that reflects the SERVER worker dying (not the
-- browser closing).
--
-- ADDITIVE + IDEMPOTENT. Adds progress/heartbeat/counter columns to
-- intelligence_run_summaries, a per-stage event log table, and rewrites the
-- expire_stale_intelligence_runs RPC. Some progress columns (current_stage,
-- heartbeat_at, lock_key, …) were previously applied live but never committed;
-- the `if not exists` guards make this migration the single reproducible source
-- of truth without disturbing existing data.
-- ============================================================================

-- ── 1. Progress + heartbeat + run-metadata columns ─────────────────────────
alter table public.intelligence_run_summaries
  add column if not exists current_stage          text,
  add column if not exists current_stage_label    text,
  add column if not exists current_stage_index    integer,
  add column if not exists total_stages           integer,
  add column if not exists progress_pct           integer,
  -- Heartbeat is written by the SERVER worker only. Liveness is derived from
  -- this column; the browser never updates it.
  add column if not exists heartbeat_at            timestamptz,
  -- Optional, purely observational: when a client last polled this run. Must
  -- NOT influence expiry/liveness.
  add column if not exists last_seen_by_client_at  timestamptz,
  add column if not exists lock_key                text,
  add column if not exists run_mode                text,
  add column if not exists force                   boolean not null default false,
  add column if not exists note                    text,
  add column if not exists warning_message         text;

-- ── 2. Per-stage counters (sums must reconcile; see FIX 11 consistency) ─────
alter table public.intelligence_run_summaries
  add column if not exists raw_queries_generated      integer not null default 0,
  add column if not exists deduped_queries            integer not null default 0,
  add column if not exists capped_queries             integer not null default 0,
  add column if not exists queries_executed           integer not null default 0,
  add column if not exists articles_fetched           integer not null default 0,
  add column if not exists articles_normalized        integer not null default 0,
  add column if not exists articles_inserted          integer not null default 0,
  add column if not exists article_duplicates         integer not null default 0,
  add column if not exists articles_rejected          integer not null default 0,
  add column if not exists company_evaluations_created integer not null default 0,
  add column if not exists exposure_paths_created     integer not null default 0,
  add column if not exists forecasts_created          integer not null default 0,
  add column if not exists briefs_created             integer not null default 0;
-- NOTE: verified_shocks_created, candidates_generated, candidates_published,
-- candidates_review, candidates_quarantined, actions_created already exist on
-- this table (see 20260613000000_intelligence_scheduler.sql).

-- ── 3. Run-event log (human-readable per-stage breadcrumbs) ────────────────
create table if not exists public.intelligence_run_events (
  id          uuid primary key default gen_random_uuid(),
  run_id      uuid,                                  -- pipeline_run_id of the run
  summary_id  uuid references public.intelligence_run_summaries(id) on delete cascade,
  company_id  uuid references public.companies(id) on delete set null,
  stage       text not null,
  level       text not null default 'info',          -- info | warning | error
  message     text not null,
  counters    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists intelligence_run_events_summary_created
  on public.intelligence_run_events (summary_id, created_at desc);
create index if not exists intelligence_run_events_run_created
  on public.intelligence_run_events (run_id, created_at desc);
create index if not exists intelligence_run_events_company_created
  on public.intelligence_run_events (company_id, created_at desc);

-- ── 4. Stale-run expiry (server heartbeat stopped, NOT browser closed) ─────
-- Marks running/queued runs whose SERVER heartbeat has gone silent for longer
-- than p_stale_minutes as 'expired', releases their locks, and records an
-- honest note. A browser closing can never trigger this, because the browser
-- never writes heartbeat_at.
create or replace function public.expire_stale_intelligence_runs(
  p_company_id   uuid,
  p_stale_minutes integer default 5
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cutoff timestamptz := now() - make_interval(mins => p_stale_minutes);
  v_note   text := 'Run expired: server worker heartbeat stopped for over '
                   || p_stale_minutes || ' minutes.';
  v_count  integer;
begin
  with stale as (
    update public.intelligence_run_summaries s
       set status         = 'expired',
           completed_at   = now(),
           skipped_reason = v_note,
           note           = v_note,
           error_message  = coalesce(s.error_message, v_note)
     where s.company_id = p_company_id
       and s.status in ('running', 'queued')
       and coalesce(s.heartbeat_at, s.started_at) < v_cutoff
    returning s.lock_key, s.pipeline_run_id
  )
  -- Release any locks the now-expired runs were holding so a new run can start.
  delete from public.intelligence_run_locks l
   using stale
   where l.lock_key = stale.lock_key
     and (l.run_id = stale.pipeline_run_id or l.expires_at < now());

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ── 5. Client-observation timestamp (never affects liveness) ───────────────
create or replace function public.touch_run_client_seen(
  p_summary_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.intelligence_run_summaries
     set last_seen_by_client_at = now()
   where id = p_summary_id;
end;
$$;
