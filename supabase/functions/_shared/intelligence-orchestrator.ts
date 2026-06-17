// Shared intelligence orchestration for scheduled + manual SERVER-SIDE runs.
//
// This is the single server-owned pipeline runner. It chains the real edge
// functions (score-events, build-company-connections, generate-dynamic-risks,
// generate-opportunities, generate-brief) and runs the ported Currents fresh-
// intelligence fetch — the SAME relevance/dedupe/cap path the manual button used
// to run in the browser. The browser is never the worker: this runs inside an
// Edge Function (foreground for cron, EdgeRuntime.waitUntil background for the
// manual Run button), writes the heartbeat + per-stage progress + counters to
// the DB, and appends a human-readable event per stage.
//
// Never logs secrets. Internal invokes use the service key from the runtime env.

// deno-lint-ignore-file no-explicit-any
import { createClient } from "jsr:@supabase/supabase-js@2";
import { runFreshIntelligenceFetch } from "./fresh-intelligence.ts";

export type RunMode = "full" | "source_scan" | "generate_only" | "graph_only" | "brief_only";

export type RunCounts = {
  sources_checked: number;
  observations_ingested: number;
  verified_shocks_created: number;
  candidates_generated: number;
  candidates_published: number;
  candidates_review: number;
  candidates_quarantined: number;
  actions_created: number;
  exposure_paths_created: number;
  forecasts_created: number;
  briefs_created: number;
  raw_queries_generated: number;
  deduped_queries: number;
  capped_queries: number;
  queries_executed: number;
  articles_fetched: number;
  articles_normalized: number;
  articles_inserted: number;
  article_duplicates: number;
  articles_rejected: number;
  company_evaluations_created: number;
  watch_items_created: number;
  exposure_graph_rebuilt: boolean;
  executive_brief_rebuilt: boolean;
  warnings: string[];
  material_change: boolean;
  consistent: boolean;
  // Named consistency checks (FIX 10) — true = passed/not-applicable.
  consistency: Record<string, boolean>;
};

export type RuntimeOptions = {
  ultraDebug?: boolean;
  dryRun?: boolean;
  queryCap?: number;
  maxArticlesPerQuery?: number;
  cleanupAfter?: boolean;
  cleanupRaw?: boolean;
  debug?: boolean;
};

export type OrchestrationOptions = {
  companyId: string;
  runMode: RunMode;
  force: boolean;
  runSummaryId: string | null;
  pipelineRunId: string | null;
  allowGeneration: boolean;
  allowPublishing: boolean;
  runtime?: RuntimeOptions;
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

export function admin() {
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
}

// ── Stage map (server-owned). progress UI mirrors this. ─────────────────────
const STAGES = [
  { id: "fetch-fresh", label: "Fetching external intelligence (Currents)" },
  { id: "score-events", label: "Scoring relevance" },
  { id: "detect-changes", label: "Detecting material change" },
  { id: "build-connections", label: "Building company connections" },
  { id: "generate-risks", label: "Generating risks" },
  { id: "generate-opportunities", label: "Generating opportunities" },
  { id: "quality-gate", label: "Running quality gate" },
  { id: "generate-brief", label: "Rebuilding leadership brief" },
  { id: "finalize", label: "Finalizing & consistency check" },
];
const TOTAL_STAGES = STAGES.length;

async function invokeFunction(name: string, body: unknown): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SERVICE_KEY}`,
        apiKey: SERVICE_KEY,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) return { ok: false, error: `${name} -> HTTP ${res.status}` };
    const data = await res.json().catch(() => ({}));
    if (data && typeof data === "object" && "error" in data && (data as any).error) {
      return { ok: false, error: `${name} -> ${(data as any).error}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `${name} -> ${e instanceof Error ? e.message : String(e)}` };
  }
}

async function countRows(db: any, table: string, filter?: (q: any) => any): Promise<number> {
  let q = db.from(table).select("*", { count: "exact", head: true });
  if (filter) q = filter(q);
  const { count, error } = await q;
  if (error) return 0;
  return count ?? 0;
}

