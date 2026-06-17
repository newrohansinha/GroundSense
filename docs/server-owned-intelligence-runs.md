# Server-owned intelligence runs — deploy & verification runbook

This change moves the **manual "Run Intelligence Update"** path off the browser
and onto the server, so a run continues even if the user changes tabs, refreshes,
closes the browser, loses network, or logs out. The scheduled (cron) run already
ran server-side; both now share the same heartbeat + progress model.

> **Why you must run these steps:** the Supabase CLI in the build environment was
> authenticated to a different account with no access to project
> `kfzdvqhrkfquakqaqfbf`, so migrations/functions could not be pushed and a live
> verification run could not be executed there. Run the commands below with your
> own Supabase credentials.

---

## What changed (architecture)

**Browser now only:** starts a run, gets a `run_id`, polls `getRunProgress`,
prints progress to console, renders the progress panel, and refreshes the
dashboard on completion. It performs **no** article fetching, scoring, insertion,
generation, or heartbeat.

**Server owns execution:**
- `supabase/functions/start-intelligence-run/index.ts` — auth + membership +
  demo-reject, expires stale runs/locks, creates the run row, acquires the lock,
  then runs the pipeline in a **background task** (`EdgeRuntime.waitUntil`) and
  returns `run_id` immediately.
- `supabase/functions/_shared/intelligence-orchestrator.ts` — the pipeline, now
  writing **server heartbeat + per-stage progress + counters + run events** to
  the DB at every stage (and mid-stage during the long fetch loop).
- `supabase/functions/_shared/fresh-intelligence.ts` — the Currents /
  `news_tracking_queries` fetch loop (relevance gate + dedupe + cap) **ported
  from the browser** so the "do-not-break" relevance behaviour is preserved
  server-side.

**Heartbeat = server only.** `heartbeat_at` is written exclusively by the server
worker. The browser may call `touch_run_client_seen` (sets
`last_seen_by_client_at`) but that never affects liveness. Expiry now reads:
**"Run expired: server worker heartbeat stopped for over 5 minutes."**

---

## 1. Push the migration

```bash
# from repo root, with your account linked to project kfzdvqhrkfquakqaqfbf
supabase db push
```

Migration `supabase/migrations/20260616000000_server_owned_intelligence_runs.sql`
is additive + idempotent. It adds progress/counter columns to
`intelligence_run_summaries`, creates `intelligence_run_events`, and
creates/replaces `expire_stale_intelligence_runs` (server-heartbeat message) and
`touch_run_client_seen`.

## 2. Deploy the functions

```bash
supabase functions deploy start-intelligence-run       # enqueues + kicks the worker
supabase functions deploy continue-intelligence-run    # Option B staged worker
supabase functions deploy intelligence-healthcheck     # reachability/readiness probe
supabase functions deploy scheduled-intelligence-run   # picks up the shared orchestrator change
```

> **Confirmed via direct HTTPS probe (2026-06-17):** the live gateway returns
> `404 NOT_FOUND` for `start-intelligence-run` and `intelligence-healthcheck`,
> while pre-existing functions (`fetch-currents-query` → 200, etc.) respond. The
> "Failed to send a request to the Edge Function" error is therefore exactly:
> **the new functions are not deployed.** The deploys above fix it.

> Migrations `20260616000000`, `20260617000000`, and `20260618000000` are all
> applied by step 1's `db push`. `20260618000000` adds `stage_cursor`,
> `lock_expires_at`, `worker_claimed_until`, and schedules the **internal worker
> cron** `groundsense-intelligence-worker` (every minute) — this is separate from
> the customer Intelligence Schedule and is always on. The cron needs Vault
> `project_url` + `intelligence_scheduler_secret` (created by
> `20260613001000_intelligence_cron.sql`); if pg_cron/pg_net/vault are absent it
> skips gracefully, and the immediate self-kick from `start`/`continue` still
> drives runs (the cron is only the recovery safety net).

Both depend on the updated `_shared/` modules, which deploy with each function.
No new secrets are required (the function reuses `SUPABASE_URL`,
`SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and the existing
`fetch-currents-query` setup).

## 3. One-time stale cleanup for the current company (FIX 8)

Repairs any rows left `running`/`expired` by the old browser-owned runs and
releases stale locks. Replace `:company_id` with the Fastenal DEV company id.

```sql
-- a) Expire any stuck running/queued rows + release their locks.
select public.expire_stale_intelligence_runs('00000000-0000-0000-0000-000000000000'::uuid, 0);

-- b) Belt-and-suspenders: release any orphaned locks.
select public.expire_stale_intelligence_locks();

