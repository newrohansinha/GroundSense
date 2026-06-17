# Automatic Intelligence Updates

GroundSense runs intelligence updates automatically on a schedule (server-side),
while keeping the manual **Run Intelligence Update** button. Both paths share the
same run lock and the same run-history table, so they are consistent, observable,
and can never overlap.

## Architecture

```
Supabase Cron (pg_cron + pg_net, daily 10:00 UTC; secret + URL read from Vault)
  → POST /functions/v1/scheduled-intelligence-run   (x-scheduler-secret header)
      → verify secret via public.verify_scheduler_secret() RPC against the Vault secret
        (RPC returns only a boolean; the secret never leaves the database)
      → if scheduled run and intelligence_scheduler_config.enabled = false → skip
      → create intelligence_run_summaries row (status: running)
      → expire_stale_intelligence_locks()  +  acquire_intelligence_run_lock()
          ↳ if not acquired → mark summary "skipped: another run already active" → return
      → orchestrate (shared _shared/intelligence-orchestrator.ts):
          fetch-events → score-events
          → detect meaningful changes (intelligence_change_events)
          → if material/forced: build-company-connections → generate-dynamic-risks → generate-opportunities
          → generate-brief
      → write counts to run summary (status: completed | completed_with_warnings | failed)
      → release_intelligence_run_lock()
  → Dashboard reads intelligence_run_summaries / intelligence_scheduler_config (anon, read-only)
```

The **exposure graph** is a client-side view-model derived from canonical estimates,
so there is no separate server rebuild step. Generation/dedupe is owned by the existing
`generate-dynamic-risks` / `generate-opportunities` functions (the same ones the manual
button uses), so repeated runs **update** rather than duplicate.

## Data model (migration `20260613000000_intelligence_scheduler.sql`)

- `intelligence_scheduler_config` — schedule settings (enabled, cron, run_mode, scope, gates). Seeded with one global default (daily 10:00 UTC).
- `intelligence_run_locks` — single-row-per-key lock with TTL expiry.
- `intelligence_run_summaries` — run history (trigger, status, counts, timing, errors).
- `intelligence_change_events` — per-metric deltas + materiality, gating regeneration.

Lock RPCs (SECURITY DEFINER): `acquire_intelligence_run_lock`, `release_intelligence_run_lock`, `expire_stale_intelligence_locks`.

RLS is left disabled to match the existing demo-table convention; the client only reads status/history.

Supporting migrations:
- `20260613001000_intelligence_cron.sql` — extensions (`pg_cron`, `pg_net`), the Vault scheduler secret + `project_url`, the `verify_scheduler_secret()` auth RPC, and the daily cron job. Idempotent + guarded.
- `20260613002000_issue_keys_for_merge.sql` / `20260613003000_opportunity_keys_for_merge.sql` — stable `issue_key` / `opportunity_key` so `generate-dynamic-risks` / `generate-opportunities` **upsert by key** instead of delete-all-then-insert. Repeated runs preserve existing published issues/candidates (classification is preserved on update; only set on insert), so scheduled runs never wipe the dashboard.

> Live-deploy note: on the live project these were applied via Supabase MCP under the names
> `intelligence_scheduler`, `issue_keys_for_merge`, `opportunity_keys_for_merge`, and
> `intelligence_cron_secret_and_verifier` (the last folds the extensions + Vault secret + verifier
> RPC + cron schedule that this `20260613001000` file reproduces for fresh environments). The cron
> job itself was created with `cron.schedule(...)`. A fresh `supabase db push` applies these files
> idempotently and reproduces the same setup.

## Deploy (Vault-RPC design — no env secret, no `supabase secrets set`)

The scheduler secret is **generated server-side into Vault** by the cron migration and verified
in the Edge Function via the `verify_scheduler_secret()` RPC. No secret value is ever placed in
SQL, env, logs, or git.

### 1. Apply migrations
```bash
supabase db push   # applies the scheduler tables, the issue/opportunity merge keys,
                   # and 20260613001000_intelligence_cron.sql (extensions + Vault secret + RPC + cron job)
```
(Or apply via the Supabase MCP / SQL editor — all migrations are additive and idempotent.)
For a **new** project, edit the `project_url` value in `20260613001000_intelligence_cron.sql`
to your own `https://<PROJECT_REF>.supabase.co` before pushing.

### 2. Deploy the Edge Function (custom secret auth ⇒ no JWT gate)
```bash
supabase functions deploy scheduled-intelligence-run --no-verify-jwt
# Optional: pin the company the scheduled run targets
# (set DEFAULT_COMPANY_ID in the Supabase dashboard → Edge Functions → Secrets if desired)
```
`--no-verify-jwt` is correct here because the function implements its own strong auth: it rejects
any request whose `x-scheduler-secret` does not match the Vault secret (verified via the RPC).
The manual **Run Intelligence Update** button does **not** call this function — it runs the client
pipeline directly — so no client ever needs the scheduler secret.

