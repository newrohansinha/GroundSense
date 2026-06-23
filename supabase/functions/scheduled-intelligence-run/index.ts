// scheduled-intelligence-run — staged ENQUEUE entrypoint for the daily cron.
//
// Called by Supabase Cron (daily, 10:00 UTC) with the scheduler secret header.
// It does NOT run the pipeline synchronously. It validates auth, resolves the
// company, dedupes against any live run, creates a QUEUED
// intelligence_run_summaries row (trigger_type = scheduled, next_stage =
// refresh-sources), acquires the company run lock, kicks the staged worker
// (continue-intelligence-run) once, and returns immediately with
// { status: "accepted", ... }.
//
// The staged worker advances the run ONE bounded stage/chunk per invocation
// (fetch → score → generate → publish → provenance → brief → finalize) and is
// also swept every minute by the internal worker cron. Because no single Edge
// invocation runs the whole pipeline, a heavy full-generate scheduled run can
// never hit WORKER_RESOURCE_LIMIT — the exact failure this entrypoint used to
// cause by calling runOrchestration inline.
//
// Auth: gateway JWT (verify_jwt=true; cron sends Authorization: Bearer anon_key)
// PLUS header `x-scheduler-secret` verified against the Vault-stored value via a
// SECURITY DEFINER RPC. The secret never leaves the database. Secrets are never
// logged or returned.

// deno-lint-ignore-file no-explicit-any
import { createClient } from "jsr:@supabase/supabase-js@2";
import { type RunMode } from "../_shared/intelligence-orchestrator.ts";

