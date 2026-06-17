import { defineConfig } from "@playwright/test";

// Stress/contract tests for the intelligence-run subsystem.
//
// API-level tests (Part 9 group A) need only:
//   E2E_SUPABASE_URL   – e.g. https://kfzdvqhrkfquakqaqfbf.supabase.co
//   E2E_SUPABASE_ANON  – the anon (publishable) key
// UI-resilience tests (groups B/H) additionally need a signed-in app:
//   E2E_BASE_URL       – the running app (e.g. http://localhost:5173)
//   E2E_EMAIL / E2E_PASSWORD – a NON-demo test account with a company
//
// Run:  npx playwright test
export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:5173",
    trace: "on-first-retry",
  },
});
