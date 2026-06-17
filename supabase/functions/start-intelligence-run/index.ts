// start-intelligence-run — server-owned entrypoint for the manual "Run
// Intelligence Update" button (and Ultra Debug runs).
//
// Contract: returns QUICKLY with { ok, run_id, status } and runs the pipeline in
// a background task (EdgeRuntime.waitUntil), writing heartbeat + per-stage
// progress + counters + events to the DB. Closing the tab, refreshing, losing
// network, or logging out does NOT stop or expire the run — only the server
// worker's heartbeat governs liveness.
//
// Every failure path returns STRUCTURED JSON { ok:false, error_code, message,
// debug:{ stage, ... } } — never a bare network-looking error. A top-level
// try/catch guarantees even an unexpected throw returns JSON (so the browser
// shows the real reason, not "Failed to send a request to the Edge Function").
//
// Secrets are never logged or returned — only presence booleans.

// deno-lint-ignore-file no-explicit-any
import { createClient } from "jsr:@supabase/supabase-js@2";
import { type RunMode } from "../_shared/intelligence-orchestrator.ts";

declare const EdgeRuntime: { waitUntil: (p: Promise<unknown>) => void } | undefined;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const LOCK_TTL_SECONDS = 1800;
const TOTAL_STAGES = 9;
const DEMO_COMPANY_ID = "d56259ad-c9f0-42c1-a241-167bdab6a7c6";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

// Structured failure helper. error_code is machine-readable; debug.stage tells
// the UI exactly where startup failed.
function fail(error_code: string, message: string, stage: string, status = 400, extra: Record<string, unknown> = {}) {
  return json({ ok: false, error_code, message, debug: { stage, function_name: "start-intelligence-run", ...extra } }, status);
}

function present(name: string): boolean {
  const v = Deno.env.get(name);
  return typeof v === "string" && v.length > 0;
}

// Recognizes a Postgres/PostgREST "column does not exist / not in schema cache"
// error and returns the offending column name (or a generic marker), so the
// caller can surface schema_migration_missing instead of a vague db_insert_failed.
function detectMissingColumn(err: unknown): string | null {
  if (!err) return null;
  const e = err as { code?: string; message?: string };
  const msg = e.message ?? "";
  const isSchema =
    e.code === "42703" ||                       // Postgres: undefined_column
    e.code === "PGRST204" ||                     // PostgREST: column not in schema cache
    /could not find the .* column/i.test(msg) ||
    /column .* does not exist/i.test(msg) ||
    /schema cache/i.test(msg);
  if (!isSchema) return null;
  const m = msg.match(/['"`]?([a-z_]+)['"`]? column/i) || msg.match(/column ['"`]?([a-z_.]+)['"`]?/i);
  return m?.[1] ?? "unknown";
}

function lockKeyFor(companyId: string) {
  return `intelligence-update:company:${companyId}`;
}

