-- ============================================================================
-- Option B — cron-resumable STAGED runner.
--
-- Adds durable stage-cursor + worker-claim columns so a run can be advanced one
-- stage/chunk at a time across multiple short Edge Function invocations
-- (continue-intelligence-run), driven by an INTERNAL worker cron (always-on,
-- distinct from the customer Intelligence Schedule). ADDITIVE + IDEMPOTENT.
-- ============================================================================

alter table public.intelligence_run_summaries
  -- Where the staged runner is up to within the current stage (e.g. the fetch
  -- query_index). Opaque to the DB; owned by continue-intelligence-run.
  add column if not exists stage_cursor         jsonb not null default '{}'::jsonb,
  add column if not exists lock_expires_at       timestamptz,
  -- Atomic single-flight guard: only the worker that wins this conditional
  -- update advances the run, so two cron ticks can't double-process a stage.
  add column if not exists worker_claimed_until  timestamptz;

-- Index for the sweep query (oldest non-terminal, unclaimed run).
create index if not exists intelligence_run_summaries_worker_sweep
  on public.intelligence_run_summaries (status, worker_claimed_until, started_at)
  where status in ('queued', 'running');

-- ── Internal worker cron (always-on; NOT the customer schedule) ─────────────
-- Calls continue-intelligence-run every minute to advance any in-flight run.
-- Manual/force runs are advanced by this worker even when the customer
-- Intelligence Schedule is disabled. GUARDED + IDEMPOTENT (skips if pg_cron /
-- pg_net / vault are unavailable). Reuses the existing scheduler secret + URL.
do $$
begin
  begin
    create extension if not exists pg_cron;
    create extension if not exists pg_net;
  exception when others then
    raise notice 'pg_cron/pg_net not available — skipping internal worker cron. %', sqlerrm;
    return;
  end;

  if not exists (select 1 from pg_namespace where nspname = 'vault')
     or not exists (select 1 from vault.decrypted_secrets where name = 'project_url')
     or not exists (select 1 from vault.decrypted_secrets where name = 'intelligence_scheduler_secret') then
    raise notice 'Vault secrets not present — skipping internal worker cron.';
    return;
  end if;

  begin
    perform cron.unschedule('groundsense-intelligence-worker');
  exception when others then null;
  end;

  -- Every minute: sweep + advance one stage of any in-flight run.
  perform cron.schedule(
    'groundsense-intelligence-worker',
    '* * * * *',
    $cron$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
             || '/functions/v1/continue-intelligence-run',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-scheduler-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'intelligence_scheduler_secret')
      ),
      body := jsonb_build_object('sweep', true),
      timeout_milliseconds := 120000
    );
    $cron$
  );

  raise notice 'Scheduled groundsense-intelligence-worker (every minute).';
end;
$$;
