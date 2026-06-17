// continue-intelligence-run — the resumable, cron-driven STAGED runner (Option B).
//
// Advances ONE stage (or one bounded fetch chunk) of an in-flight run per
// invocation, persisting cursor + counters + heartbeat to the DB, then either
// self-invokes (immediate progression) or is picked up by the internal worker
// cron within a minute. No single invocation runs the whole pipeline, so an
// 80-query force-full run can never exceed an Edge Function wall-clock limit,
// and a dead worker is simply resumed by the next cron tick. The browser is
// never involved — it only observes the run row.
//
// Auth: INTERNAL only — service-role bearer (self-invoke from start/continue) or
// the Vault scheduler secret (cron). The browser can never call this. Secrets
// are never logged or returned.

// deno-lint-ignore-file no-explicit-any
import { createClient } from "jsr:@supabase/supabase-js@2";
import { runFreshIntelligenceChunk } from "../_shared/fresh-intelligence.ts";
import { detectChanges, cleanupRunArtifacts } from "../_shared/intelligence-orchestrator.ts";

declare const EdgeRuntime: { waitUntil: (p: Promise<unknown>) => void } | undefined;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CHUNK_SIZE = 8;        // queries per fetch invocation
const CLAIM_SECONDS = 120;   // single-flight claim window
const LOCK_TTL_SECONDS = 1800;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-scheduler-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

const STAGES = [
  { id: "fetch-fresh", label: "Fetching external intelligence" },
  { id: "score-events", label: "Scoring relevance" },
  { id: "detect-changes", label: "Detecting material change" },
  { id: "build-connections", label: "Building company connections" },
  { id: "generate-risks", label: "Generating risks" },
  { id: "generate-opportunities", label: "Generating opportunities" },
  { id: "quality-gate", label: "Running quality gate" },
  { id: "generate-brief", label: "Rebuilding leadership brief" },
  { id: "finalize", label: "Finalizing & consistency check" },
];
const STAGE_INDEX: Record<string, number> = Object.fromEntries(STAGES.map((s, i) => [s.id, i]));
const TERMINAL = new Set(["completed", "completed_with_warnings", "failed", "expired", "cancelled", "skipped"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  console.info("[continue-intelligence-run] invoked");

  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  // ── Internal-only auth ─────────────────────────────────────────────────────
  const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  let authed = !!bearer && bearer === SERVICE_KEY;
  if (!authed) {
    const provided = req.headers.get("x-scheduler-secret") ?? "";
    if (provided) {
      const { data } = await db.rpc("verify_scheduler_secret", { p_secret: provided });
      authed = data === true;
    }
  }
  if (!authed) return json({ ok: false, error: "unauthorized" }, 401);

  let body: any = {};
  try { body = await req.json(); } catch { body = {}; }

  try {
    // ── Pick the run to advance ──────────────────────────────────────────────
    let run = await pickRun(db, body.run_id ?? null);
    if (!run) return json({ ok: true, message: "no run to advance" });

    // Recover from a dead worker: expire runs whose heartbeat is >5 min stale.
    await db.rpc("expire_stale_intelligence_runs", { p_company_id: run.company_id, p_stale_minutes: 5 });
    run = await reload(db, run.id);
    if (!run || TERMINAL.has(run.status)) return json({ ok: true, message: "run terminal/expired" });

    // ── Atomic single-flight claim ───────────────────────────────────────────
    const nowIso = new Date().toISOString();
    const claimUntil = new Date(Date.now() + CLAIM_SECONDS * 1000).toISOString();
    const { data: claimed } = await db
      .from("intelligence_run_summaries")
      .update({ worker_claimed_until: claimUntil, status: "running", heartbeat_at: nowIso })
      .eq("id", run.id)
      .in("status", ["queued", "running"])
      .or(`worker_claimed_until.is.null,worker_claimed_until.lt.${nowIso}`)
      .select("id");
    if (!claimed || claimed.length === 0) {
      return json({ ok: true, message: "run already claimed by another worker", run_id: run.pipeline_run_id });
    }

    // Renew the company lock under our run_id.
    const lockKey = run.lock_key ?? `intelligence-update:company:${run.company_id}`;
    const lockExp = new Date(Date.now() + LOCK_TTL_SECONDS * 1000).toISOString();
    await db.from("intelligence_run_locks").upsert(
      { lock_key: lockKey, run_id: run.pipeline_run_id, acquired_at: nowIso, expires_at: lockExp, acquired_by: "worker" },
      { onConflict: "lock_key" },
    );
    await db.from("intelligence_run_summaries").update({ lock_expires_at: lockExp }).eq("id", run.id);

    // ── Execute exactly one stage / chunk ────────────────────────────────────
    const result = await advanceOneStage(db, run);

    // Release the claim so the next invocation (self-kick or cron) can proceed.
    if (!result.done) {
      await db.from("intelligence_run_summaries").update({ worker_claimed_until: null }).eq("id", run.id);
      // Immediate progression (cron is the safety net if this fails).
      if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
        EdgeRuntime.waitUntil(kickContinue(run.pipeline_run_id));
      } else {
        void kickContinue(run.pipeline_run_id);
      }
    }

    return json({ ok: true, run_id: run.pipeline_run_id, stage: result.stage, next_stage: result.nextStage, done: result.done });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[continue-intelligence-run] exception", { error: msg });
    return json({ ok: false, error_code: "function_exception", message: msg.slice(0, 500) }, 500);
  }
});