Deno.serve(async (req) => {
  // First line: proves the function was reached at all (visible in edge logs).
  console.info("[start-intelligence-run] invoked", { method: req.method });

  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  // ── Top-level guard: ANY unexpected throw still returns structured JSON ───
  try {
    const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    // ── 1. Auth ──────────────────────────────────────────────────────────
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) return fail("missing_auth", "No Authorization bearer token was sent.", "auth", 401, { user_present: false });

    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    const user = userData?.user ?? null;
    if (userErr || !user) {
      return fail("missing_auth", "Session is missing or expired. Please sign in again.", "auth", 401, { user_present: false });
    }

    // ── 2. Payload ─────────────────────────────────────────────────────────
    let payload: any = {};
    try { payload = await req.json(); } catch { payload = {}; }

    const companyId: string | null = payload.company_id ?? null;
    const rawRunMode: string = payload.run_mode ?? "full";
    const force: boolean = !!payload.force;
    const debug: boolean = !!payload.debug || rawRunMode === "ultra_debug";
    const dryRun: boolean = !!payload.dry_run;
    const cleanupAfter: boolean = !!payload.cleanup_after;
    const ultraDebug = rawRunMode === "ultra_debug";
    const queryCap: number | undefined = ultraDebug
      ? Number(payload.query_cap ?? 10)
      : (payload.query_cap != null ? Number(payload.query_cap) : undefined);
    const maxArticlesPerQuery: number | undefined = payload.max_articles_per_query != null ? Number(payload.max_articles_per_query) : undefined;
    // ultra_debug runs the full stage set but with caps + optional cleanup.
    const runMode: RunMode = (ultraDebug ? "full" : (rawRunMode as RunMode));

    const secrets_present = {
      SUPABASE_URL: present("SUPABASE_URL"),
      SUPABASE_SERVICE_ROLE_KEY: present("SUPABASE_SERVICE_ROLE_KEY"),
      SUPABASE_ANON_KEY: present("SUPABASE_ANON_KEY"),
      CURRENTS_API_KEY: present("CURRENTS_API_KEY"),
    };

    if (!companyId) {
      return fail("missing_company", "company_id is required.", "payload", 400, { user_present: true, company_id_present: false });
    }

    // ── 3. Demo write block ────────────────────────────────────────────────
    if (companyId === DEMO_COMPANY_ID) {
      return fail("demo_read_only", "The demo workspace is read-only.", "company", 403, { user_present: true, company_id_present: true });
    }

    // ── 4. Membership ──────────────────────────────────────────────────────
    const { data: memberships, error: memErr } = await db
      .from("company_memberships")
      .select("company_id")
      .eq("user_id", user.id)
      .eq("company_id", companyId)
      .limit(1);
    if (memErr) {
      return fail("db_insert_failed", `Membership check failed: ${memErr.message}`, "company", 500, { user_present: true });
    }
    if (!memberships || memberships.length === 0) {
      return fail("forbidden", "You are not a member of this company.", "company", 403, { user_present: true, company_id_present: true });
    }

    // ── 5. Repair stale runs/locks, then dedupe against a live run ─────────
    await db.rpc("expire_stale_intelligence_runs", { p_company_id: companyId, p_stale_minutes: 5 });
    await db.rpc("expire_stale_intelligence_locks");

    const freshCutoff = new Date(Date.now() - 5 * 60_000).toISOString();
    const { data: liveRuns } = await db
      .from("intelligence_run_summaries")
      .select("id, pipeline_run_id, status, heartbeat_at, started_at")
      .eq("company_id", companyId)
      .in("status", ["running", "queued"])
      .gte("heartbeat_at", freshCutoff)
      .order("started_at", { ascending: false })
      .limit(1);
    if (liveRuns && liveRuns.length > 0) {
      const r = liveRuns[0] as any;
      // Idempotent: never start a duplicate; point the client at the live run.
      return json({ ok: true, status: "already_running", run_id: r.pipeline_run_id, summary_id: r.id, message: "A run is already active for this company." });
    }

    // ── 6. Create the run row ──────────────────────────────────────────────
    const runId = crypto.randomUUID();
    const lockKey = lockKeyFor(companyId);

    const { data: sumRow, error: sumErr } = await db
      .from("intelligence_run_summaries")
      .insert({
        pipeline_run_id: runId,
        trigger_type: ultraDebug ? "ultra_debug" : "manual",
        status: "queued",
        company_id: companyId,
        schedule_name: ultraDebug ? "ultra debug" : (force ? "manual · force full" : "manual"),
        lock_key: lockKey,
        run_mode: ultraDebug ? "ultra_debug" : runMode,
        force,
        heartbeat_at: new Date().toISOString(),
        current_stage: "accepted",
        current_stage_label: "Run accepted",
        current_stage_index: 0,
        total_stages: TOTAL_STAGES,
        progress_pct: 0,
        debug: { dry_run: dryRun, query_cap: queryCap ?? null, max_articles_per_query: maxArticlesPerQuery ?? null, cleanup_after: cleanupAfter, secrets_present, debug },
      })
      .select("id")
      .single();
    if (sumErr || !sumRow) {
      const schemaMiss = detectMissingColumn(sumErr);
      if (schemaMiss) {
        return json({
          ok: false,
          error_code: "schema_migration_missing",
          message: `Run table is missing required column: ${schemaMiss}. The run-schema migration has not been applied to this project.`,
          suggested_fix: "Run `supabase db push` (applies 20260619000000_run_schema_repair.sql) and reload the PostgREST schema cache (NOTIFY pgrst, 'reload schema'). Then click Test Edge Function health and confirm run_schema_ready: true.",
          debug: { stage: "create_run", function_name: "start-intelligence-run", missing_column: schemaMiss, pg_code: (sumErr as any)?.code ?? null },
        }, 503);
      }
      return fail("db_insert_failed", `Could not create run row: ${sumErr?.message ?? "unknown"}`, "create_run", 500, { user_present: true });
    }
    const summaryId = (sumRow as any).id as string;

    await db.from("intelligence_run_events").insert({
      run_id: runId, summary_id: summaryId, company_id: companyId,
      stage: "accepted", level: "info",
      message: `Run accepted (${ultraDebug ? "ultra_debug" : runMode}${force ? ", force" : ""}${dryRun ? ", dry_run" : ""}).`,
      counters: {},
    });

    // ── 7. Acquire the lock ────────────────────────────────────────────────
    const { data: acquired } = await db.rpc("acquire_intelligence_run_lock", {
      p_lock_key: lockKey, p_run_id: runId, p_ttl_seconds: LOCK_TTL_SECONDS, p_acquired_by: ultraDebug ? "ultra_debug" : "manual",
    });
    if (!acquired) {
      await db.from("intelligence_run_summaries").update({
        status: "skipped", error_code: "lock_active", skipped_reason: "another run already active", completed_at: new Date().toISOString(),
      }).eq("id", summaryId);
      return json({ ok: false, error_code: "lock_active", message: "Another run just started for this company.", run_id: runId, summary_id: summaryId, debug: { stage: "lock" } }, 409);
    }

    // ── 8. ENQUEUE for the staged worker, then kick it once ───────────────────
    // The pipeline is advanced one stage/chunk at a time by
    // continue-intelligence-run (Option B). We never run the long pipeline in a
    // single invocation. The internal worker cron is the safety net if this
    // immediate kick is lost; either way the browser is irrelevant from here.
    await db.from("intelligence_run_summaries").update({
      status: "queued",
      next_stage: "fetch-fresh",
      stage_cursor: { query_index: 0 },
      worker_claimed_until: null,
      current_stage: "queued",
      current_stage_label: "Queued — worker starting…",
      heartbeat_at: new Date().toISOString(),
    }).eq("id", summaryId);

    const kick = (async () => {
      try {
        await fetch(`${SUPABASE_URL}/functions/v1/continue-intelligence-run`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
          body: JSON.stringify({ run_id: runId }),
        });
      } catch { /* internal worker cron will pick it up within a minute */ }
    })();
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(kick);
    else void kick;

    // ── 9. Return immediately — browser only observes from here ────────────
    return json({
      ok: true, run_id: runId, summary_id: summaryId, status: "queued",
      message: "Run accepted",
      debug: debug ? { stage: "enqueue", function_name: "start-intelligence-run", company_id_present: true, user_present: true, run_mode: ultraDebug ? "ultra_debug" : runMode, dry_run: dryRun, query_cap: queryCap ?? null, secrets_present } : undefined,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[start-intelligence-run] unhandled exception", { error: msg });
    return fail("function_exception", msg.slice(0, 500), "unknown", 500);
  }
});