-- c) Confirm: latest valid completed run is intact, no rows left 'running'.
select id, status, started_at, completed_at, progress_pct, heartbeat_at, note
from   public.intelligence_run_summaries
where  company_id = '00000000-0000-0000-0000-000000000000'::uuid
order  by started_at desc
limit  10;
```

Passing `p_stale_minutes => 0` in (a) expires **all** currently-running rows for
that company immediately (use only for the one-time cleanup; normal operation
uses 5). After this, **Run now** is enabled and **Schedule** stays disabled.

---

## 4. The one true verification run (FIX 10)

1. Open the dashboard for Fastenal DEV. Open devtools console.
2. Click **Run Intelligence Update** (or **Force full run**).
   - Console prints `「[GroundSense run progress] started」` with a `runId`.
   - The progress panel shows stage, progress bar, counters, and a `♥` heartbeat age.
3. **Switch to another tab / close the tab for ≥ 2 minutes.**
4. Reopen the dashboard.
   - Expected: the run is **still running or completed** — *not* expired.
   - Console resumes `「[GroundSense run progress]」` lines sourced from the DB
     (`resumed active run from DB`).
5. **Hard refresh** during the run.
   - Expected: progress resumes from the DB; **no** duplicate run starts (the Run
     button is disabled while a live run exists, and the server returns
     `already_running` for the active run).
6. Let it finish.
   - Expected: status `completed` or `completed_with_warnings`; counters
     populated; dashboard refreshes; Run History note includes
     `queries · new articles · candidates · published · verified shocks`.

If it ever shows **"browser closed"** as the reason, the fix is not in effect —
re-check that the migration's RPC was applied (step 1).

### Quick server-side sanity (SQL)

```sql
-- Live progress while a run is in flight:
select status, current_stage, progress_pct, heartbeat_at,
       queries_executed, articles_fetched, articles_inserted,
       candidates_generated, candidates_published
from   public.intelligence_run_summaries
where  company_id = '00000000-0000-0000-0000-000000000000'::uuid
order  by started_at desc limit 1;

-- Per-stage event breadcrumbs:
select stage, level, message, created_at
from   public.intelligence_run_events e
join   public.intelligence_run_summaries s on s.id = e.summary_id
where  s.company_id = '00000000-0000-0000-0000-000000000000'::uuid
order  by e.created_at desc limit 30;
```

---

## 5. Consistency check (FIX 11)

The orchestrator records `consistent = (generated === 0 || published + review +
quarantine <= generated)`. When it fails, the run is marked
`completed_with_warnings` and the warning is written to `warning_message` /
`summary.warnings`. Healthy runs should show:
`queries_executed > 0`, `articles_fetched > 0` (unless the provider returned
zero), `candidates_published + review + quarantined ≤ candidates_generated`.

## 6. Schedule state (FIX 9) — unchanged guarantees

- Manual and force runs **never** enable the schedule. `start-intelligence-run`
  reads only `allow_generation` / `allow_publishing`, never `enabled`.
- New companies default `enabled = false` (see `ensureWorkspace`).
- The global cron existing does not mean a company schedule is enabled.

---

## 7. Forensic debugging (ultra-debug pass)

### "Could not start run — Failed to send a request to the Edge Function"

That string is a client-side `fetch` rejection — the request never reached a
deployed function. The frontend now turns it into a structured `error_code`:

| What you see (error_code)        | Meaning / fix |
| -------------------------------- | ------------- |
| `function_unreachable`           | **Function not deployed** (most common) or CORS/network blocked. Deploy `start-intelligence-run` + `intelligence-healthcheck`; confirm the app's Supabase URL matches the deployed project. |
| `missing_auth` (HTTP 401)        | Session missing/expired — sign out/in. |
| `demo_read_only` (HTTP 403)      | Demo workspace — read-only. |
| `forbidden` (HTTP 403)           | Not a member of the company. |
| `missing_company` (HTTP 400)     | No `company_id`. |
| `lock_active` (HTTP 409)         | A run is already active. |
| `db_insert_failed` (HTTP 500)    | Run-table migration not applied. |
| `function_exception` (HTTP 500)  | Unhandled throw — check edge logs. |

**Use the new buttons** (Advanced / admin controls):
`Test Edge Function health`, `Start ultra debug run`, `Dry run`,
`Expire stale runs`, `View run events`. The healthcheck button is the fastest way
to prove deploy/CORS/secret/DB status:

```bash
# CLI equivalent of the "Test Edge Function health" button:
curl -s -X POST "$SUPABASE_URL/functions/v1/intelligence-healthcheck" \
  -H "apikey: $ANON" -H "Authorization: Bearer $ANON" -H "Content-Type: application/json" -d '{}'