// ── Progress + event persistence (server heartbeat lives here) ──────────────
// Writes the live stage + heartbeat + accumulated counters to the run summary
// and appends a run-event. The DB (not the browser) is the source of truth.
async function writeStage(
  db: any,
  opts: OrchestrationOptions,
  stageIndex: number,
  counters: Partial<RunCounts>,
  message: string,
  level: "info" | "warning" | "error" = "info",
) {
  const stage = STAGES[stageIndex] ?? STAGES[STAGES.length - 1];
  const idx = stageIndex + 1;
  const pct = Math.round((idx / TOTAL_STAGES) * 100);
  if (opts.runSummaryId) {
    await db.from("intelligence_run_summaries").update({
      status: "running",
      current_stage: stage.id,
      current_stage_label: stage.label,
      current_stage_index: idx,
      total_stages: TOTAL_STAGES,
      progress_pct: pct,
      heartbeat_at: new Date().toISOString(),
      ...sanitizeCounters(counters),
    }).eq("id", opts.runSummaryId);

    await db.from("intelligence_run_events").insert({
      run_id: opts.pipelineRunId,
      summary_id: opts.runSummaryId,
      company_id: opts.companyId,
      stage: stage.id,
      level,
      message,
      counters: counters ?? {},
    });
  }
  // Secondary, debug-only console log (no secrets).
  console.info("[intelligence-run]", {
    runId: opts.pipelineRunId,
    companyId: opts.companyId,
    stage: stage.id,
    index: idx,
    total: TOTAL_STAGES,
    counters,
  });
}

// Heartbeat-only update (used mid-stage during the long fetch loop so a run with
// many queries never ages out past the 5-minute liveness window).
async function beat(db: any, summaryId: string | null, counters?: Partial<RunCounts>) {
  if (!summaryId) return;
  await db.from("intelligence_run_summaries").update({
    heartbeat_at: new Date().toISOString(),
    ...(counters ? sanitizeCounters(counters) : {}),
  }).eq("id", summaryId);
}

// Only persist known numeric/boolean counter columns (avoid writing helper keys).
const COUNTER_KEYS = new Set<string>([
  "sources_checked", "observations_ingested", "verified_shocks_created",
  "candidates_generated", "candidates_published", "candidates_review",
  "candidates_quarantined", "actions_created", "exposure_paths_created",
  "forecasts_created", "briefs_created", "raw_queries_generated",
  "deduped_queries", "capped_queries", "queries_executed", "articles_fetched",
  "articles_normalized", "articles_inserted", "article_duplicates",
  "articles_rejected", "company_evaluations_created", "watch_items_created",
]);
function sanitizeCounters(c: Partial<RunCounts>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(c ?? {})) {
    if (COUNTER_KEYS.has(k) && typeof v === "number" && Number.isFinite(v)) out[k] = v;
  }
  return out;
}

// Meaningful-change detection: compare the two latest observations per metric.
export async function detectChanges(
  db: any,
  companyId: string,
  runSummaryId: string | null,
): Promise<{ material: boolean; events: number }> {
  const { data: obs } = await db
    .from("external_metric_observations")
    .select("metric_key, value, observed_at, period_end")
    .order("observed_at", { ascending: false })
    .limit(400);
  if (!obs || obs.length === 0) return { material: false, events: 0 };

  const byMetric = new Map<string, any[]>();
  for (const o of obs as any[]) {
    const k = o.metric_key ?? "unknown";
    if (!byMetric.has(k)) byMetric.set(k, []);
    byMetric.get(k)!.push(o);
  }

  let material = false;
  let events = 0;
  for (const [metric, list] of byMetric) {
    if (list.length < 2) continue;
    const cur = Number(list[0].value);
    const prev = Number(list[1].value);
    if (!Number.isFinite(cur) || !Number.isFinite(prev)) continue;
    const abs = cur - prev;
    const pct = prev !== 0 ? (abs / Math.abs(prev)) * 100 : null;
    const isTariff = /tariff|duty|trade/i.test(metric);
    const matFlag = isTariff ? Math.abs(abs) >= 1 : pct !== null && Math.abs(pct) >= 0.5;
    const materiality = matFlag ? (isTariff ? "high" : "medium") : "none";
    if (matFlag) material = true;
    await db.from("intelligence_change_events").insert({
      company_id: companyId,
      run_summary_id: runSummaryId,
      source_domain: isTariff ? "tariff" : "external_metric",
      metric_key: metric,
      previous_value: prev,
      current_value: cur,
      absolute_change: abs,
      percent_change: pct,
      change_type: "metric_delta",
      materiality,
      should_trigger_generation: matFlag,
    });
    events++;
  }
  return { material, events };
}

export const DEMO_COMPANY_ID = "d56259ad-c9f0-42c1-a241-167bdab6a7c6";