declare const EdgeRuntime: { waitUntil: (p: Promise<unknown>) => void } | undefined;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DEFAULT_COMPANY_ID = Deno.env.get("DEFAULT_COMPANY_ID") ?? "";
const LOCK_TTL_SECONDS = 1800;
const TOTAL_STAGES = 12; // mirrors continue-intelligence-run STAGES; worker re-asserts it

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-scheduler-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  // ── Auth: verify the scheduler secret against the Vault-stored value via a
  // SECURITY DEFINER RPC (returns only a boolean). Reject if missing/mismatched. ──
  const provided = req.headers.get("x-scheduler-secret") ?? "";
  const { data: authorized, error: authErr } = await db.rpc("verify_scheduler_secret", {
    p_secret: provided,
  });
  if (authErr || authorized !== true) {
    return json({ error: "unauthorized" }, 401);
  }

  let payload: any = {};
  try {
    payload = await req.json();
  } catch {
    payload = {};
  }
  const triggerType: string = payload.trigger_type ?? "scheduled";
  const runMode: RunMode = payload.run_mode ?? "full";
  const force: boolean = !!payload.force;
  const sourceScope: string = payload.source_scope ?? "all";

  // Resolve company: explicit > env default > first company.
  let companyId: string | null = payload.company_id ?? DEFAULT_COMPANY_ID ?? null;
  if (!companyId) {
    const { data } = await db.from("companies").select("id").order("created_at", { ascending: true }).limit(1);
    companyId = data?.[0]?.id ?? null;
  }
  if (!companyId) return json({ error: "no_company" }, 400);

  // Load schedule config (for the enabled toggle + generation/publishing gates).
  const { data: cfg } = await db
    .from("intelligence_scheduler_config")
    .select("*")
    .or(`company_id.eq.${companyId},company_id.is.null`)
    .order("company_id", { ascending: false, nullsFirst: false })
    .limit(1);
  const config = cfg?.[0] ?? { allow_generation: true, allow_publishing: true, schedule_name: "default" };

  // Respect the UI "Disable schedule" toggle for scheduled runs (manual runs always
  // proceed). Skip cleanly without creating run-history noise when disabled.
  if (triggerType === "scheduled" && config.enabled === false) {
    return json({ status: "skipped", reason: "schedule disabled" });
  }

  const lockKey = `intelligence-update:company:${companyId}`;

  try {
    // ── Repair stale runs/locks, then dedupe against any live run ───────────────
    // Overlap prevention: if a scheduled (or manual) run is still in flight for this
    // company, never start a duplicate — attach the caller to the existing run.
    await db.rpc("expire_stale_intelligence_runs", { p_company_id: companyId, p_stale_minutes: 5 });
    await db.rpc("expire_stale_intelligence_locks");

    const freshCutoff = new Date(Date.now() - 5 * 60_000).toISOString();
    const { data: liveRuns } = await db
      .from("intelligence_run_summaries")
      .select("id, pipeline_run_id, trigger_type, status, current_stage_label")
      .eq("company_id", companyId)
      .in("status", ["running", "queued"])
      .gte("heartbeat_at", freshCutoff)
      .order("started_at", { ascending: false })
      .limit(1);
    if (liveRuns && liveRuns.length > 0) {
      const r = liveRuns[0] as any;
      return json({
        status: "already_running",
        run_id: r.pipeline_run_id,
        summary_id: r.id,
        attached_to_trigger_type: r.trigger_type,
        current_stage: r.current_stage_label ?? null,
        message: "A run is already active for this company; not starting a duplicate.",
      });
    }

    // ── Create the QUEUED run row for the staged worker ─────────────────────────
    const runId = crypto.randomUUID();
    const { data: sumRow, error: sumErr } = await db
      .from("intelligence_run_summaries")
      .insert({
        pipeline_run_id: runId,
        trigger_type: triggerType,            // preserved end-to-end (scheduled)
        status: "queued",
        company_id: companyId,
        schedule_name: config.schedule_name ?? "default",
        lock_key: lockKey,
        run_mode: runMode,
        force,
        heartbeat_at: new Date().toISOString(),
        current_stage: "accepted",
        current_stage_label: "Scheduled run accepted — worker starting…",
        current_stage_index: 0,
        total_stages: TOTAL_STAGES,
        progress_pct: 0,
        next_stage: "refresh-sources",
        stage_cursor: { query_index: 0 },
        worker_claimed_until: null,
        summary: { run_mode: runMode, source_scope: sourceScope, allow_generation: config.allow_generation !== false, allow_publishing: config.allow_publishing !== false },
        debug: { source_scope: sourceScope },
      })
      .select("id")
      .single();
    if (sumErr || !sumRow) {
      return json({ status: "failed", error: `could not create run row: ${sumErr?.message ?? "unknown"}`, run_id: runId }, 500);
    }
    const summaryId = (sumRow as any).id as string;

    await db.from("intelligence_run_events").insert({
      run_id: runId, summary_id: summaryId, company_id: companyId,
      stage: "accepted", level: "info",
      message: `Scheduled run accepted (${runMode}${force ? ", force" : ""}). Staged worker will advance it.`,
      counters: {},
    });

    // ── Acquire the company run lock ────────────────────────────────────────────
    const { data: acquired } = await db.rpc("acquire_intelligence_run_lock", {
      p_lock_key: lockKey,
      p_run_id: runId,
      p_ttl_seconds: LOCK_TTL_SECONDS,
      p_acquired_by: triggerType,
    });
    if (!acquired) {
      // Another run grabbed the lock between the dedupe check and here.
      await db.from("intelligence_run_summaries").update({
        status: "skipped",
        skipped_reason: "another run already active",
        completed_at: new Date().toISOString(),
      }).eq("id", summaryId);
      return json({ status: "skipped", reason: "another run already active", run_id: runId, summary_id: summaryId });
    }

    // ── Kick the staged worker once; the every-minute worker cron is the safety net ──
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

    // ── Return immediately — no synchronous pipeline work happened here ─────────
    return json({
      status: "accepted",
      run_id: runId,
      summary_id: summaryId,
      trigger_type: triggerType,
      worker: "continue-intelligence-run",
      message: "Scheduled run enqueued for the staged worker.",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[scheduled-intelligence-run] exception", { error: msg });
    return json({ status: "failed", error: msg.slice(0, 300) }, 500);
  }
});