# → { ok, db_reachable, secrets_present:{ CURRENTS_API_KEY:true, ... }, project_ref, time }
```

### Ultra Debug run (capped, server keys only)

`Start ultra debug run` → `run_mode: "ultra_debug"`, `query_cap: 10`,
`max_articles_per_query: 10`, full server stages, server-side keys only.
`Dry run` fetches + normalizes + scores but inserts/generates **nothing**
(`query_cap: 3`) — quota-safe. Both print `[GroundSense UltraDebug]` to the
console from persisted DB state and write `intelligence_run_events`.

### Confirm secrets exist (presence only, never values)

```bash
supabase secrets list   # names only — confirm CURRENTS_API_KEY, SUPABASE_SERVICE_ROLE_KEY present
```
(The function reports the same as booleans via the healthcheck — no values.)

## 8. Diagnostics SQL (run-state report)

```sql
-- Run rows by status (this company):
select status, count(*) from public.intelligence_run_summaries
where company_id = :company group by status order by count(*) desc;

-- Active locks:
select lock_key, run_id, acquired_at, expires_at, acquired_by
from public.intelligence_run_locks
where lock_key = 'intelligence-update:company:' || :company::text;

-- Latest run + counters + error_code:
select id, status, error_code, progress_pct, heartbeat_at, completed_at,
       queries_executed, articles_fetched, articles_inserted, candidates_generated,
       candidates_published, candidates_review, candidates_quarantined, watch_items_created,
       actions_created, exposure_paths_created, forecasts_created, note, warning_message
from public.intelligence_run_summaries
where company_id = :company order by started_at desc limit 5;

-- Per-stage event log for the latest run:
select e.stage, e.level, e.message, e.created_at
from public.intelligence_run_events e
join public.intelligence_run_summaries s on s.id = e.summary_id
where s.company_id = :company order by e.created_at desc limit 40;
```

### Simulate stale-heartbeat expiry (test E26–30)

```sql
-- Age the heartbeat of the latest running row, then reload the dashboard:
update public.intelligence_run_summaries
set heartbeat_at = now() - interval '10 minutes'
where company_id = :company and status = 'running';
-- The next dashboard load / poll expires it with
-- "server worker heartbeat stopped …", releases the lock, re-enables Run.
```

## 9. Manual / Ultra-debug cleanup

- `Expire stale runs` button (or step 3 SQL) clears stuck rows + locks.
- Ultra-debug runs with `cleanup_after: true` delete only rows **this run
  created** (company-scoped, `created_at >= run start`) across
  `risk_register / opportunity_register / risk_actions / exposure_paths /
  issue_forecasts / issue_quality_gate_results`. It never touches onboarding,
  calibration, demo data, or (unless `cleanup_raw`) the raw article cache.

---

## 10. Option B — resumable staged runner (architecture)

For long force-full runs (up to 80 queries) a single Edge Function invocation can
exceed the wall-clock limit. The run is now advanced **one stage / one fetch
chunk per invocation**:

```
start-intelligence-run            continue-intelligence-run (× N)         internal cron
  auth + membership + demo-reject    claim run (atomic, single-flight)       every minute:
  create run row (status=queued,     renew company lock                       POST continue
    next_stage='fetch-fresh',        execute ONE stage:                        (sweep mode)
    stage_cursor={query_index:0})      fetch-fresh  → chunk of 8 queries,     ← safety net if a
  acquire lock                          advance query_index until done          self-kick is lost
  return run_id  ───────────►          score → detect → connections →
  (browser polls only)                  risks → opportunities → gate →
                                        brief → finalize (consistency,
                                        cleanup, terminal status, unlock)
                                      persist counters+heartbeat+event,
                                      release claim, self-kick next ──┐
                                      ◄───────────────────────────────┘
```

- **Single-flight:** `worker_claimed_until` is set by an atomic conditional
  UPDATE; only the winning worker advances a stage, so two cron ticks never
  double-process.
- **Resumable:** `next_stage` + `stage_cursor.query_index` live in the DB; any
  invocation (self-kick or cron) resumes exactly where the last left off.
- **Chunked fetch:** 8 queries per invocation; cross-chunk article dedupe is the
  `raw_events` existing-URL check (idempotent on retry).
- **Heartbeat:** written every stage/chunk by the worker. A dead worker stops
  the heartbeat → `expire_stale_intelligence_runs` marks it `expired` after 5 min
  and releases the lock; the cron then moves on.
- **Browser:** never calls `continue-intelligence-run` (internal auth: service
  bearer or Vault scheduler secret). It only polls the run row.

The synchronous `runOrchestration` is retained for `scheduled-intelligence-run`
(already server-owned and within limits); it can be migrated to enqueue-only
later with no schema change.

---

## Rollback

The change is additive. To revert the manual path to the (buggy) browser
pipeline, restore `src/services/intelligencePipelineService.ts` and the
`handleRunIntelligenceUpdate` handler from git history. The migration and new
functions can stay (unused) with no effect.