// Deletes ONLY rows generated by this ultra-debug run (this company, created at
// or after the run started). Never touches onboarding, calibration, demo data,
// or (by default) the raw article cache. Each delete is best-effort.
export async function cleanupRunArtifacts(
  db: any,
  opts: { runSummaryId: string | null; pipelineRunId: string | null },
  companyId: string,
  sinceIso: string,
  cleanupRaw: boolean,
  warnings: string[],
) {
  if (companyId === DEMO_COMPANY_ID) {
    warnings.push("cleanup skipped: refusing to delete demo data");
    return;
  }
  const tables = [
    "issue_forecasts", "risk_actions", "exposure_paths", "issue_quality_gate_results",
    "opportunity_register", "risk_register",
    ...(cleanupRaw ? ["raw_events"] : []),
  ];
  const deleted: Record<string, number> = {};
  for (const table of tables) {
    try {
      const { data, error } = await db
        .from(table)
        .delete()
        .eq("company_id", companyId)
        .gte("created_at", sinceIso)
        .select("id");
      if (error) { warnings.push(`cleanup ${table}: ${error.message}`); continue; }
      deleted[table] = (data?.length as number) ?? 0;
    } catch (e) {
      warnings.push(`cleanup ${table}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (opts.runSummaryId) {
    await db.from("intelligence_run_events").insert({
      run_id: opts.pipelineRunId, summary_id: opts.runSummaryId, company_id: companyId,
      stage: "cleanup", level: "info",
      message: `Ultra-debug cleanup removed: ${Object.entries(deleted).map(([t, n]) => `${t}=${n}`).join(", ") || "nothing"}.`,
      counters: deleted,
    });
  }
  console.info("[UltraDebug server] cleanup", { runId: opts.pipelineRunId, companyId, deleted });
}

export async function runOrchestration(opts: OrchestrationOptions): Promise<RunCounts> {
  const db = admin();
  const { companyId, runMode, force } = opts;
  const rt = opts.runtime ?? {};
  const dryRun = !!rt.dryRun;
  const warnings: string[] = [];
  const runStartIso = new Date().toISOString();

  // Accumulator written to the DB progressively so the UI shows live counters.
  const counters: Partial<RunCounts> = {
    sources_checked: 0, observations_ingested: 0, verified_shocks_created: 0,
    candidates_generated: 0, candidates_published: 0, candidates_review: 0,
    candidates_quarantined: 0, actions_created: 0, exposure_paths_created: 0,
    forecasts_created: 0, briefs_created: 0, raw_queries_generated: 0,
    deduped_queries: 0, capped_queries: 0, queries_executed: 0,
    articles_fetched: 0, articles_normalized: 0, articles_inserted: 0,
    article_duplicates: 0, articles_rejected: 0, company_evaluations_created: 0,
    watch_items_created: 0,
  };

  // Snapshot counts before.
  const before = {
    risks: await countRows(db, "risk_register", (q) => q.eq("company_id", companyId)),
    shocks: await countRows(db, "verified_shocks", (q) => q.eq("company_id", companyId)),
    actions: await countRows(db, "risk_actions"),
    paths: await countRows(db, "exposure_paths", (q) => q.eq("company_id", companyId)).catch(() => 0),
  };
  counters.sources_checked = await countRows(db, "external_sources");
  const obsBefore = await countRows(db, "external_metric_observations", (q) => q.eq("company_id", companyId));

  const stage = async (name: string, body: unknown) => {
    const r = await invokeFunction(name, body);
    if (!r.ok && r.error) warnings.push(r.error);
    return r.ok;
  };

  // ── Stage 0: fresh-intelligence fetch (Currents path, server-side) ────────
  if (runMode === "full" || runMode === "source_scan") {
    await writeStage(db, opts, 0, counters, "Fetching external intelligence (Currents).");
    try {
      const fresh = await runFreshIntelligenceFetch(db, companyId, {
        supabaseUrl: SUPABASE_URL,
        serviceKey: SERVICE_KEY,
        queryCap: rt.queryCap,
        maxArticlesPerQuery: rt.maxArticlesPerQuery,
        dryRun,
        onProgress: async (p) => {
          counters.raw_queries_generated = p.counters.raw_queries_generated;
          counters.deduped_queries = p.counters.deduped_queries;
          counters.capped_queries = p.counters.capped_queries;
          counters.queries_executed = p.counters.queries_executed;
          counters.articles_fetched = p.counters.articles_fetched;
          counters.articles_normalized = p.counters.articles_normalized;
          counters.articles_inserted = p.counters.articles_inserted;
          counters.article_duplicates = p.counters.article_duplicates;
          counters.articles_rejected = p.counters.articles_rejected;
          // Mid-stage heartbeat: keeps liveness fresh across a long query loop.
          await beat(db, opts.runSummaryId, counters);
        },
      });
      counters.raw_queries_generated = fresh.raw_queries_generated;
      counters.deduped_queries = fresh.deduped_queries;
      counters.capped_queries = fresh.capped_queries;
      counters.queries_executed = fresh.queries_executed;
      counters.articles_fetched = fresh.articles_fetched;
      counters.articles_normalized = fresh.articles_normalized;
      counters.articles_inserted = fresh.articles_inserted;
      counters.article_duplicates = fresh.article_duplicates;
      counters.articles_rejected = fresh.articles_rejected;
      if (fresh.failed_calls > 0) warnings.push(`fetch-fresh -> ${fresh.failed_calls} failed source calls`);
    } catch (e) {
      warnings.push(`fetch-fresh -> ${e instanceof Error ? e.message : String(e)}`);
    }

    // ── Stage 1: score events ───────────────────────────────────────────────
    await writeStage(db, opts, 1, counters, `Scoring ${counters.articles_inserted} new articles.`);
    await stage("score-events", { companyId });
    counters.company_evaluations_created = await countRows(db, "company_event_evaluations", (q) => q.eq("company_id", companyId)).catch(() => 0);
  }

  // ── Stage 2: change detection (gates generation) ──────────────────────────
  await writeStage(db, opts, 2, counters, "Detecting material change.");
  const { material, events: changeEvents } = await detectChanges(db, companyId, opts.runSummaryId);
  const shouldGenerate =
    !dryRun && opts.allowGeneration && (force || material || runMode === "generate_only" || runMode === "full");

  if (shouldGenerate && (runMode === "full" || runMode === "generate_only")) {
    // ── Stage 3: build connections ──────────────────────────────────────────
    await writeStage(db, opts, 3, counters, "Building company connection graph.");
    await stage("build-company-connections", { companyId });

    // ── Stage 4: generate risks ─────────────────────────────────────────────
    await writeStage(db, opts, 4, counters, "Generating risks.");
    await stage("generate-dynamic-risks", { companyId });
    counters.candidates_generated = Math.max(0, (await countRows(db, "risk_register", (q) => q.eq("company_id", companyId))) - before.risks);
    await beat(db, opts.runSummaryId, counters);

    // ── Stage 5: generate opportunities ─────────────────────────────────────
    await writeStage(db, opts, 5, counters, "Generating opportunities.");
    await stage("generate-opportunities", { companyId });
  } else {
    await writeStage(db, opts, 4, counters, dryRun ? "Dry run — generation skipped." : force ? "Generation forced but skipped by run mode." : "No material change — generation skipped.");
  }

  // ── Stage 6: quality gate (read decisions) ────────────────────────────────
  await writeStage(db, opts, 6, counters, "Reading quality-gate decisions.");
  counters.candidates_published = await countRows(db, "issue_quality_gate_results", (q) => q.eq("decision", "published"));
  counters.candidates_review = await countRows(db, "issue_quality_gate_results", (q) => q.eq("decision", "candidate_review"));
  counters.candidates_quarantined = await countRows(db, "issue_quality_gate_results", (q) => q.eq("decision", "quarantine"));
  counters.watch_items_created = await countRows(db, "issue_quality_gate_results", (q) => q.in("decision", ["watch", "watchlist"]));

  // ── Stage 7: leadership brief ─────────────────────────────────────────────
  let briefRebuilt = false;
  if (runMode === "full" || runMode === "brief_only") {
    await writeStage(db, opts, 7, counters, "Rebuilding leadership brief.");
    briefRebuilt = await stage("generate-brief", { companyId });
    counters.briefs_created = briefRebuilt ? 1 : 0;
  }

  // ── Stage 8: finalize + consistency ───────────────────────────────────────
  const after = {
    risks: await countRows(db, "risk_register", (q) => q.eq("company_id", companyId)),
    shocks: await countRows(db, "verified_shocks", (q) => q.eq("company_id", companyId)),
    actions: await countRows(db, "risk_actions"),
    paths: await countRows(db, "exposure_paths", (q) => q.eq("company_id", companyId)).catch(() => 0),
  };
  const obsAfter = await countRows(db, "external_metric_observations", (q) => q.eq("company_id", companyId));

  counters.observations_ingested = Math.max(0, obsAfter - obsBefore);
  counters.verified_shocks_created = Math.max(0, after.shocks - before.shocks);
  counters.candidates_generated = Math.max(counters.candidates_generated ?? 0, Math.max(0, after.risks - before.risks));
  counters.actions_created = Math.max(0, after.actions - before.actions);
  counters.exposure_paths_created = Math.max(0, after.paths - before.paths);
  counters.forecasts_created = (await countRows(db, "issue_forecasts", (q) => q.eq("company_id", companyId).gte("created_at", runStartIso)).catch(() => 0)) || 0;

  // ── Named consistency checks (FIX 10) ─────────────────────────────────────
  const generated = counters.candidates_generated ?? 0;
  const published = counters.candidates_published ?? 0;
  const review = counters.candidates_review ?? 0;
  const quarantined = counters.candidates_quarantined ?? 0;
  const watch = counters.watch_items_created ?? 0;
  const accountedFor = published + review + quarantined + watch;
  const consistency: Record<string, boolean> = {
    // articles fetched should normalize (or be explained by all-rejected).
    articles_normalize: (counters.articles_fetched ?? 0) === 0 || (counters.articles_normalized ?? 0) > 0 || (counters.articles_rejected ?? 0) > 0,
    // candidate decisions must not exceed generated (remainder = blocked).
    candidate_reconcile: generated === 0 || accountedFor <= generated,
    // published issues should each get an action + exposure path + forecast.
    published_has_actions: published === 0 || (counters.actions_created ?? 0) >= published,
    published_has_paths: published === 0 || (counters.exposure_paths_created ?? 0) >= published,
    published_has_forecasts: published === 0 || (counters.forecasts_created ?? 0) >= published,
  };
  const failedChecks = Object.entries(consistency).filter(([, ok]) => !ok).map(([k]) => k);
  const consistent = failedChecks.length === 0;
  // dry runs don't materialize, so materialization checks are informational only.
  if (!consistent && !dryRun) {
    warnings.push(`consistency failed: ${failedChecks.join(", ")} (generated ${generated}, decided ${accountedFor})`);
  }

  // ── Optional ultra-debug cleanup of generated test rows ───────────────────
  if (rt.cleanupAfter && rt.ultraDebug) {
    await cleanupRunArtifacts(db, opts, companyId, runStartIso, !!rt.cleanupRaw, warnings);
  }

  await writeStage(
    db, opts, 8, counters,
    `Run complete. ${counters.articles_inserted} articles · ${generated} candidates · ${published} published.`,
    warnings.length > 0 ? "warning" : "info",
  );

  return {
    sources_checked: counters.sources_checked ?? 0,
    observations_ingested: counters.observations_ingested ?? 0,
    verified_shocks_created: counters.verified_shocks_created ?? 0,
    candidates_generated: counters.candidates_generated ?? 0,
    candidates_published: counters.candidates_published ?? 0,
    candidates_review: counters.candidates_review ?? 0,
    candidates_quarantined: counters.candidates_quarantined ?? 0,
    actions_created: counters.actions_created ?? 0,
    exposure_paths_created: counters.exposure_paths_created ?? 0,
    forecasts_created: counters.forecasts_created ?? 0,
    briefs_created: counters.briefs_created ?? 0,
    raw_queries_generated: counters.raw_queries_generated ?? 0,
    deduped_queries: counters.deduped_queries ?? 0,
    capped_queries: counters.capped_queries ?? 0,
    queries_executed: counters.queries_executed ?? 0,
    articles_fetched: counters.articles_fetched ?? 0,
    articles_normalized: counters.articles_normalized ?? 0,
    articles_inserted: counters.articles_inserted ?? 0,
    article_duplicates: counters.article_duplicates ?? 0,
    articles_rejected: counters.articles_rejected ?? 0,
    company_evaluations_created: counters.company_evaluations_created ?? 0,
    watch_items_created: counters.watch_items_created ?? 0,
    exposure_graph_rebuilt: false,
    executive_brief_rebuilt: briefRebuilt,
    warnings,
    material_change: material || changeEvents > 0,
    consistent,
    consistency,
  };
}
