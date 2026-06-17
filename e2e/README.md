# Intelligence-run E2E / stress tests

These cover the run subsystem stress matrix (Part 9). The **Group A** API/contract
tests are the ones that catch *"Failed to send a request to the Edge Function"* —
they prove the functions are deployed, CORS preflight works, and every failure
returns structured JSON.

## Install (one-time)

```bash
npm install            # picks up @playwright/test
npx playwright install # browser binaries
```

## Run the API/contract tests (no app/login needed)

```bash
E2E_SUPABASE_URL="https://kfzdvqhrkfquakqaqfbf.supabase.co" \
E2E_SUPABASE_ANON="<anon/publishable key>" \
npm run test:e2e -- intelligence-run.spec.ts -g "A\."
```

If `A1` fails with a connection error, the functions are **not deployed** — that
is the exact cause of the UI error. Deploy them (see
`docs/server-owned-intelligence-runs.md`) and re-run.

## Run the browser-resilience tests (needs the app + a non-demo account)

```bash
npm run dev   # in another terminal

E2E_BASE_URL="http://localhost:5173" \
E2E_EMAIL="you@example.com" \
E2E_PASSWORD="…" \
E2E_SUPABASE_URL="…" E2E_SUPABASE_ANON="…" \
npm run test:e2e
```

Tests auto-skip when their required env vars are absent, so partial runs are fine.

## What is NOT auto-tested (manual steps in the spec footer)

Network-loss, logout-mid-run, and stale-heartbeat expiry require DevTools/SQL
actions that don't automate reliably cross-platform; the steps are documented in
`intelligence-run.spec.ts` and the SQL is in
`docs/server-owned-intelligence-runs.md`.
