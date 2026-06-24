// scheduled-intelligence-run — staged ENQUEUE entrypoint for the daily cron.
//
// Two modes:
//   1. CRON (no company_id in body): MULTI-COMPANY. Scans intelligence_scheduler_config
//      for every company-specific schedule with enabled = true and enqueues a staged
//      scheduled run for each (skipping any company that already has a live run). This
//      is what makes the dashboard truthful: if a company's schedule shows "enabled"
//      and a "next scheduled" time, the daily cron actually enqueues that company.
//   2. EXPLICIT (company_id in body): operator/test override — enqueues exactly that
//      company regardless of its enabled flag.
//
// In BOTH modes the work is enqueue-only: validate auth, dedupe per company, create a
// QUEUED intelligence_run_summaries row (trigger_type=scheduled, next_stage=
// refresh-sources), acquire the per-company lock, kick the staged worker
// (continue-intelligence-run) once, and return immediately. No pipeline work runs
// synchronously here, so a heavy run can never hit WORKER_RESOURCE_LIMIT. The
// every-minute worker cron is the safety net that advances each run in bounded chunks
// and runs the provenance writer at finalize.
//
// Overlap is prevented PER COMPANY (per-company lock + live-run dedupe), so Acme
// running never blocks Fastenal, and a company already running is skipped (not
// duplicated) with a clear note.
//
// Auth: gateway JWT (verify_jwt=true; cron sends Authorization: Bearer anon_key)
// PLUS header x-scheduler-secret verified against the Vault-stored value via a
// SECURITY DEFINER RPC. Secrets are never logged or returned.

// deno-lint-ignore-file no-explicit-any
import { createClient } from "jsr:@supabase/supabase-js@2";
import { type RunMode } from "../_shared/intelligence-orchestrator.ts";

declare const EdgeRuntime: { waitUntil: (p: Promise<unknown>) => void } | undefined;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
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

type EnqueueOpts = {
  runMode: RunMode;
  sourceScope: string;
  force: boolean;
  scheduleName: string;
  allowGeneration: boolean;
  allowPublishing: boolean;
};
type EnqueueResult = {
  company_id: string;
  status: "accepted" | "already_running" | "skipped" | "error";
  run_id?: string;
  summary_id?: string;
  reason?: string;
  error?: string;
};

