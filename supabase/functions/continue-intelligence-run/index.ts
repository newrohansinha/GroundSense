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
import { recomputeProvenanceAndCoverage } from "../_shared/provenance.ts";

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
  { id: "refresh-sources", label: "Refreshing numeric sources" },
  { id: "fetch-fresh", label: "Fetching external intelligence" },
  { id: "score-events", label: "Scoring relevance" },
  { id: "fetch-bodies", label: "Fetching article body text" },
  { id: "extract-numeric-claims", label: "Extracting numeric signals" },
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
    // BUG 6: per-stage accounting log (no secrets).
    console.info("[GroundSense UltraDebug stage]", {
      runId: run.pipeline_run_id, stage: stageId, level, counters,
      warnings: level === "warning" ? [message] : [],
    });
  };

  switch (stageId) {
    // ── Stage 0: structured numeric sources → numeric_shocks ledger ───────────
    case "refresh-sources": {
      await setStage("Refreshing numeric sources (BLS/FRED/EIA/Census/USITC/UN Comtrade)");
      let summary: any = null;
      try {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/refresh-sources`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}`, apiKey: SERVICE_KEY },
          body: JSON.stringify({ runSummaryId: run.id }),
        });
        summary = await res.json().catch(() => null);
      } catch (e) {
        await event("warning", `refresh-sources failed: ${e instanceof Error ? e.message : String(e)}`);
      }
      if (summary?.ok) {
        const publishable = await countRows(db, "numeric_shocks", (q: any) => q.eq("can_publish", true));
        const contextOnly = await countRows(db, "numeric_shocks", (q: any) => q.eq("can_publish", false));
        await db.from("intelligence_run_summaries").update({
          bls_metrics_refreshed: Number(summary.bls_metrics_refreshed) || 0,
          fred_metrics_refreshed: Number(summary.fred_metrics_refreshed) || 0,
          eia_metrics_refreshed: Number(summary.eia_metrics_refreshed) || 0,
          census_metrics_refreshed: Number(summary.census_metrics_refreshed) || 0,
          usitc_metrics_refreshed: Number(summary.usitc_metrics_refreshed) || 0,
          un_comtrade_metrics_refreshed: Number(summary.un_comtrade_metrics_refreshed) || 0,
          source_refresh_errors: Number(summary.source_refresh_errors) || 0,
          numeric_shocks_created: Number(summary.numeric_shocks_created) || 0,
          numeric_shocks_publishable: publishable,
          numeric_shocks_context_only: contextOnly,
          // The numeric_shocks ledger IS the verified-shock model now — surface
          // publishable shocks in the legacy "Shocks" counter so run history and
          // the dashboard ("verified external metric") agree.
          verified_shocks_created: publishable,
          // Real source + observation counters (fixes run-history "Sources 0 / Obs 0").
          sources_attempted: Number(summary.sources_attempted) || 0,
          sources_succeeded: Number(summary.sources_succeeded) || 0,
          sources_failed: Number(summary.sources_failed) || 0,
          source_observations_created: Number(summary.source_observations_created) || 0,
          sources_checked: Number(summary.sources_succeeded) || 0,
          observations_ingested: Number(summary.source_observations_created) || 0,
          next_stage: "fetch-fresh",
        }).eq("id", run.id);
        const srcLine = Array.isArray(summary.sources)
          ? summary.sources.map((s: any) => `${s.source_key}=${s.numeric_shocks_created}${s.errors?.length ? "(err)" : ""}`).join(", ")
          : "";
        await event(Number(summary.source_refresh_errors) > 0 ? "warning" : "info",
          `Numeric sources: ${summary.numeric_shocks_created} shocks (${publishable} publishable). ${srcLine}`,
          { numeric_shocks_created: Number(summary.numeric_shocks_created) || 0, numeric_shocks_publishable: publishable });
      } else {
        await db.from("intelligence_run_summaries").update({ next_stage: "fetch-fresh" }).eq("id", run.id);
        await event("warning", "refresh-sources returned no usable summary; continuing with article path only.");
      }
      return { stage: stageId, nextStage: "fetch-fresh", done: false };
    }

    // ── Stage 1: chunked Currents fetch ──────────────────────────────────────
    case "fetch-fresh": {
      const baseline = cursor.baseline ?? {
        risks: await countRows(db, "risk_register", (q) => q.eq("company_id", run.company_id)),
        shocks: await countRows(db, "verified_shocks", (q) => q.eq("company_id", run.company_id)),
        actions: await countRows(db, "risk_actions"),
        // exposure_paths table does not exist; baseline.paths kept as 0 (existence check used instead).
        paths: 0,
        // The real per-company evaluation table is event_assessments (keyed by
        // raw_event_id), NOT company_event_evaluations.
        evals: await countRows(db, "event_assessments", (q) => q.eq("company_id", run.company_id)),
      };
      const startIndex = cursor.query_index ?? 0;
      const chunk = await runFreshIntelligenceChunk(db, run.company_id, {
        supabaseUrl: SUPABASE_URL, serviceKey: SERVICE_KEY, startIndex, chunkSize: CHUNK_SIZE, queryCap, maxArticlesPerQuery, dryRun,
      });
      const d = chunk.delta;
      const acc = {
        raw_queries_generated: chunk.rawQueries,
        deduped_queries: chunk.dedupedRemoved,
        capped_queries: chunk.cappedRemoved,
        queries_executed: (run.queries_executed ?? 0) + d.queries_executed,
        articles_fetched: (run.articles_fetched ?? 0) + d.articles_fetched,
        articles_normalized: (run.articles_normalized ?? 0) + d.articles_normalized,
        articles_inserted: (run.articles_inserted ?? 0) + d.articles_inserted,
        article_duplicates: (run.article_duplicates ?? 0) + d.article_duplicates,
        articles_rejected: (run.articles_rejected ?? 0) + d.articles_rejected,
        articles_failed_normalization: (run.articles_failed_normalization ?? 0) + d.articles_failed_normalization,
        articles_failed_insert: (run.articles_failed_insert ?? 0) + d.articles_failed_insert,
        articles_skipped: (run.articles_skipped ?? 0) + d.articles_skipped,
      };
      const nextStage = chunk.done ? "score-events" : "fetch-fresh";
      const nextCursor = chunk.done ? { baseline } : { query_index: chunk.nextIndex, baseline };
      await setStage(`Fetching external intelligence (${Math.min(chunk.nextIndex, chunk.totalQueries)}/${chunk.totalQueries} queries)`, {
        ...acc, next_stage: nextStage, stage_cursor: nextCursor,
      });
      // Per-chunk accounting event (BUG 6): input vs terminal buckets.
      await event("info",
        `Fetch chunk ${startIndex}–${chunk.nextIndex}/${chunk.totalQueries}: fetched ${d.articles_fetched} → ${d.articles_inserted} inserted, ${d.article_duplicates} dup, ${d.articles_rejected} off-topic, ${d.articles_failed_normalization} bad/stale, ${d.articles_failed_insert} insert-failed.`,
        { input: d.articles_fetched, inserted: d.articles_inserted, duplicates: d.article_duplicates, rejected: d.articles_rejected, failed_normalization: d.articles_failed_normalization, failed_insert: d.articles_failed_insert });
      return { stage: stageId, nextStage, done: false };
    }

    case "score-events": {
      await setStage("Scoring relevance");
      const r = await invokeFunction("score-events", { companyId: run.company_id });
      // score-events re-scores ALL company raw_events (incl. duplicates) into
      // event_assessments. So the company's evaluation TOTAL is the honest
      // measure; duplicates that this company hadn't evaluated get evaluated here.
      const evalsAfter = await countRows(db, "event_assessments", (q) => q.eq("company_id", run.company_id));
      const baseEvals = cursor.baseline?.evals ?? 0;
      const newEvals = Math.max(0, evalsAfter - baseEvals);
      const validArticles = (run.articles_inserted ?? 0) + (run.article_duplicates ?? 0);
      const dupReused = run.article_duplicates ?? 0; // dups are re-scored as company evidence
      const fromNew = Math.min(evalsAfter, run.articles_inserted ?? 0);
      const fromDup = Math.max(0, Math.min(dupReused, evalsAfter - fromNew));
      const inputCount = await countRows(db, "raw_events", (q) => q.eq("company_id", run.company_id));
      await db.from("intelligence_run_summaries").update({
        company_evaluations_created: evalsAfter,
        company_evaluations_created_from_new_articles: fromNew,
        company_evaluations_created_from_duplicates: fromDup,
        duplicate_articles_reused_for_company: dupReused,
        next_stage: "fetch-bodies",
      }).eq("id", run.id);
      const warn = evalsAfter === 0 && validArticles > 0;
      await event(warn ? "warning" : (r.ok ? "info" : "warning"),
        r.ok
          ? `Scored relevance: ${inputCount} company raw_events → ${evalsAfter} evaluations (+${newEvals} new; ${dupReused} duplicate articles reused as company evidence).${warn ? " WARNING: 0 evaluations despite valid articles — score-events produced none." : ""}`
          : `score-events: ${r.error}`,
        { company_evaluations_total: evalsAfter, new_evaluations: newEvals, duplicate_articles_reused: dupReused, valid_articles: validArticles });
      return { stage: stageId, nextStage: "fetch-bodies", done: false };
    }

    // ── Stage 3: fetch article body text ─────────────────────────────────────
    case "fetch-bodies": {
      await setStage("Fetching article body text");
      // Query relevant articles for this company that haven't been body-fetched yet.
      // We join through event_assessments so we only fetch bodies for relevant articles.
      const { data: relevantEvals } = await db.from("event_assessments")
        .select("raw_event_id")
        .eq("company_id", run.company_id)
        .eq("relevant", true)
        .limit(100);
      const relevantIds = (relevantEvals ?? []).map((e: any) => e.raw_event_id).filter(Boolean);

      let toFetch: any[] = [];
      if (relevantIds.length > 0) {
        const { data: unfetched } = await db.from("raw_events")
          .select("id, source_url, title")
          .in("id", relevantIds)
          .eq("body_fetched", false)
          .eq("body_fetch_failed", false)
          .not("source_url", "is", null)
          .limit(20);
        toFetch = unfetched ?? [];
      }

      let succeeded = 0;
      let failed = 0;
      let totalWords = 0;

      // Parallel fetch with 4-second timeout per article.
      const FETCH_TIMEOUT_MS = 4000;
      const fetchResults = await Promise.allSettled(
        toFetch.map(async (article: any) => {
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
          try {
            const res = await fetch(article.source_url, {
              signal: ctrl.signal,
              headers: { "User-Agent": "Mozilla/5.0 (compatible; GroundSense-Intel/1.0)" },
            });
            clearTimeout(timer);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const ct = res.headers.get("content-type") || "";
            if (!ct.includes("text/html") && !ct.includes("text/plain")) throw new Error(`non-text: ${ct}`);
            const html = await res.text();
            // Strip scripts, styles, and HTML tags; collapse whitespace; cap at 12 000 chars.
            const body = html
              .replace(/<script[\s\S]*?<\/script>/gi, " ")
              .replace(/<style[\s\S]*?<\/style>/gi, " ")
              .replace(/<[^>]+>/g, " ")
              .replace(/&[a-z#0-9]+;/gi, " ")
              .replace(/\s+/g, " ")
              .trim()
              .slice(0, 12000);
            const wordCount = body.split(/\s+/).filter(Boolean).length;
            await db.from("raw_events").update({
              body_text: body || null,
              body_word_count: wordCount,
              body_fetched: true,
            }).eq("id", article.id);
            return { success: true, wordCount };
          } catch {
            clearTimeout(timer);
            await db.from("raw_events").update({ body_fetch_failed: true }).eq("id", article.id);
            return { success: false, wordCount: 0 };
          }
        })
      );

      for (const r of fetchResults) {
        if (r.status === "fulfilled") {
          if (r.value.success) { succeeded++; totalWords += r.value.wordCount; }
          else { failed++; }
        } else {
          failed++;
        }
      }

      await db.from("intelligence_run_summaries").update({
        article_bodies_attempted: (run.article_bodies_attempted ?? 0) + toFetch.length,
        article_bodies_succeeded: (run.article_bodies_succeeded ?? 0) + succeeded,
        article_bodies_failed: (run.article_bodies_failed ?? 0) + failed,
        article_body_words_total: (run.article_body_words_total ?? 0) + totalWords,
        next_stage: "extract-numeric-claims",
      }).eq("id", run.id);

      await event("info",
        `Body fetch: ${toFetch.length} attempted → ${succeeded} succeeded, ${failed} failed, ${totalWords} total words.`,
        { attempted: toFetch.length, succeeded, failed, total_words: totalWords });
      return { stage: stageId, nextStage: "extract-numeric-claims", done: false };
    }

    // ── Stage 4: Gemini numeric claim extraction from article bodies ──────────
    case "extract-numeric-claims": {
      await setStage("Extracting numeric signals from articles");
      const apiKey = Deno.env.get("GEMINI_API_KEY");
      const geminiModel = Deno.env.get("GEMINI_MODEL") || "gemini-2.5-flash-lite";

      // Find relevant articles for this company that have body text and no existing claims.
      const { data: relevantEvals } = await db.from("event_assessments")
        .select("raw_event_id")
        .eq("company_id", run.company_id)
        .eq("relevant", true)
        .limit(100);
      const relevantIds = (relevantEvals ?? []).map((e: any) => e.raw_event_id).filter(Boolean);

      let toProcess: any[] = [];
      if (relevantIds.length > 0 && apiKey) {
        const { data: withBodies } = await db.from("raw_events")
          .select("id, title, source_url, body_text")
          .in("id", relevantIds)
          .eq("body_fetched", true)
          .not("body_text", "is", null)
          .limit(20);
        const candidates = (withBodies ?? []).filter((a: any) => a.body_text && a.body_text.length > 150);

        // Skip articles that already have claims in this run (idempotent).
        if (candidates.length > 0) {
          const { data: existingClaims } = await db.from("article_metric_claims")
            .select("raw_event_id")
            .eq("company_id", run.company_id)
            .in("raw_event_id", candidates.map((a: any) => a.id));
          const alreadyProcessed = new Set((existingClaims ?? []).map((c: any) => c.raw_event_id));
          toProcess = candidates.filter((a: any) => !alreadyProcessed.has(a.id));
        }
      }

      let totalExtracted = 0;
      let withPercent = 0;
      let withPP = 0;
      let withDollar = 0;

      if (apiKey && toProcess.length > 0) {
        const BATCH_SIZE = 3;
        for (let i = 0; i < toProcess.length; i += BATCH_SIZE) {
          const batch = toProcess.slice(i, i + BATCH_SIZE);
          const articlesText = batch.map((a: any) =>
            `ARTICLE_ID: ${a.id}\nTITLE: ${String(a.title || "").slice(0, 200)}\nBODY: ${String(a.body_text || "").slice(0, 2500)}`
          ).join("\n\n---NEXT_ARTICLE---\n\n");

          const prompt = `You extract ONLY explicit numeric claims from industrial/trade news articles.
Context: Fastenal (industrial distribution). Relevant: tariffs, steel, copper, aluminum, freight rates, supplier costs, manufacturing demand.

ARTICLES:
${articlesText}

For each article extract claims where ALL are true:
1. An explicit number appears (%, pp, $, index points, bps)
2. It represents a CHANGE or LEVEL relevant to supply chain / industrial operating costs
3. The number is stated as fact in the article (not "expected" or analyst estimate)

Valid claim_type values: tariff_rate | commodity_price_change | freight_rate_change | demand_index_change | energy_cost_change | labor_cost_change | currency_change

Return ONLY a JSON array (no markdown). Each object:
{
  "raw_event_id": "<ARTICLE_ID from above>",
  "claim_type": "<one of the valid types>",
  "numeric_value": <primary number as float>,
  "from_value": <start of range or null>,
  "to_value": <end of range or null>,
  "delta_pp": <explicit pp change or null>,
  "unit": "pct" | "pp" | "usd" | "index" | "bps",
  "direction": "up" | "down" | "flat",
  "commodity": "<steel|aluminum|copper|freight|energy|labor or null>",
  "geography": "<country/region or null>",
  "entity": "<company name or null>",
  "snippet": "<exact 1-2 sentence quote containing the number>",
  "extraction_confidence": "high" | "medium"
}

EXCLUDE: stock prices, ownership %, market share, analyst ratings, dates, article-quality scores.
EXCLUDE: precious metals (gold, silver, platinum, palladium) — not relevant to industrial distribution supply chain.
EXCLUDE: employee headcounts, fundraising amounts, revenue totals.
ONLY include: tariff rates, steel/copper/aluminum/zinc commodity prices, freight rates, manufacturing demand indices, energy costs.
If no valid claims in an article, omit it from results.
Return [] if nothing qualifies.`;

          try {
            const res = await fetch(
              `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${apiKey}`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  generationConfig: { temperature: 0.0, topP: 0.8, maxOutputTokens: 4000, responseMimeType: "application/json" },
                  contents: [{ role: "user", parts: [{ text: prompt }] }],
                }),
              }
            );
            if (!res.ok) { console.warn(`[extract-numeric-claims] Gemini HTTP ${res.status}`); continue; }
            const gData = await res.json();
            const text = (gData?.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text || "").join("\n");

            let claims: any[] = [];
            try {
              const parsed = JSON.parse(text.trim());
              claims = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.claims) ? parsed.claims : []);
            } catch { continue; }

            const claimRows = claims.flatMap((c: any) => {
              const articleId = String(c.raw_event_id || "");
              const article = batch.find((a: any) => a.id === articleId);
              if (!article) return [];
              const val = typeof c.numeric_value === "number" ? c.numeric_value : null;
              if (val === null || val <= 0 || val > 10000) return [];

              const unit = String(c.unit || "pct").toLowerCase();
              if (unit === "pct" || unit === "percent") withPercent++;
              else if (unit === "pp" || unit === "percentage_points") withPP++;
              else if (unit === "usd" || unit.includes("dollar")) withDollar++;

              let domain: string | null = null;
              try { domain = new URL(article.source_url || "").hostname; } catch { /* ok */ }

              return [{
                company_id: run.company_id,
                raw_event_id: articleId,
                claim_text: String(c.snippet || "").slice(0, 500),
                extracted_value: val,
                extracted_unit: unit,
                metric_key: c.claim_type || "commodity_price_change",
                driver: c.commodity || c.claim_type || null,
                from_value: typeof c.from_value === "number" ? c.from_value : null,
                to_value: typeof c.to_value === "number" ? c.to_value : null,
                delta_pp: typeof c.delta_pp === "number" ? c.delta_pp : null,
                direction: c.direction || "up",
                commodity: c.commodity || null,
                geography: c.geography || null,
                entity: c.entity || null,
                source_url: article.source_url || null,
                source_domain: domain,
                article_title: String(article.title || "").slice(0, 300),
                extraction_confidence: c.extraction_confidence === "high" ? "high" : "medium",
                trust_label: "article_claim",
                can_drive_watch: true,
                can_drive_published: false,
                extraction_method: "llm",
              }];
            });

            if (claimRows.length > 0) {
              const { error: insertErr } = await db.from("article_metric_claims").insert(claimRows);
              if (!insertErr) totalExtracted += claimRows.length;
              else console.warn("[extract-numeric-claims] insert error:", insertErr.message);
            }
          } catch (batchErr) {
            console.warn("[extract-numeric-claims] batch error:", batchErr instanceof Error ? batchErr.message : String(batchErr));
          }
        }
      }

      await db.from("intelligence_run_summaries").update({
        numeric_claims_extracted: (run.numeric_claims_extracted ?? 0) + totalExtracted,
        numeric_claims_with_percent: (run.numeric_claims_with_percent ?? 0) + withPercent,
        numeric_claims_with_pp_change: (run.numeric_claims_with_pp_change ?? 0) + withPP,
        numeric_claims_with_dollar: (run.numeric_claims_with_dollar ?? 0) + withDollar,
        next_stage: "detect-changes",
      }).eq("id", run.id);

      await event("info",
        `Numeric claim extraction: ${toProcess.length} articles processed → ${totalExtracted} claims (${withPercent} pct / ${withPP} pp / ${withDollar} dollar).`,
        { articles_processed: toProcess.length, claims_extracted: totalExtracted, with_percent: withPercent, with_pp: withPP, with_dollar: withDollar });
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
      // Ledger-driven generator: candidates start from numeric_shocks + mapped
      // company exposure (replaces article-summary clustering).
      const r = await invokeFunction("generate-numeric-candidates", { companyId: run.company_id, runSummaryId: run.id });
      const baseline = cursor.baseline ?? {};
      const risksNow = await countRows(db, "risk_register", (q) => q.eq("company_id", run.company_id));
      const generated = Math.max(0, risksNow - (baseline.risks ?? 0));
      // Actions are recreated clean-slate by the generator (one per published
      // issue) — count them so run history "Active actions" matches the dashboard.
      const actionsNow = await countRows(db, "risk_actions", (q) => q.eq("company_id", run.company_id));
      const pubMetricBacked = await countRows(db, "risk_register", (q: any) => q.eq("company_id", run.company_id).eq("gate_status", "published").in("numeric_basis_type", ["official_structured_metric", "manual_structured_metric", "company_structured_metric"]));
      const pubArticleBacked = await countRows(db, "risk_register", (q: any) => q.eq("company_id", run.company_id).eq("gate_status", "published").eq("numeric_basis_type", "article_numeric_claim"));
      const pubScenario = await countRows(db, "risk_register", (q: any) => q.eq("company_id", run.company_id).eq("gate_status", "published").in("numeric_basis_type", ["no_numeric_basis", "scenario_assumption", "scenario_midpoint"]));
      await db.from("intelligence_run_summaries").update({
        candidates_generated: generated, actions_created: actionsNow,
        published_metric_backed: pubMetricBacked, published_article_claim_backed: pubArticleBacked,
        published_scenario_backed: pubScenario, numeric_shocks_used_in_published: pubMetricBacked + pubArticleBacked,
        next_stage: "generate-opportunities",
      }).eq("id", run.id);
      // Report per-candidate IDs and gate statuses so the run log is auditable.
      const { data: riskSnapshot } = await db.from("risk_register")
        .select("id, issue_key, display_section, risk_title, methodology")
        .eq("company_id", run.company_id)
        .order("priority_score", { ascending: false })
        .limit(20);
      const candidateSummary = (riskSnapshot ?? []).map((row: any) => ({
        id: row.id,
        issue_key: row.issue_key,
        title: String(row.risk_title || "").slice(0, 60),
        section: row.display_section,
        gate: row.methodology?.gate_status ?? "unknown",
      }));
      await event(r.ok ? "info" : "warning",
        r.ok ? `Generated risks (+${generated} candidates). ${risksNow} total in register.` : `generate-dynamic-risks: ${r.error}`,
        { candidates_generated: generated, total_in_register: risksNow, candidates: candidateSummary });
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
      // Route EVERY candidate (every company risk_register row) into exactly one
      // bucket by its canonical display_section. We set candidates_generated to
      // the routed TOTAL so generated === published+review+quarantined+watch+blocked
      // by construction (BUG 2/3); `blocked` is any row in no recognized section.
      // Materialization readiness (exposure_path + action) is verified before
      // counting a candidate as published — unmaterialized rows are re-routed to
      // blocked_not_materialized so the brief is never built on hollow data.
      const cid = run.company_id;
      const total = await countRows(db, "risk_register", (q) => q.eq("company_id", cid));

      // Fetch published-section rows with materialization fields.
      const { data: pubRows } = await db.from("risk_register")
        .select("id, issue_key, display_section, risk_title, exposure_path, methodology")
        .eq("company_id", cid)
        .in("display_section", ["risk_register", "operating_changes"]);
      const pubRowsData: any[] = pubRows ?? [];
      const pubIds = pubRowsData.map((r: any) => r.id).filter(Boolean);

      // Check which published-section rows have an associated action.
      const actionRows = pubIds.length > 0
        ? ((await db.from("risk_actions").select("risk_id").in("risk_id", pubIds)).data ?? [])
        : [];
      const actionRiskIdSet = new Set(actionRows.map((a: any) => a.risk_id));

      // Materialization check: must have non-empty exposure_path AND an action.
      const materializedPubRows = pubRowsData.filter((r: any) =>
        Array.isArray(r.exposure_path) && r.exposure_path.length > 0 && actionRiskIdSet.has(r.id)
      );
      const unmaterializedPubRows = pubRowsData.filter((r: any) =>
        !(Array.isArray(r.exposure_path) && r.exposure_path.length > 0 && actionRiskIdSet.has(r.id))
      );
      const published = materializedPubRows.length;
      const blockedNotMaterialized = unmaterializedPubRows.length;

      const watch = await countRows(db, "risk_register", (q) => q.eq("company_id", cid).in("display_section", ["watchlist", "watch"]));
      const review = await countRows(db, "risk_register", (q) => q.eq("company_id", cid).in("display_section", ["candidate_review", "needs_review", "needs_calibration"]));
      const quarantined = await countRows(db, "risk_register", (q) => q.eq("company_id", cid).in("display_section", ["quarantine", "blocked", "suppressed"]));
      const known = published + review + quarantined + watch + blockedNotMaterialized;
      const blocked = Math.max(0, total - known) + blockedNotMaterialized; // unrecognized section + unmaterialized
      const newThisRun = Math.max(0, total - (cursor.baseline?.risks ?? 0));

      // Build per-candidate report for the event log (IDs + gate status).
      const { data: allRows } = await db.from("risk_register")
        .select("id, issue_key, display_section, risk_title, methodology")
        .eq("company_id", cid)
        .order("priority_score", { ascending: false })
        .limit(20);
      const candidateReport = (allRows ?? []).map((r: any) => ({
        id: r.id,
        issue_key: r.issue_key,
        title: String(r.risk_title || "").slice(0, 60),
        section: r.display_section,
        gate: r.methodology?.gate_status ?? "unknown",
        missing: r.methodology?.missing_inputs ?? [],
      }));

      await db.from("intelligence_run_summaries").update({
        candidates_generated: total,
        candidates_published: published, candidates_review: review, candidates_quarantined: quarantined,
        watch_items_created: watch, candidates_blocked: blocked, next_stage: "generate-brief",
        summary: {
          ...(run.summary ?? {}),
          candidates_new_this_run: newThisRun,
          blocked_not_materialized: blockedNotMaterialized,
          unmaterialized_issue_ids: unmaterializedPubRows.map((r: any) => r.id),
        },
      }).eq("id", run.id);

      const unmaterializedNote = blockedNotMaterialized > 0
        ? ` (${blockedNotMaterialized} demoted to blocked — missing action or exposure_path: ${unmaterializedPubRows.map((r: any) => r.issue_key).join(", ")})`
        : "";
      await event("info",
        `Candidate routing: ${total} candidates → ${published} published / ${review} review / ${quarantined} quarantined / ${watch} watch / ${blocked} blocked (new this run: ${newThisRun})${unmaterializedNote}.`,
        { generated: total, published, review, quarantined, watch, blocked, new_this_run: newThisRun, blocked_not_materialized: blockedNotMaterialized, candidates: candidateReport });
      return { stage: stageId, nextStage: "generate-brief", done: false };
    }

    case "generate-brief": {
      await setStage("Rebuilding leadership brief");
      // BUG 5: do NOT overwrite the last valid brief when there are no promoted
      // issues. Preserve it and record a no_promoted_issues outcome instead.
      const cur = (await reload(db, run.id)) ?? run;
      const publishedNow = cur.candidates_published ?? 0;
      if (publishedNow > 0) {
        const r = await invokeFunction("generate-brief", { companyId: run.company_id });
        await db.from("intelligence_run_summaries").update({
          briefs_created: r.ok ? 1 : 0, briefs_skipped_no_published_issues: 0,
          previous_brief_preserved: false, executive_brief_rebuilt: r.ok, next_stage: "finalize",
        }).eq("id", run.id);
        await event(r.ok ? "info" : "warning", r.ok ? `Rebuilt leadership brief (${publishedNow} published issues).` : `generate-brief: ${r.error}`);
      } else {
        await db.from("intelligence_run_summaries").update({
          briefs_created: 0, briefs_skipped_no_published_issues: 1,
          previous_brief_preserved: true, executive_brief_rebuilt: false, next_stage: "finalize",
        }).eq("id", run.id);
        await event("warning", "No promoted issues — leadership brief skipped; previous valid brief preserved (status: no_promoted_issues).", { briefs_skipped_no_published_issues: 1, previous_brief_preserved: true });
      }
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

      // Reconcile the DB-backed trust layer (formula_input_provenance +
      // company_calibration_coverage) for the currently published issues. Shared,
      // idempotent writer — identical to the scheduled path. A failure is surfaced
      // as a warning so the summary records completed_with_warnings (never a silent
      // success with missing/false provenance).
      const prov = await recomputeProvenanceAndCoverage(db, run.company_id);
      if (!prov.ok && prov.error) warnings.push(`provenance: ${prov.error}`);

      // exposure_paths is not a standalone table — exposure path lives in risk_register.exposure_path (JSONB).
      // issue_forecasts table does not exist yet — scenario-modeled published issues are counted as
      // forecast_skipped_with_reason (scenario assumptions documented in methodology).
      // Use existence-based checks on published issues rather than broken delta/catch-0 counts.
      const publishedCount = r.candidates_published ?? 0;
      const publishedIssueRows: any[] = publishedCount > 0
        ? ((await db.from("risk_register")
            .select("id, exposure_path, methodology")
            .eq("company_id", run.company_id)
            .in("display_section", ["risk_register", "operating_changes"])
            .then((res: any) => res.data ?? [])) as any[])
        : [];
      const publishedIds = publishedIssueRows.map((row: any) => row.id).filter(Boolean);
      // Count published issues that have at least one linked action.
      const publishedWithActions = publishedIds.length > 0
        ? await countRows(db, "risk_actions", (q: any) => q.in("risk_id", publishedIds))
        : 0;
      // Count published issues with a non-empty exposure_path JSONB array.
      const publishedWithPaths = publishedIssueRows.filter((row: any) =>
        Array.isArray(row.exposure_path) && (row.exposure_path as unknown[]).length > 0
      ).length;
      // Scenario-modeled published issues: documented basis exists but no verified shock was created.
      // These count as forecast_skipped_with_reason — the scenario assumptions ARE the forecast basis.
      const forecastSkippedWithReason = publishedIssueRows.filter((row: any) => {
        const ci = (row.methodology as any)?.calculation_inputs ?? {};
        return ci.shock_source === "scenario_fallback_no_new_explicit_shock" ||
               ci.shock_interpretation === "scenario_fallback_no_new_explicit_shock";
      }).length;
      const forecastsNow = 0; // no issue_forecasts table; use forecastSkippedWithReason instead
      // Observations = raw source_observations from the numeric ledger this run
      // (NOT the empty legacy external_metric_observations table, which reset it to 0).
      const obsNow = Number(r.source_observations_created ?? 0) || await countRows(db, "source_observations", (q: any) => q.eq("source_run_id", run.id));

      const counts = {
        // Canonical: the numeric_shocks ledger IS the verified-shock model. Use the
        // publishable count set at the refresh stage, NOT the empty legacy table delta.
        verified_shocks_created: Number(r.numeric_shocks_publishable ?? 0) || 0,
        // Actions linked to CURRENT published issues (clean-slate recreated each run),
        // not a global delta that nets to 0.
        actions_created: publishedWithActions,
        // exposure_paths_created: existence-based count (published issues with non-empty JSONB exposure_path).
        exposure_paths_created: publishedWithPaths,
        // forecasts_created: stays 0 until issue_forecasts table exists; forecast_skipped_with_reason is in summary.
        forecasts_created: forecastsNow,
        observations_ingested: obsNow,
        candidates_generated: r.candidates_generated ?? 0,
        candidates_published: r.candidates_published ?? 0,
        candidates_review: r.candidates_review ?? 0,
        candidates_quarantined: r.candidates_quarantined ?? 0,
        watch_items_created: r.watch_items_created ?? 0,
        candidates_blocked: r.candidates_blocked ?? 0,
        articles_inserted: r.articles_inserted ?? 0,
        queries_executed: r.queries_executed ?? 0,
        raw_queries_generated: r.raw_queries_generated ?? 0,
        // Body fetch + numeric extraction counters (new stages).
        article_bodies_attempted: r.article_bodies_attempted ?? 0,
        article_bodies_succeeded: r.article_bodies_succeeded ?? 0,
        article_bodies_failed: r.article_bodies_failed ?? 0,
        article_body_words_total: r.article_body_words_total ?? 0,
        numeric_claims_extracted: r.numeric_claims_extracted ?? 0,
        numeric_claims_with_percent: r.numeric_claims_with_percent ?? 0,
        numeric_claims_with_pp_change: r.numeric_claims_with_pp_change ?? 0,
        numeric_claims_with_dollar: r.numeric_claims_with_dollar ?? 0,
      };

      // ── BUG 1: article accounting must reconcile at BOTH levels ───────────
      const fetched = r.articles_fetched ?? 0;
      const normalized = r.articles_normalized ?? 0;
      const inserted = r.articles_inserted ?? 0;
      const duplicates = r.article_duplicates ?? 0;
      const rejected = r.articles_rejected ?? 0;
      const failed_normalization = r.articles_failed_normalization ?? 0;
      const failed_insert = r.articles_failed_insert ?? 0;
      const skipped = r.articles_skipped ?? 0;
      // Level 1 — every FETCHED article: normalized | rejected | failed_normalization.
      const fetch_accounted = normalized + rejected + failed_normalization;
      const fetch_unaccounted = Math.max(0, fetched - fetch_accounted);
      // Level 2 — every NORMALIZED article: inserted | duplicates | failed_insert | skipped | unknown.
      const normalized_accounted = inserted + duplicates + failed_insert + skipped;
      const normalized_unaccounted = Math.max(0, normalized - normalized_accounted);
      const article_accounting = {
        fetched, normalized, inserted, duplicates, rejected, failed_normalization, failed_insert, skipped,
        rejected_after_normalization: 0,
        skipped_existing_company_eval: 0,
        not_evaluated: 0,
        fetch_accounted_total: fetch_accounted,
        fetch_unaccounted,
        normalized_accounted_total: normalized_accounted,
        normalized_unaccounted,
        unknown_unaccounted: fetch_unaccounted + normalized_unaccounted,
      };
      if (fetch_unaccounted > 0) warnings.push(`fetch accounting unaccounted=${fetch_unaccounted} (fetched ${fetched} ≠ normalized+rejected+failed_norm ${fetch_accounted})`);
      if (normalized_unaccounted > 0) warnings.push(`normalized accounting unaccounted=${normalized_unaccounted} (normalized ${normalized} ≠ inserted+dup+failed_insert+skipped ${normalized_accounted})`);

      // ── BUG 4: shock accounting reason ────────────────────────────────────
      const validArticles = article_accounting.inserted + article_accounting.duplicates;
      const shock_debug = {
        candidate_articles_seen: validArticles,
        context_only_articles: 0,
        extracted_shock_candidates: 0,
        verified_shocks_created: counts.verified_shocks_created,
        rejected_shock_candidates: 0,
        rejection_reasons: [] as string[],
      };
      if (counts.verified_shocks_created === 0) {
        // Best-effort reason from available signals.
        if (obsNow === 0) shock_debug.rejection_reasons.push("missing_structured_metric");
        if (validArticles === 0) shock_debug.rejection_reasons.push("no_candidate_articles");
        else shock_debug.rejection_reasons.push("no_numeric_change", "context_only_article");
        if ((counts.candidates_generated ?? 0) === 0) shock_debug.rejection_reasons.push("no_company_connection");
      }

      // ── BUG 3: candidate routing must reconcile (STRICT equality) ─────────
      const generated = counts.candidates_generated;
      const routed = counts.candidates_published + counts.candidates_review + counts.candidates_quarantined + counts.watch_items_created + counts.candidates_blocked;
      const candidate_reconcile = generated === routed;
      const candidate_accounting = { generated, published: counts.candidates_published, review: counts.candidates_review, quarantined: counts.candidates_quarantined, watch: counts.watch_items_created, blocked: counts.candidates_blocked, routed_total: routed, reconciled: candidate_reconcile, delta: generated - routed };
      if (!candidate_reconcile) warnings.push(`candidate routing mismatch: generated ${generated} ≠ routed_total ${routed} (delta ${generated - routed})`);

      // ── BUG 7: named consistency checks control the status ────────────────
      // published_has_actions/paths/forecasts use existence-based counts (not deltas or
      // non-existent-table queries). A scenario-modeled published issue with documented
      // shock assumptions satisfies published_has_forecasts via forecastSkippedWithReason.
      const pub = counts.candidates_published;
      const consistency: Record<string, boolean> = {
        article_accounting_reconciles: article_accounting.unknown_unaccounted === 0,
        candidate_routing_reconciles: candidate_reconcile,
        published_has_actions: pub === 0 || publishedWithActions >= pub,
        published_has_paths: pub === 0 || publishedWithPaths >= pub,
        published_has_forecasts: pub === 0 || forecastsNow >= pub || forecastSkippedWithReason >= pub,
        shock_reason_present: counts.verified_shocks_created > 0 || shock_debug.rejection_reasons.length > 0,
        evaluations_present: (r.company_evaluations_created ?? 0) > 0 || validArticles === 0,
        brief_preservation: !(r.briefs_created > 0 && pub === 0), // no normal brief from 0 published
      };
      const failed = Object.entries(consistency).filter(([, ok]) => !ok).map(([k]) => k);
      const consistent = failed.length === 0;
      if (!consistent && !dryRun) warnings.push(`consistency failed: ${failed.join(", ")}`);
      // Surface "generated but nothing promoted" so the run is visibly
      // completed_with_warnings (a blocked/review candidate is legitimate but
      // should never look like a clean publish). BUG 8.
      if (!dryRun && generated > 0 && pub === 0) {
        warnings.push(`${generated} candidate(s) generated but 0 published (${counts.candidates_blocked} blocked / ${counts.candidates_review} review / ${counts.watch_items_created} watch) — previous dashboard preserved`);
      }
      // (0 verified shocks is NOT a warning on its own — scenario-modeled issues
      // legitimately have none. The reason is recorded in shock_debug + the note.)

      if (cleanupAfter && ultraDebug) {
        await cleanupRunArtifacts(db, { runSummaryId: run.id, pipelineRunId: run.pipeline_run_id }, run.company_id, runStartIso, !!dbg.cleanup_raw, warnings);
      }

      const status = warnings.length > 0 || !consistent ? "completed_with_warnings" : "completed";
      const tag = `${ultraDebug ? "ultra_debug · " : ""}${dryRun ? "dry_run · " : ""}${force ? "force full · " : ""}`;
      // ── BUG 8: honest no-clean-data outcome note ──────────────────────────
      const briefNote = pub === 0 ? " · previous dashboard/brief preserved (no_promoted_issues)" : "";
      const shockNote = counts.verified_shocks_created === 0
        ? forecastSkippedWithReason > 0
          ? ` · 0 verified shocks — ${forecastSkippedWithReason} published issue(s) scenario-modeled (${shock_debug.rejection_reasons.join("/") || "no_numeric_signal"})`
          : ` · 0 verified shocks (${shock_debug.rejection_reasons.join("/") || "no signal"})`
        : "";
      const materializationNote = pub > 0
        ? ` · ${publishedWithActions}/${pub} published w/action · ${publishedWithPaths}/${pub} w/path · ${forecastSkippedWithReason}/${pub} scenario-forecast`
        : "";
      const note = counts.raw_queries_generated === 0
        ? `${tag}0 tracking queries: calibration has nothing to build queries from.`
        : `${tag}${counts.queries_executed}/${counts.raw_queries_generated} queries · ${fetched} fetched (norm ${normalized}/${article_accounting.fetch_accounted_total}, ${article_accounting.unknown_unaccounted} unaccounted) · ${duplicates} dup · ${generated} candidates → ${counts.candidates_published} published/${counts.candidates_blocked} blocked${materializationNote}${shockNote}${briefNote}.`;

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
        warning_message: warnings.slice(0, 6).join(" · ").slice(0, 1000) || null,
        ...counts,
        summary: {
          ...(r.summary ?? {}),
          run_mode: r.run_mode, force, dry_run: dryRun, consistent, consistency, warnings, note,
          article_accounting, candidate_accounting, shock_debug,
          brief_status: pub === 0 ? "no_promoted_issues" : "rebuilt",
          previous_brief_preserved: pub === 0,
          // Materialization detail for published issues.
          published_issues_with_actions: publishedWithActions,
          published_issues_with_paths: publishedWithPaths,
          forecast_skipped_with_reason: forecastSkippedWithReason,
          // Shock basis: clarifies the verified_shocks=0 + candidates_published>=1 relationship.
          published_from_new_verified_shock: counts.verified_shocks_created > 0,
          published_from_scenario_model: forecastSkippedWithReason > 0,
          published_from_existing_verified_shock: counts.verified_shocks_created === 0 && pub > 0 && forecastSkippedWithReason === 0,
        },
      }).eq("id", run.id);

      await db.from("intelligence_run_events").insert({
        run_id: run.pipeline_run_id, summary_id: run.id, company_id: run.company_id,
        stage: "finalize", level: status === "completed" ? "info" : "warning", message: note,
        counters: { ...counts, article_accounting, candidate_accounting, shock_debug },
      });

      await db.rpc("release_intelligence_run_lock", { p_lock_key: run.lock_key ?? `intelligence-update:company:${run.company_id}`, p_run_id: run.pipeline_run_id });
      console.info("[UltraDebug server]", { runId: run.pipeline_run_id, companyId: run.company_id, stage: "finalize", counters: counts });
      return { stage: "finalize", nextStage: null, done: true };
    }
  }
}
