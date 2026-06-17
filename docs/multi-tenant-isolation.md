# Multi-tenant isolation & data scoping

How GroundSense keeps each company's data separate, how the public demo stays
read-only, and what is still global.

## Canonical workspace context

- The active company is the single source of truth in `localStorage["groundsense_company_id"]`,
  written **only** by `companyService` (`setActiveCompany` / `enterDemoMode`).
- `CompanyContext` exposes `{ company, demo, canWrite, onboardingComplete, setupError }`.
  - Authenticated member → `currentCompany` = their company, `canWrite = true`.
  - Public demo (`/demo`) → Fastenal demo company, `canWrite = false`.
  - An authenticated user **never** falls back to the demo company.
- Route guards: logged-out app routes → `/sign-in`; authenticated + incomplete
  onboarding → `/onboarding`; complete → `/dashboard`; `/demo` is public.

## Company scoping rules

- Every company-specific read/write filters `company_id = currentCompanyId`.
- Audited and confirmed scoped: `risk_register`, `risk_actions`,
  `opportunity_register`, `raw_events`, `event_assessments`, `verified_shocks`,
  `external_metrics`, `source_fusion_runs`, `company_calibration*`,
  `freight_lane_exposure`, `supplier_procurement_exposure`, `crm_demand_signals`,
  `onboarding_*`.
- **Fixed this sprint:** `intelligence_run_summaries` and
  `intelligence_scheduler_config` were read globally (run history + schedule
  leaked across companies). Both are now strictly company-scoped in
  `schedulerService`, and a new company gets its **own disabled** scheduler
  config from `ensureWorkspace` (never inherits another tenant's schedule).

## Global public cache vs company-specific evaluation

- **Global (shared, OK):** the catalog of available public connectors/sources
  (BLS, World Bank, GDELT, SEC, etc.) and raw external metric *observations*.
  These are reusable source material, not a company's evaluated state.
- **Company-specific (scoped):** verified shocks, source-fusion runs, article
  relevance/claims selected for a company, exposure graph, generated
  risks/opportunities/actions/briefs, run history, calibration, onboarding.
- Source Hub shows global connector availability, but a new company sees **no**
  company-specific evaluated claims/shocks until it runs its first update.

## Demo mode (read-only)

- Entry: `/demo` (or landing "View demo") sets the demo flag and loads the
  Fastenal sample workspace.
- A red "Demo workspace · read-only sample data" banner is shown.
- Writes are blocked two ways:
  1. **UI**: Run Intelligence Update, Generate Brief, Enable/Disable schedule,
     and Run-now are hidden when `isDemoMode()`.
  2. **Data layer (safety net)**: `saveCalibrationForCompany` and the calibration
     store's Supabase persist are no-ops in demo mode, so demo company data can
     never be mutated even via a deep link.

## RLS — phased plan

- **RLS enabled (this sprint + prior):** `profiles`, `company_memberships`,
  `onboarding_sessions`, `onboarding_answers`, `intelligence_run_summaries`,
  `intelligence_scheduler_config`. Policies: authenticated members get their own
  company's rows; the public demo company is readable by anon for the demo path;
  Edge Functions use the service role and bypass RLS.
- **Still application-scoped only (RLS not yet enabled):** the remaining legacy
  data tables (`risk_register`, `risk_actions`, `opportunity_register`,
  `raw_events`, `event_assessments`, `verified_shocks`, `external_metrics`,
  `source_fusion_runs`, calibration/exposure tables, etc.). They are correctly
  filtered by `company_id` in the app, but not yet DB-enforced.
  - Reason: they are read with the anon key by both the authenticated app and the
    public demo; blanket RLS needs the demo carve-out + verification per table.
  - The full, ready-to-apply migration lives at
    `supabase/deferred-migrations/20260614010000_full_rls_existing_tables.sql`.
    It enables RLS + member/demo policies on every `company_id` table. Apply it
    after verifying each surface against staging.

## Testing isolation

- **Onboarding autosave:** enter values in a stage, move forward/back/jump,
  refresh, sign out/in — values, checkboxes, and uploaded-CSV cards persist
  (source of truth is `onboarding_answers`, hydrated once via `useOnboardingDraft`).
- **Cross-company:** create company A, then company B; B's dashboard, run history,
  Source Hub, Risks, scheduler, and calibration must show **none** of A's or the
  demo's data.
- **Demo:** `/demo` works logged-out and read-only; Run/upload/schedule are gated.

## Fresh-company first intelligence run

- **Root cause of the fast/empty first run:** a new company had **0 tracking
  queries / 0 entities**, so `fetchFreshIntelligenceForCompany` had nothing to
  query → 0 events → 0 candidates → fast no-op. (The new onboarding wizard
  seeds calibration but the old single-form path's `createTrackingQueries` was
  never carried over.)
- **Fix:** `companySignalSeeder.seedCompanySignals(companyId)` derives
  `company_entities` + `news_tracking_queries` from the company's own onboarding
  data (industry, segments, products, suppliers, commodities, competitors). It
  runs on onboarding completion and again before any first/force run. A fresh
  company always gets baseline industry + broad-signal queries even with thin
  calibration.
- **First-run handling:** `isFirstRunForCompany` (no prior completed run) seeds
  signals before running and bypasses no-material-change shortcuts.
- **Honest run history:** `finishManualRun` records `run_mode`, `force`,
  `first_run_for_company`, `stages_executed`, seeded-query/event counts, and a
  human `note` (e.g. "fetched 0 source events (news source not configured)").
  The note shows in the run-history "Note" column, so a quick run is never an
  unexplained "completed · 0 generated".
- **Force full run:** an Advanced-controls button (authenticated, non-demo) that
  re-seeds and runs with `force` — labeled `manual · force full` in history.
- **Stale state:** abandoned `running` rows (>15m) and orphan locks are cleaned
  up; manual runs use a company-scoped lock key.

> Note: whether the run produces issues also depends on the external news/source
> APIs (`fetch-currents-query`, etc.) being configured server-side. If they
> return nothing, the run now says so explicitly instead of silently no-opping.

### SQL checks (replace with the new company id)

```sql
select count(*) from intelligence_run_summaries where company_id = '<new>';   -- 0 before first run
select count(*) from risk_register             where company_id = '<new>';   -- 0 before first run
select count(*) from onboarding_answers        where company_id = '<new>';   -- grows during onboarding
select company_id, count(*) from intelligence_run_summaries group by company_id; -- demo rows under demo id only
```
