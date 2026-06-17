// scheduled-intelligence-run — backend entrypoint for automatic intelligence updates.
//
// Called by Supabase Cron (daily) with a scheduler secret header. Acquires a run
// lock (no overlapping runs), records an intelligence_run_summaries row, chains the
// real intelligence edge functions via the shared orchestrator, then writes counts
// and releases the lock. Secrets are validated but never logged or returned.
//
// Auth: requires header `x-scheduler-secret` matching env INTELLIGENCE_SCHEDULER_SECRET.
// Until that secret is set the function rejects every request (secure by default).

// deno-lint-ignore-file no-explicit-any
import { createClient } from "jsr:@supabase/supabase-js@2";
import { runOrchestration, type RunMode } from "../_shared/intelligence-orchestrator.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DEFAULT_COMPANY_ID = Deno.env.get("DEFAULT_COMPANY_ID") ?? "";
const LOCK_TTL_SECONDS = 900;

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

  // ── Auth: verify the scheduler secret against the Vault-stored value via a SECURITY DEFINER
  // RPC. The secret never leaves the database (the RPC returns only a boolean) and no function
  // env secret is required. Reject if missing or mismatched. ──
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

  const runId = crypto.randomUUID();
  const lockKey = `intelligence-update:company:${companyId}`;

  // Load schedule config (for allow_generation / allow_publishing gates).
  const { data: cfg } = await db
    .from("intelligence_scheduler_config")
    .select("*")
    .or(`company_id.eq.${companyId},company_id.is.null`)
    .order("company_id", { ascending: false, nullsFirst: false })
    .limit(1);
  const config = cfg?.[0] ?? { allow_generation: true, allow_publishing: true, schedule_name: "default" };

  // Respect the UI "Disable schedule" toggle for scheduled runs (manual runs always proceed).
  // Skip cleanly without creating run-history noise when the schedule is disabled.
  if (triggerType === "scheduled" && config.enabled === false) {
    return json({ status: "skipped", reason: "schedule disabled" });
  }

  // Create the run summary (status running).
  const { data: sumRow } = await db
    .from("intelligence_run_summaries")
    .insert({
      pipeline_run_id: runId,
      trigger_type: triggerType,
      status: "running",
      company_id: companyId,
      schedule_name: config.schedule_name ?? "default",
      summary: { run_mode: runMode, source_scope: sourceScope },
    })
    .select("id")
    .single();
  const summaryId: string | null = sumRow?.id ?? null;

  // Sweep stale locks, then try to acquire.
  await db.rpc("expire_stale_intelligence_locks");
  const { data: acquired } = await db.rpc("acquire_intelligence_run_lock", {
    p_lock_key: lockKey,
    p_run_id: runId,
    p_ttl_seconds: LOCK_TTL_SECONDS,
    p_acquired_by: triggerType,
  });

  if (!acquired) {
    if (summaryId) {
      await db.from("intelligence_run_summaries").update({
        status: "skipped",
        skipped_reason: "another run already active",
        completed_at: new Date().toISOString(),
      }).eq("id", summaryId);
    }
    return json({ status: "skipped", reason: "another run already active", run_id: runId });
  }

  try {
    const counts = await runOrchestration({
      companyId,
      runMode,
      force,
      runSummaryId: summaryId,
      pipelineRunId: runId,
      allowGeneration: config.allow_generation !== false,
      allowPublishing: config.allow_publishing !== false,
    });

    const status = counts.warnings.length > 0 ? "completed_with_warnings" : "completed";
    if (summaryId) {
      await db.from("intelligence_run_summaries").update({
        status,
        completed_at: new Date().toISOString(),
        sources_checked: counts.sources_checked,
        observations_ingested: counts.observations_ingested,
        verified_shocks_created: counts.verified_shocks_created,
        candidates_generated: counts.candidates_generated,
        candidates_published: counts.candidates_published,
        candidates_review: counts.candidates_review,
        candidates_quarantined: counts.candidates_quarantined,
        actions_created: counts.actions_created,
        exposure_graph_rebuilt: counts.exposure_graph_rebuilt,
        executive_brief_rebuilt: counts.executive_brief_rebuilt,
        summary: { run_mode: runMode, material_change: counts.material_change, warnings: counts.warnings },
      }).eq("id", summaryId);
    }

    await db.rpc("release_intelligence_run_lock", { p_lock_key: lockKey, p_run_id: runId });
    return json({ status, run_id: runId, counts });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (summaryId) {
      await db.from("intelligence_run_summaries").update({
        status: "failed",
        error_message: msg.slice(0, 500),
        completed_at: new Date().toISOString(),
      }).eq("id", summaryId);
    }
    await db.rpc("release_intelligence_run_lock", { p_lock_key: lockKey, p_run_id: runId });
    return json({ status: "failed", error: msg.slice(0, 200), run_id: runId }, 500);
  }
});