// ── Run selection ─────────────────────────────────────────────────────────────
async function pickRun(db: any, runId: string | null): Promise<any | null> {
  if (runId) {
    const { data } = await db.from("intelligence_run_summaries").select("*").eq("pipeline_run_id", runId).limit(1);
    return data?.[0] ?? null;
  }
  // Sweep: oldest non-terminal, unclaimed run.
  const nowIso = new Date().toISOString();
  const { data } = await db
    .from("intelligence_run_summaries")
    .select("*")
    .in("status", ["queued", "running"])
    .or(`worker_claimed_until.is.null,worker_claimed_until.lt.${nowIso}`)
    .order("started_at", { ascending: true })
    .limit(1);
  return data?.[0] ?? null;
}
async function reload(db: any, id: string): Promise<any | null> {
  const { data } = await db.from("intelligence_run_summaries").select("*").eq("id", id).limit(1);
  return data?.[0] ?? null;
}

async function kickContinue(runId: string) {
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/continue-intelligence-run`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({ run_id: runId }),
    });
  } catch { /* cron will pick it up */ }
}

async function invokeFunction(name: string, payload: unknown): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}`, apiKey: SERVICE_KEY },
      body: JSON.stringify(payload),
    });
    if (!res.ok) return { ok: false, error: `${name} -> HTTP ${res.status}` };
    const data = await res.json().catch(() => ({}));
    if (data && typeof data === "object" && "error" in data && (data as any).error) return { ok: false, error: `${name} -> ${(data as any).error}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `${name} -> ${e instanceof Error ? e.message : String(e)}` };
  }
}
async function countRows(db: any, table: string, filter?: (q: any) => any): Promise<number> {
  let q = db.from(table).select("*", { count: "exact", head: true });
  if (filter) q = filter(q);
  const { count, error } = await q;
  return error ? 0 : (count ?? 0);
}

// ── The stage machine ─────────────────────────────────────────────────────────
async function advanceOneStage(db: any, run: any): Promise<{ stage: string; nextStage: string | null; done: boolean }> {
  const dbg = run.debug ?? {};
  const dryRun = !!dbg.dry_run;
  const ultraDebug = run.run_mode === "ultra_debug";
  const queryCap = dbg.query_cap ?? undefined;
  const maxArticlesPerQuery = dbg.max_articles_per_query ?? undefined;
  const cleanupAfter = !!dbg.cleanup_after;
  const force = !!run.force;
  const cursor = run.stage_cursor ?? {};
  const stageId: string = run.next_stage || "fetch-fresh";
  const idx = STAGE_INDEX[stageId] ?? 0;

  const setStage = async (label: string, patch: Record<string, unknown> = {}) => {
    await db.from("intelligence_run_summaries").update({
      status: "running",
      current_stage: stageId,
      current_stage_label: label,
      current_stage_index: idx + 1,
      total_stages: STAGES.length,
      progress_pct: Math.round(((idx + 1) / STAGES.length) * 100),
      heartbeat_at: new Date().toISOString(),
      ...patch,
    }).eq("id", run.id);
  };
  const event = async (level: string, message: string, counters: Record<string, unknown> = {}) => {
    await db.from("intelligence_run_events").insert({
      run_id: run.pipeline_run_id, summary_id: run.id, company_id: run.company_id, stage: stageId, level, message, counters,
    });
    console.info("[UltraDebug server]", { runId: run.pipeline_run_id, companyId: run.company_id, stage: stageId, counters });
  };

  switch (stageId) {
    // ── Stage 1: chunked Currents fetch ──────────────────────────────────────
    case "fetch-fresh": {
      const baseline = cursor.baseline ?? {
        risks: await countRows(db, "risk_register", (q) => q.eq("company_id", run.company_id)),
        shocks: await countRows(db, "verified_shocks", (q) => q.eq("company_id", run.company_id)),
        actions: await countRows(db, "risk_actions"),
        paths: await countRows(db, "exposure_paths", (q) => q.eq("company_id", run.company_id)),
      };
      const startIndex = cursor.query_index ?? 0;
      const chunk = await runFreshIntelligenceChunk(db, run.company_id, {
        supabaseUrl: SUPABASE_URL, serviceKey: SERVICE_KEY, startIndex, chunkSize: CHUNK_SIZE, queryCap, maxArticlesPerQuery, dryRun,
      });
      const acc = {
        raw_queries_generated: chunk.rawQueries,
        deduped_queries: chunk.dedupedRemoved,
        capped_queries: chunk.cappedRemoved,
        queries_executed: (run.queries_executed ?? 0) + chunk.delta.queries_executed,
        articles_fetched: (run.articles_fetched ?? 0) + chunk.delta.articles_fetched,
        articles_normalized: (run.articles_normalized ?? 0) + chunk.delta.articles_normalized,
        articles_inserted: (run.articles_inserted ?? 0) + chunk.delta.articles_inserted,
        article_duplicates: (run.article_duplicates ?? 0) + chunk.delta.article_duplicates,
        articles_rejected: (run.articles_rejected ?? 0) + chunk.delta.articles_rejected,
      };
      const nextStage = chunk.done ? "score-events" : "fetch-fresh";
      const nextCursor = chunk.done ? { baseline } : { query_index: chunk.nextIndex, baseline };
      await setStage(`Fetching external intelligence (${Math.min(chunk.nextIndex, chunk.totalQueries)}/${chunk.totalQueries} queries)`, {
        ...acc, next_stage: nextStage, stage_cursor: nextCursor,
      });
      await event("info", `Fetched queries ${startIndex}–${chunk.nextIndex}/${chunk.totalQueries}; +${chunk.delta.articles_inserted} new articles.`, acc);
      return { stage: stageId, nextStage, done: false };
    }

    case "score-events": {
      await setStage("Scoring relevance");
      const r = await invokeFunction("score-events", { companyId: run.company_id });
      const ce = await countRows(db, "company_event_evaluations", (q) => q.eq("company_id", run.company_id));
      await db.from("intelligence_run_summaries").update({ company_evaluations_created: ce, next_stage: "detect-changes" }).eq("id", run.id);
      await event(r.ok ? "info" : "warning", r.ok ? `Scored events (${ce} evaluations).` : `score-events: ${r.error}`, { company_evaluations_created: ce });
      return { stage: stageId, nextStage: "detect-changes", done: false };
    }

    case "detect-changes": {
      await setStage("Detecting material change");
      const { material } = await detectChanges(db, run.company_id, run.id);
      // Generation gate. allow_generation defaults true; dry runs never generate.
      const { data: cfgRows } = await db.from("intelligence_scheduler_config").select("allow_generation").eq("company_id", run.company_id).limit(1);
      const allowGeneration = cfgRows?.[0]?.allow_generation !== false;
      const shouldGenerate = !dryRun && allowGeneration && (force || material);
      const nextStage = shouldGenerate ? "build-connections" : "quality-gate";
      await db.from("intelligence_run_summaries").update({ next_stage: nextStage }).eq("id", run.id);
      await event("info", shouldGenerate ? "Material change / forced — generating." : dryRun ? "Dry run — skipping generation." : "No material change — skipping generation.", { material });
      return { stage: stageId, nextStage, done: false };
    }

    case "build-connections": {
      await setStage("Building company connections");
      const r = await invokeFunction("build-company-connections", { companyId: run.company_id });
      await db.from("intelligence_run_summaries").update({ next_stage: "generate-risks" }).eq("id", run.id);
      await event(r.ok ? "info" : "warning", r.ok ? "Built company connections." : `build-company-connections: ${r.error}`);
      return { stage: stageId, nextStage: "generate-risks", done: false };
    }

    case "generate-risks": {
      await setStage("Generating risks");
      const r = await invokeFunction("generate-dynamic-risks", { companyId: run.company_id });
      const baseline = cursor.baseline ?? {};
      const risksNow = await countRows(db, "risk_register", (q) => q.eq("company_id", run.company_id));
      const generated = Math.max(0, risksNow - (baseline.risks ?? 0));
      await db.from("intelligence_run_summaries").update({ candidates_generated: generated, next_stage: "generate-opportunities" }).eq("id", run.id);
      await event(r.ok ? "info" : "warning", r.ok ? `Generated risks (+${generated} candidates).` : `generate-dynamic-risks: ${r.error}`, { candidates_generated: generated });
      return { stage: stageId, nextStage: "generate-opportunities", done: false };
    }

    case "generate-opportunities": {
      await setStage("Generating opportunities");
      const r = await invokeFunction("generate-opportunities", { companyId: run.company_id });
      await db.from("intelligence_run_summaries").update({ next_stage: "quality-gate" }).eq("id", run.id);
      await event(r.ok ? "info" : "warning", r.ok ? "Generated opportunities." : `generate-opportunities: ${r.error}`);
      return { stage: stageId, nextStage: "quality-gate", done: false };
    }

    case "quality-gate": {
      await setStage("Running quality gate");
      const published = await countRows(db, "issue_quality_gate_results", (q) => q.eq("decision", "published"));
      const review = await countRows(db, "issue_quality_gate_results", (q) => q.eq("decision", "candidate_review"));
      const quarantined = await countRows(db, "issue_quality_gate_results", (q) => q.eq("decision", "quarantine"));
      const watch = await countRows(db, "issue_quality_gate_results", (q) => q.in("decision", ["watch", "watchlist"]));
      await db.from("intelligence_run_summaries").update({
        candidates_published: published, candidates_review: review, candidates_quarantined: quarantined,
        watch_items_created: watch, next_stage: "generate-brief",
      }).eq("id", run.id);
      await event("info", `Quality gate: ${published} published / ${review} review / ${quarantined} quarantined / ${watch} watch.`, { published, review, quarantined, watch });
      return { stage: stageId, nextStage: "generate-brief", done: false };
    }

    case "generate-brief": {
      await setStage("Rebuilding leadership brief");
      const r = await invokeFunction("generate-brief", { companyId: run.company_id });
      await db.from("intelligence_run_summaries").update({ briefs_created: r.ok ? 1 : 0, executive_brief_rebuilt: r.ok, next_stage: "finalize" }).eq("id", run.id);
      await event(r.ok ? "info" : "warning", r.ok ? "Rebuilt leadership brief." : `generate-brief: ${r.error}`);
      return { stage: stageId, nextStage: "finalize", done: false };
    }

    // ── Final stage: consistency + cleanup + terminal status + release lock ──
    case "finalize":
    default: {
      await setStage("Finalizing & consistency check");
      const fresh = await reload(db, run.id);
      const r = fresh ?? run;
      const baseline = cursor.baseline ?? {};
      const warnings: string[] = [];
      const runStartIso = r.started_at ?? new Date(0).toISOString();

      const shocksNow = await countRows(db, "verified_shocks", (q) => q.eq("company_id", run.company_id));
      const actionsNow = await countRows(db, "risk_actions");
      const pathsNow = await countRows(db, "exposure_paths", (q) => q.eq("company_id", run.company_id)).catch(() => 0);
      const forecastsNow = await countRows(db, "issue_forecasts", (q) => q.eq("company_id", run.company_id).gte("created_at", runStartIso)).catch(() => 0);
      const obsNow = await countRows(db, "external_metric_observations", (q) => q.eq("company_id", run.company_id));

      const counts = {
        verified_shocks_created: Math.max(0, shocksNow - (baseline.shocks ?? 0)),
        actions_created: Math.max(0, actionsNow - (baseline.actions ?? 0)),
        exposure_paths_created: Math.max(0, pathsNow - (baseline.paths ?? 0)),
        forecasts_created: forecastsNow,
        observations_ingested: obsNow,
        candidates_generated: r.candidates_generated ?? 0,
        candidates_published: r.candidates_published ?? 0,
        candidates_review: r.candidates_review ?? 0,
        candidates_quarantined: r.candidates_quarantined ?? 0,
        watch_items_created: r.watch_items_created ?? 0,
        articles_inserted: r.articles_inserted ?? 0,
        queries_executed: r.queries_executed ?? 0,
        raw_queries_generated: r.raw_queries_generated ?? 0,
      };

      const generated = counts.candidates_generated;
      const decided = counts.candidates_published + counts.candidates_review + counts.candidates_quarantined + counts.watch_items_created;
      const consistency: Record<string, boolean> = {
        candidate_reconcile: generated === 0 || decided <= generated,
        published_has_actions: counts.candidates_published === 0 || counts.actions_created >= counts.candidates_published,
        published_has_paths: counts.candidates_published === 0 || counts.exposure_paths_created >= counts.candidates_published,
        published_has_forecasts: counts.candidates_published === 0 || counts.forecasts_created >= counts.candidates_published,
      };
      const failed = Object.entries(consistency).filter(([, ok]) => !ok).map(([k]) => k);
      const consistent = failed.length === 0;
      if (!consistent && !dryRun) warnings.push(`consistency failed: ${failed.join(", ")}`);

      if (cleanupAfter && ultraDebug) {
        await cleanupRunArtifacts(db, { runSummaryId: run.id, pipelineRunId: run.pipeline_run_id }, run.company_id, runStartIso, !!dbg.cleanup_raw, warnings);
      }

      const status = warnings.length > 0 || !consistent ? "completed_with_warnings" : "completed";
      const tag = `${ultraDebug ? "ultra_debug · " : ""}${dryRun ? "dry_run · " : ""}${force ? "force full · " : ""}`;
      const note = counts.raw_queries_generated === 0
        ? `${tag}0 tracking queries: calibration has nothing to build queries from.`
        : `${tag}${counts.queries_executed}/${counts.raw_queries_generated} queries · ${counts.articles_inserted} new articles · ${generated} candidates · ${counts.candidates_published} published.`;

      await db.from("intelligence_run_summaries").update({
        status,
        completed_at: new Date().toISOString(),
        current_stage: "complete",
        current_stage_label: "Intelligence update complete",
        current_stage_index: STAGES.length,
        progress_pct: 100,
        heartbeat_at: new Date().toISOString(),
        worker_claimed_until: null,
        next_stage: null,
        error_code: consistent ? null : "consistency_warning",
        note, skipped_reason: note,
        warning_message: warnings.slice(0, 5).join(" · ").slice(0, 1000) || null,
        ...counts,
        summary: { run_mode: r.run_mode, force, dry_run: dryRun, consistent, consistency, warnings, note },
      }).eq("id", run.id);

      await db.from("intelligence_run_events").insert({
        run_id: run.pipeline_run_id, summary_id: run.id, company_id: run.company_id,
        stage: "finalize", level: status === "completed" ? "info" : "warning", message: note, counters: counts,
      });

      await db.rpc("release_intelligence_run_lock", { p_lock_key: run.lock_key ?? `intelligence-update:company:${run.company_id}`, p_run_id: run.pipeline_run_id });
      console.info("[UltraDebug server]", { runId: run.pipeline_run_id, companyId: run.company_id, stage: "finalize", counters: counts });
      return { stage: "finalize", nextStage: null, done: true };
    }
  }
}
