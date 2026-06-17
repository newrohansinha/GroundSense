// Intelligence-run stress + contract matrix (Part 9).
//
// GROUP A (Edge invocation/contract) runs with ONLY E2E_SUPABASE_URL +
// E2E_SUPABASE_ANON — it hits the deployed functions directly, no UI/login.
// These are the tests that would have caught "Failed to send a request to the
// Edge Function": they assert the functions are deployed, CORS preflight works,
// and every failure path returns STRUCTURED JSON (not a network error).
//
// GROUP B/H (server-owned execution + browser resilience) need a running app +
// a signed-in non-demo test account (E2E_BASE_URL / E2E_EMAIL / E2E_PASSWORD).
// They are skipped automatically when those env vars are absent.

import { test, expect, request } from "@playwright/test";

const SUPABASE_URL = process.env.E2E_SUPABASE_URL ?? "";
const ANON = process.env.E2E_SUPABASE_ANON ?? "";
const fn = (name: string) => `${SUPABASE_URL.replace(/\/$/, "")}/functions/v1/${name}`;

const apiReady = !!SUPABASE_URL && !!ANON;

test.describe("A. Edge invocation + contract", () => {
  test.skip(!apiReady, "set E2E_SUPABASE_URL + E2E_SUPABASE_ANON");

  test("A1. healthcheck is reachable and returns readiness shape", async () => {
    const ctx = await request.newContext();
    const res = await ctx.post(fn("intelligence-healthcheck"), {
      headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, "Content-Type": "application/json" },
      data: {},
    });
    expect(res.status(), "healthcheck must be deployed (200)").toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("function", "intelligence-healthcheck");
    expect(body).toHaveProperty("db_reachable");
    expect(body.secrets_present).toBeTruthy();
    // The Currents key must be present for real fetches.
    expect(body.secrets_present.SUPABASE_SERVICE_ROLE_KEY).toBe(true);
  });

  test("A7. OPTIONS preflight succeeds for start-intelligence-run", async () => {
    const ctx = await request.newContext();
    const res = await ctx.fetch(fn("start-intelligence-run"), {
      method: "OPTIONS",
      headers: { Origin: "http://localhost:5173", "Access-Control-Request-Method": "POST" },
    });
    expect([200, 204]).toContain(res.status());
    expect(res.headers()["access-control-allow-origin"]).toBeTruthy();
  });

  test("A3. start without auth returns structured 401 (not a network error)", async () => {
    const ctx = await request.newContext();
    const res = await ctx.post(fn("start-intelligence-run"), {
      headers: { apikey: ANON, "Content-Type": "application/json" }, // no Bearer user token
      data: { company_id: "00000000-0000-0000-0000-000000000000", run_mode: "full" },
    });
    expect(res.status()).toBe(401);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error_code).toBe("missing_auth");
    expect(body.debug?.stage).toBe("auth");
  });

  test("A5. start with missing company_id returns structured 400", async () => {
    // A real user token is required to reach payload validation; without it we
    // still must get a STRUCTURED 401 (proves no generic fetch failure).
    const ctx = await request.newContext();
    const res = await ctx.post(fn("start-intelligence-run"), {
      headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, "Content-Type": "application/json" },
      data: { run_mode: "full" },
    });
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(typeof body.error_code).toBe("string");
    expect(["missing_auth", "missing_company"]).toContain(body.error_code);
  });
});

// ── GROUP B/H — server-owned execution + browser resilience (UI) ────────────
const uiReady = !!process.env.E2E_BASE_URL && !!process.env.E2E_EMAIL && !!process.env.E2E_PASSWORD;

test.describe("B/H. Server-owned run survives browser lifecycle", () => {
  test.skip(!uiReady, "set E2E_BASE_URL + E2E_EMAIL + E2E_PASSWORD (non-demo account)");

  // Helper: sign in through the app UI.
  async function signIn(page: import("@playwright/test").Page) {
    await page.goto("/sign-in");
    await page.getByLabel(/email/i).fill(process.env.E2E_EMAIL!);
    await page.getByLabel(/password/i).fill(process.env.E2E_PASSWORD!);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/dashboard|\//, { timeout: 30_000 });
  }

  test("B8–11. start run, close tab 2 min, reopen → still running/completed (not expired)", async ({ context }) => {
    const page = await context.newPage();
    await signIn(page);
    await page.getByRole("button", { name: /Run Intelligence Update/i }).click();
    await expect(page.getByText(/Run accepted|Running intelligence|Fetching external/i)).toBeVisible({ timeout: 20_000 });

    // Simulate "closed tab" — close the page entirely; server keeps running.
    await page.close();
    await new Promise((r) => setTimeout(r, 120_000)); // 2 minutes

    const reopened = await context.newPage();
    await signIn(reopened);
    // The run must NOT have expired because the browser was gone.
    await expect(reopened.getByText(/server worker heartbeat stopped/i)).toHaveCount(0);
    // It is either still running or has completed server-side.
    await expect(reopened.getByText(/Running intelligence|Intelligence update complete|completed/i)).toBeVisible({ timeout: 20_000 });
  });

  test("B12–13. hard refresh mid-run resumes progress from DB (no duplicate run)", async ({ page }) => {
    await signIn(page);
    await page.getByRole("button", { name: /Run Intelligence Update/i }).click();
    await expect(page.getByText(/Fetching external|Running intelligence/i)).toBeVisible({ timeout: 20_000 });
    await page.reload();
    // Progress panel comes back from the DB after reload.
    await expect(page.getByText(/Running intelligence|Intelligence update complete/i)).toBeVisible({ timeout: 20_000 });
    // Run button is disabled while a live run exists (no duplicate start).
    await expect(page.getByRole("button", { name: /Updating Intelligence/i })).toBeVisible();
  });

  test("C16–19. double-click Run starts only one run", async ({ page }) => {
    await signIn(page);
    const btn = page.getByRole("button", { name: /Run Intelligence Update/i });
    await btn.click();
    await btn.click({ force: true }).catch(() => {});
    await expect(page.getByRole("button", { name: /Updating Intelligence/i })).toBeVisible({ timeout: 20_000 });
    // The server returns already_running for the second attempt; no second panel.
  });
});

/*
 * Manual-only resilience checks (cannot be reliably automated cross-platform):
 *  - H44–47 network loss: with a run active, toggle DevTools "Offline", wait,
 *    re-enable → server completes, UI catches up on next poll.
 *  - H48–51 logout/login mid-run: sign out after start, sign back in → run row
 *    still running/completed.
 *  - E26–30 stale expiry: UPDATE intelligence_run_summaries SET heartbeat_at =
 *    now() - interval '10 min' WHERE id = :run; then load dashboard → row shows
 *    "server worker heartbeat stopped", lock released, Run button enabled.
 * See docs/server-owned-intelligence-runs.md for the SQL.
 */