// Enqueue a single company's staged scheduled run. Idempotent per company: if a
// live run already exists, it is skipped (never duplicated). Never throws.
async function enqueueOne(db: any, companyId: string, opts: EnqueueOpts): Promise<EnqueueResult> {
  const lockKey = `intelligence-update:company:${companyId}`;
  try {
    // Repair this company's stale runs, then dedupe against a live run.
    await db.rpc("expire_stale_intelligence_runs", { p_company_id: companyId, p_stale_minutes: 5 });

    const freshCutoff = new Date(Date.now() - 5 * 60_000).toISOString();
    const { data: liveRuns } = await db
      .from("intelligence_run_summaries")
      .select("id, pipeline_run_id, trigger_type")
      .eq("company_id", companyId)
      .in("status", ["running", "queued"])
      .gte("heartbeat_at", freshCutoff)
      .order("started_at", { ascending: false })
      .limit(1);
    if (liveRuns && liveRuns.length > 0) {
      const r = liveRuns[0] as any;
      return { company_id: companyId, status: "already_running", run_id: r.pipeline_run_id, summary_id: r.id, reason: `a ${r.trigger_type} run is already active` };
    }

    const runId = crypto.randomUUID();
    const { data: sumRow, error: sumErr } = await db
      .from("intelligence_run_summaries")
      .insert({
        pipeline_run_id: runId,
        trigger_type: "scheduled",
        status: "queued",
        company_id: companyId,
        schedule_name: opts.scheduleName,
        lock_key: lockKey,
        run_mode: opts.runMode,
        force: opts.force,
        heartbeat_at: new Date().toISOString(),
        current_stage: "accepted",
        current_stage_label: "Scheduled run accepted — worker starting…",
        current_stage_index: 0,
        total_stages: TOTAL_STAGES,
        progress_pct: 0,
        next_stage: "refresh-sources",
        stage_cursor: { query_index: 0 },
        worker_claimed_until: null,
        summary: { run_mode: opts.runMode, source_scope: opts.sourceScope, allow_generation: opts.allowGeneration, allow_publishing: opts.allowPublishing },
        debug: { source_scope: opts.sourceScope },
      })
      .select("id")
      .single();
    if (sumErr || !sumRow) {
      return { company_id: companyId, status: "error", error: `could not create run row: ${sumErr?.message ?? "unknown"}` };
    }
    const summaryId = (sumRow as any).id as string;

    await db.from("intelligence_run_events").insert({
      run_id: runId, summary_id: summaryId, company_id: companyId,
      stage: "accepted", level: "info",
      message: `Scheduled run accepted (${opts.runMode}${opts.force ? ", force" : ""}). Staged worker will advance it.`,
      counters: {},
    });

    const { data: acquired } = await db.rpc("acquire_intelligence_run_lock", {
      p_lock_key: lockKey, p_run_id: runId, p_ttl_seconds: LOCK_TTL_SECONDS, p_acquired_by: "scheduled",
    });
    if (!acquired) {
      await db.from("intelligence_run_summaries").update({
        status: "skipped", skipped_reason: "another run already active", completed_at: new Date().toISOString(),
      }).eq("id", summaryId);
      return { company_id: companyId, status: "skipped", run_id: runId, summary_id: summaryId, reason: "lock held by another run" };
    }

    // Kick the staged worker once; the every-minute worker cron is the safety net.
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

    return { company_id: companyId, status: "accepted", run_id: runId, summary_id: summaryId };
  } catch (e) {
    return { company_id: companyId, status: "error", error: e instanceof Error ? e.message : String(e) };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  // ── Auth: verify the scheduler secret against the Vault-stored value ──
  const provided = req.headers.get("x-scheduler-secret") ?? "";
  const { data: authorized, error: authErr } = await db.rpc("verify_scheduler_secret", { p_secret: provided });
  if (authErr || authorized !== true) {
    return json({ error: "unauthorized" }, 401);
  }

  let payload: any = {};
  try { payload = await req.json(); } catch { payload = {}; }

  const force: boolean = !!payload.force;
  // Sweep stale locks once for the whole batch (per-company live-run dedupe is in enqueueOne).
  await db.rpc("expire_stale_intelligence_locks");

  try {
    // ── EXPLICIT company (operator/test override): enqueue exactly that company ──
    if (payload.company_id) {
      const companyId: string = payload.company_id;
      const { data: cfg } = await db
        .from("intelligence_scheduler_config")
        .select("*")
        .or(`company_id.eq.${companyId},company_id.is.null`)
        .order("company_id", { ascending: false, nullsFirst: false })
        .limit(1);
      const config = cfg?.[0] ?? {};
      const r = await enqueueOne(db, companyId, {
        runMode: (payload.run_mode ?? config.run_mode ?? "full") as RunMode,
        sourceScope: payload.source_scope ?? config.source_scope ?? "all",
        force,
        scheduleName: config.schedule_name ?? "manual scheduled (explicit)",
        allowGeneration: config.allow_generation !== false,
        allowPublishing: config.allow_publishing !== false,
      });
      const httpStatus = r.status === "error" ? 500 : 200;
      return json({ mode: "explicit", ...r }, httpStatus);
    }

    // ── CRON (multi-company): enqueue every company with an enabled schedule ──
    // Only company-specific enabled schedules are eligible (the company_id=null row is
    // the global UI default template, not a company to run). Companies opt IN by
    // enabling their own schedule — so the dashboard's "enabled / next scheduled" is
    // exactly what the cron acts on.
    const { data: schedules, error: schedErr } = await db
      .from("intelligence_scheduler_config")
      .select("company_id, schedule_name, run_mode, source_scope, allow_generation, allow_publishing")
      .eq("enabled", true)
      .not("company_id", "is", null);
    if (schedErr) return json({ status: "error", error: `could not read schedules: ${schedErr.message}` }, 500);

    if (!schedules || schedules.length === 0) {
      return json({ status: "no_enabled_schedules", message: "No company has an enabled schedule; nothing enqueued.", accepted_count: 0, skipped_count: 0, error_count: 0, results: [] });
    }

    const results: EnqueueResult[] = [];
    for (const sc of schedules as any[]) {
      results.push(await enqueueOne(db, sc.company_id, {
        runMode: (sc.run_mode ?? "full") as RunMode,
        sourceScope: sc.source_scope ?? "all",
        force,
        scheduleName: sc.schedule_name ?? "Daily intelligence update",
        allowGeneration: sc.allow_generation !== false,
        allowPublishing: sc.allow_publishing !== false,
      }));
    }

    const accepted = results.filter((r) => r.status === "accepted");
    const skipped = results.filter((r) => r.status === "already_running" || r.status === "skipped");
    const errors = results.filter((r) => r.status === "error");
    return json({
      status: "accepted",
      mode: "multi_company",
      enrolled_count: schedules.length,
      accepted_count: accepted.length,
      skipped_count: skipped.length,
      error_count: errors.length,
      results,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[scheduled-intelligence-run] exception", { error: msg });
    return json({ status: "failed", error: msg.slice(0, 300) }, 500);
  }
});