That's it. The cron job (`groundsense-daily-intelligence-update`, daily 10:00 UTC) is created by the
migration and reads the secret + URL from Vault at fire time.

### Change the schedule
- Cadence: edit the cron expression in `20260613001000_intelligence_cron.sql` (e.g. `0 */6 * * *` for every 6 hours) and re-run it, or `select cron.schedule('groundsense-daily-intelligence-update', '<expr>', $cron$…$cron$);`.
- Enable/disable from the UI (**Intelligence Schedule** card → Disable/Enable), which flips `intelligence_scheduler_config.enabled`. The function honors this for **scheduled** runs (it skips when disabled); manual runs always proceed.

## Verify & operate

```sql
-- Job exists + is active
select jobid, jobname, schedule, active from cron.job
where jobname = 'groundsense-daily-intelligence-update';

-- Next run (compute from the daily-10:00-UTC schedule)
select case when (now() at time zone 'UTC')::time < '10:00'
            then date_trunc('day', now() at time zone 'UTC') + interval '10 hours'
            else date_trunc('day', now() at time zone 'UTC') + interval '1 day 10 hours'
       end as next_run_utc;

-- After a scheduled run: pg_cron execution log …
select status, return_message, start_time
from cron.job_run_details jrd join cron.job j on j.jobid = jrd.jobid
where j.jobname = 'groundsense-daily-intelligence-update' order by start_time desc limit 5;

-- … and the app-level run summary (expect a 'scheduled' completed row)
select trigger_type, status, candidates_published, started_at
from intelligence_run_summaries order by started_at desc limit 5;

-- Confirm no duplicates were created by the run
select issue_key, count(*) from risk_register group by 1 having count(*) > 1;       -- expect 0 rows
select opportunity_key, count(*) from opportunity_register group by 1 having count(*) > 1; -- expect 0 rows
```

### Pause / stop
- **Pause (UI):** Dashboard → Intelligence Schedule card → **Disable schedule** (the function skips scheduled runs while disabled).
- **Definitively stop the job:** `select cron.unschedule('groundsense-daily-intelligence-update');`

## Locking & idempotency

- Lock key: `intelligence-update:company:{company_id}`. TTL 15 min.
- A second concurrent run (manual or scheduled) is **skipped** ("another run already active").
- Stale locks are swept (`expire_stale_intelligence_locks`) before each acquire, so a crashed run self-heals after the TTL.
- Generators dedupe by company + issue + driver, so running twice does not duplicate published issues/actions.

## Meaningful-change detection

`detect changes` compares the two latest `external_metric_observations` per metric:
- Tariff/duty/trade metrics: material at **≥ 1 percentage point**.
- Other (noisy) indices: material at **≥ 0.5%**.
Generation is skipped when nothing material changed (unless `force` or `run_mode=generate_only`), preventing duplicate-issue spam.

## Run history & status

- Dashboard → **Intelligence Schedule** card: enabled state, cadence, last run + result, next run, "Run now", "View run history".
- Risks page → **Intelligence Run History**: full table (manual + scheduled) with counts and outcomes.

## Upload-triggered refresh (foundation)

Manual CSV / structured-metric imports can call the function with
`{ trigger_type: "upload_triggered", run_mode: "generate_only" }` (debounce per import
batch, not per row), or simply let the next scheduled run pick up the new observations
via change detection. The lock prevents overlapping refreshes.

## Failure handling

- A single source failure is recorded as a warning; the run completes as `completed_with_warnings` and the dashboard keeps the last good intelligence.
- A full failure marks the run `failed`, releases the lock, and leaves previously published intelligence visible.
- A stuck lock expires after the TTL and the next run recovers.

## Security

- The scheduled function requires the `x-scheduler-secret` header and verifies it against the
  **Vault** secret via `verify_scheduler_secret()` (SECURITY DEFINER, returns only a boolean).
  No/incorrect secret → `401`. There is no function env secret to leak.
- The secret value is generated server-side (`gen_random_bytes`) and lives only in Vault; it is
  **never** logged, returned, committed, or sent to the client. `verify_scheduler_secret()` is
  revoked from `anon`/`authenticated` and granted only to `service_role`.
- The client (publishable key) has read-only access to scheduler status/history; it cannot read
  the secret or trigger scheduled runs.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Card shows "Schedule not configured" | Scheduler tables migration not applied — run step 1. |
| Function returns 401 | `x-scheduler-secret` missing or doesn't match the Vault secret. Confirm `select exists(select 1 from vault.secrets where name='intelligence_scheduler_secret');` and that the cron job sends the header from Vault. |
| No scheduled runs appear | Cron not created — check `select * from cron.job;`; ensure `pg_cron`/`pg_net` enabled and the Vault `project_url` secret is set. |
| Scheduled run skips with "schedule disabled" | The UI **Disable schedule** toggle set `intelligence_scheduler_config.enabled = false`. Re-enable to resume. |
| Run "skipped: another run already active" | Expected when a run overlaps; the lock is working. |
| Repeated runs, no new issues | Expected when no material change — see change detection. |
