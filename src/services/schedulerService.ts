// Client-side scheduler status + manual-run observability.
//
// The scheduled run executes server-side (Edge Function + cron). The manual
// "Run Intelligence Update" button keeps using the existing client pipeline, but
// is wrapped here so it shares the SAME run lock and writes the SAME run-summary
// history as scheduled runs — consistent + observable, and the two can never
// overlap. Reads are safe (status/history only); no secrets are involved.

import { supabase } from "../lib/supabase";

export type RunSummary = {
  id: string;
  trigger_type: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  schedule_name: string | null;
  sources_checked: number;
  observations_ingested: number;
  verified_shocks_created: number;
  candidates_generated: number;
  candidates_published: number;
  candidates_review: number;
  candidates_quarantined: number;
  actions_created: number;
  exposure_graph_rebuilt: boolean;
  executive_brief_rebuilt: boolean;
  skipped_reason: string | null;
  error_message: string | null;
};

export type SchedulerConfig = {
  id: string;
  enabled: boolean;
  schedule_name: string;
  cadence: string;
  cron_expression: string;
  timezone: string;
  run_mode: string;
  source_scope: string;
};

export type RunProgress = {
  current_stage: string | null;
  current_stage_label: string | null;
  current_stage_index: number | null;
  total_stages: number | null;
  progress_pct: number | null;
  heartbeat_at: string | null;
};

// Per-stage counters persisted by the server runner. All optional so the type
// survives older rows that predate the columns.
export type RunCounters = {
  raw_queries_generated?: number;
  deduped_queries?: number;
  capped_queries?: number;
  queries_executed?: number;
  articles_fetched?: number;
  articles_normalized?: number;
  articles_inserted?: number;
  article_duplicates?: number;
  articles_rejected?: number;
  company_evaluations_created?: number;
  verified_shocks_created?: number;
  candidates_generated?: number;
  candidates_published?: number;
  candidates_review?: number;
  candidates_quarantined?: number;
  watch_items_created?: number;
  candidates_blocked?: number;
  actions_created?: number;
  exposure_paths_created?: number;
  forecasts_created?: number;
  briefs_created?: number;
  articles_failed_normalization?: number;
  articles_failed_insert?: number;
  articles_skipped?: number;
};

export type RunEvent = {
  id: string;
  stage: string;
  level: string;
  message: string;
  created_at: string;
};

// Everything the dashboard needs to render live progress straight from the DB —
// no in-memory promise, no browser-owned state.
export type RunProgressSnapshot = RunSummary &
  RunProgress &
  RunCounters & {
    pipeline_run_id: string | null;
    note: string | null;
    warning_message: string | null;
    run_mode: string | null;
    force: boolean | null;
    latestEvent: RunEvent | null;
  };

export type SchedulerStatus = {
  config: SchedulerConfig | null;
  lastRun: RunSummary | null;
  // The most recent run whose trigger_type is "scheduled" (the daily cron),
  // tracked separately from lastRun (which may be a manual run) so the card can
  // honestly report whether the AUTOMATED path is actually working. Carries the
  // staged-worker progress fields (current_stage_label, heartbeat_at) so the card
  // can show live stage + heartbeat for an in-flight scheduled run.
  lastScheduledRun: (RunSummary & Partial<RunProgress>) | null;
  // True iff at least one scheduled run has ever reached completed /
  // completed_with_warnings. Spans all history (not just recentRuns) so the card
  // can warn "schedule enabled but never succeeded" even when manual runs fill
  // the recent list.
  scheduledSuccessEver: boolean;
  recentRuns: RunSummary[];
  nextRunIso: string | null;
  // The currently-active run (status=running with a FRESH heartbeat). Null if no
  // run is genuinely in progress — a stuck/stale run is auto-expired first, so
  // this never leaves the Run button disabled forever.
  activeRun: (RunSummary & Partial<RunProgress>) | null;
};

const LOCK_TTL_SECONDS = 900;
// A running run with no heartbeat for this long is considered dead (browser
// closed / interrupted) and is expired so a new run can start.
const STALE_RUN_MINUTES = 5;

function lockKey(companyId: string | null): string {
  return `intelligence-update:company:${companyId ?? "default"}`;
}

// Marks the company's stale 'running' runs as expired and releases their locks.
// Safe to call on dashboard load and before starting a run.
export async function expireStaleRuns(companyId: string | null): Promise<void> {
  if (!companyId) return;
  await supabase.rpc("expire_stale_intelligence_runs", {
    p_company_id: companyId,
    p_stale_minutes: STALE_RUN_MINUTES,
  });
}

// Persists run progress so the UI can render the live stage from the DB after a
// tab switch or refresh (the DB, not console/component state, is the source).
export async function updateRunProgress(
  summaryId: string,
  p: { stage: string; label: string; index: number; total: number; counters?: Partial<RunSummary> }
): Promise<void> {
  await supabase
    .from("intelligence_run_summaries")
    .update({
      current_stage: p.stage,
      current_stage_label: p.label,
      current_stage_index: p.index,
      total_stages: p.total,
      progress_pct: p.total > 0 ? Math.round((p.index / p.total) * 100) : null,
      heartbeat_at: new Date().toISOString(),
      ...(p.counters ?? {}),
    })
    .eq("id", summaryId);
}

// Next daily 10:00 UTC occurrence for the default cron ('0 10 * * *').
function computeNextRun(cron: string | undefined): string | null {
  if (!cron) return null;
  const m = cron.match(/^(\d+)\s+(\d+)\s+\*\s+\*\s+\*$/); // minute hour * * *
  if (!m) return null;
  const minute = +m[1], hour = +m[2];
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hour, minute, 0));
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString();
}

export async function getSchedulerStatus(companyId: string | null): Promise<SchedulerStatus> {
  // Both config and run history are strictly company-scoped. No global/null
  // fallback — a company without its own config simply has none (the dashboard
  // renders a clean "not configured / paused" state), and run history shows
  // only this company's runs (never another tenant's or the demo's).
  if (!companyId) {
    return { config: null, lastRun: null, lastScheduledRun: null, scheduledSuccessEver: false, recentRuns: [], nextRunIso: null, activeRun: null };
  }
  // Repair any stuck run first so a dead run never disables the button forever.
  await expireStaleRuns(companyId);
  const [{ data: cfgRows }, { data: runRows }, { data: schedRows }, { count: schedSuccessCount }] = await Promise.all([
    supabase
      .from("intelligence_scheduler_config")
      .select("*")
      .eq("company_id", companyId)
      .order("updated_at", { ascending: false })
      .limit(1),
    supabase
      .from("intelligence_run_summaries")
      .select("*")
      .eq("company_id", companyId)
      .order("started_at", { ascending: false })
      .limit(10),
    // Most recent SCHEDULED run (any status) — may be older than the last 10 runs.
    supabase
      .from("intelligence_run_summaries")
      .select("*")
      .eq("company_id", companyId)
      .eq("trigger_type", "scheduled")
      .order("started_at", { ascending: false })
      .limit(1),
    // Has any scheduled run ever succeeded across all history?
    supabase
      .from("intelligence_run_summaries")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("trigger_type", "scheduled")
      .in("status", ["completed", "completed_with_warnings"]),
  ]);

  const config = (cfgRows?.[0] as SchedulerConfig) ?? null;
  const recentRuns = (runRows as (RunSummary & Partial<RunProgress>)[]) ?? [];
  const lastScheduledRun = (schedRows?.[0] as RunSummary & Partial<RunProgress>) ?? null;
  const scheduledSuccessEver = (schedSuccessCount ?? 0) > 0;
  // Active = running with a fresh heartbeat (stale ones were just expired above).
  const freshCutoff = Date.now() - STALE_RUN_MINUTES * 60_000;
  const activeRun = recentRuns.find(
    (r) => r.status === "running" &&
      new Date(r.heartbeat_at ?? r.started_at).getTime() >= freshCutoff
  ) ?? null;
  return {
    config,
    lastRun: recentRuns[0] ?? null,
    lastScheduledRun,
    scheduledSuccessEver,
    recentRuns,
    nextRunIso: config?.enabled ? computeNextRun(config.cron_expression) : null,
    activeRun,
  };
}

export async function getRunHistory(companyId: string | null, limit = 25): Promise<RunSummary[]> {
  if (!companyId) return [];
  const { data } = await supabase
    .from("intelligence_run_summaries")
    .select("*")
    .eq("company_id", companyId)
    .order("started_at", { ascending: false })
    .limit(limit);
  return (data as RunSummary[]) ?? [];
}

export async function setScheduleEnabled(configId: string, enabled: boolean): Promise<void> {
  await supabase.from("intelligence_scheduler_config").update({ enabled }).eq("id", configId);
}

// ─── Server-owned run orchestration (browser only starts + observes) ─────────

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

function fnUrl(name: string): string {
  return `${SUPABASE_URL.replace(/\/$/, "")}/functions/v1/${name}`;
}
export function supabaseHost(): string {
  try { return new URL(SUPABASE_URL).host; } catch { return String(SUPABASE_URL); }
}

export type StartRunOk = {
  ok: true;
  runId: string;
  summaryId: string;
  status: "queued" | "already_running";
  message?: string;
};
export type StartRunErr = {
  ok: false;
  errorCode: string;
  message: string;
  httpStatus: number | null;
  stage?: string;
  suggestedFix?: string;
  debug?: unknown;
};
export type StartRunOutcome = StartRunOk | StartRunErr;

export type StartRunOptions = {
  companyId: string;
  runMode?: string;          // "full" | "ultra_debug" | …
  force?: boolean;
  debug?: boolean;
  dryRun?: boolean;
  queryCap?: number;
  maxArticlesPerQuery?: number;
  cleanupAfter?: boolean;
};

// Starts a fully server-side intelligence run. Uses a RAW fetch (not
// supabase.functions.invoke) so we always capture the real HTTP status + JSON
// body — turning the opaque "Failed to send a request to the Edge Function"
// into an exact, structured error_code + message. The browser's only job after
// a successful start is to poll getRunProgress(summaryId); closing the tab does
// NOT stop or expire the run.
export async function startIntelligenceRun(opts: StartRunOptions): Promise<StartRunOutcome> {
  const functionName = "start-intelligence-run";
  const { data: { session } } = await supabase.auth.getSession();

  const reqInfo = {
    functionName,
    supabaseHost: supabaseHost(),
    hasSession: !!session,
    hasAccessToken: !!session?.access_token,
    companyId: opts.companyId,
    runMode: opts.runMode ?? "full",
    force: !!opts.force,
    debug: !!opts.debug,
  };
  console.info("[GroundSense start run request]", reqInfo);

  const body = {
    company_id: opts.companyId,
    run_mode: opts.runMode ?? "full",
    force: !!opts.force,
    debug: !!opts.debug,
    dry_run: !!opts.dryRun,
    cleanup_after: !!opts.cleanupAfter,
    ...(opts.queryCap != null ? { query_cap: opts.queryCap } : {}),
    ...(opts.maxArticlesPerQuery != null ? { max_articles_per_query: opts.maxArticlesPerQuery } : {}),
  };

  let res: Response;
  try {
    res = await fetch(fnUrl(functionName), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_ANON,
        Authorization: `Bearer ${session?.access_token ?? SUPABASE_ANON}`,
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    // fetch rejected → network / CORS / not-deployed. Probe healthcheck to refine.
    const health = await checkEdgeHealth().catch(() => null);
    const unreachable = !health || health.reachable === false;
    const out: StartRunErr = {
      ok: false,
      errorCode: unreachable ? "function_unreachable" : "network_error",
      message: unreachable
        ? `Edge Functions are unreachable at ${supabaseHost()}. The function is likely not deployed, or CORS/network is blocking the request. (${e instanceof Error ? e.message : String(e)})`
        : `Network error contacting the Edge Function. (${e instanceof Error ? e.message : String(e)})`,
      httpStatus: null,
      stage: "invoke",
    };
    console.error("[GroundSense start run failed]", { ...reqInfo, ...out });
    return out;
  }

  let json: Record<string, unknown> | null = null;
  try { json = await res.json(); } catch { /* non-JSON body */ }

  if (!res.ok || (json && json.ok === false)) {
    const debug = (json?.debug ?? undefined) as { stage?: string } | undefined;
    const out: StartRunErr = {
      ok: false,
      errorCode: (json?.error_code as string) ?? `http_${res.status}`,
      message: (json?.message as string) ?? `Edge Function returned HTTP ${res.status}.`,
      httpStatus: res.status,
      stage: debug?.stage,
      suggestedFix: json?.suggested_fix as string | undefined,
      debug: json?.debug,
    };
    console.error("[GroundSense start run failed]", { ...reqInfo, ...out, responseBody: json });
    return out;
  }

  const runId = json?.run_id as string | undefined;
  const summaryId = json?.summary_id as string | undefined;
  if (!runId || !summaryId) {
    const out: StartRunErr = {
      ok: false,
      errorCode: "invalid_response",
      message: (json?.message as string) ?? "Run did not start (no run_id returned).",
      httpStatus: res.status,
      debug: json,
    };
    console.error("[GroundSense start run failed]", { ...reqInfo, ...out });
    return out;
  }

  const result: StartRunOk = {
    ok: true,
    runId,
    summaryId,
    status: (json?.status as StartRunOk["status"]) ?? "queued",
    message: json?.message as string | undefined,
  };
  console.info("[GroundSense start run accepted]", result);
  return result;
}

// ─── Edge Function health probe ──────────────────────────────────────────────

export type EdgeHealth = {
  reachable: boolean;          // did the HTTP request complete at all?
  ok?: boolean;                // function-reported readiness (db + secrets)
  httpStatus: number | null;
  host: string;
  body?: Record<string, unknown> | null;
  error?: string;
};

// Probes intelligence-healthcheck with a raw fetch. Distinguishes
// "not deployed / CORS / network" (reachable=false) from "reachable but a
// secret/DB is missing" (reachable=true, ok=false).
export async function checkEdgeHealth(): Promise<EdgeHealth> {
  const host = supabaseHost();
  try {
    const res = await fetch(fnUrl("intelligence-healthcheck"), {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` },
      body: "{}",
    });
    let body: Record<string, unknown> | null = null;
    try { body = await res.json(); } catch { /* ignore */ }
    const health: EdgeHealth = { reachable: true, ok: !!body?.ok, httpStatus: res.status, host, body };
    console.info("[GroundSense edge health]", health);
    return health;
  } catch (e) {
    const health: EdgeHealth = { reachable: false, httpStatus: null, host, error: e instanceof Error ? e.message : String(e) };
    console.error("[GroundSense edge health] unreachable", health);
    return health;
  }
}

// Recent run events for the diagnostics drawer.
export async function getRunEvents(summaryId: string, limit = 50): Promise<RunEvent[]> {
  const { data } = await supabase
    .from("intelligence_run_events")
    .select("id, stage, level, message, created_at")
    .eq("summary_id", summaryId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data as RunEvent[]) ?? [];
}

// Reads a single run's live progress (status + stage + counters) plus its most
// recent event. This is the SOLE source of truth for the UI — it works after a
// tab switch, refresh, or browser reopen because the state lives in the DB.
export async function getRunProgress(summaryId: string): Promise<RunProgressSnapshot | null> {
  const { data: row } = await supabase
    .from("intelligence_run_summaries")
    .select("*")
    .eq("id", summaryId)
    .maybeSingle();
  if (!row) return null;

  const { data: events } = await supabase
    .from("intelligence_run_events")
    .select("id, stage, level, message, created_at")
    .eq("summary_id", summaryId)
    .order("created_at", { ascending: false })
    .limit(1);

  // Optional: record that a client observed this run (never affects liveness).
  void supabase.rpc("touch_run_client_seen", { p_summary_id: summaryId });

  return {
    ...(row as RunProgressSnapshot),
    latestEvent: (events?.[0] as RunEvent) ?? null,
  };
}

// Returns the company's currently-live run (running/queued with a fresh server
// heartbeat), or null. Stale runs are expired first so a dead run never blocks
// the Run button. Used on dashboard mount to resume progress after a refresh.
export async function getActiveRunForCompany(
  companyId: string | null,
): Promise<RunProgressSnapshot | null> {
  if (!companyId) return null;
  await expireStaleRuns(companyId);
  const freshCutoff = new Date(Date.now() - STALE_RUN_MINUTES * 60_000).toISOString();
  const { data } = await supabase
    .from("intelligence_run_summaries")
    .select("*")
    .eq("company_id", companyId)
    .in("status", ["running", "queued"])
    .gte("heartbeat_at", freshCutoff)
    .order("started_at", { ascending: false })
    .limit(1);
  const row = data?.[0];
  if (!row) return null;
  return getRunProgress((row as { id: string }).id);
}

// Wrap a manual run: acquire the shared lock + open a run-summary row.
// Returns null if another run holds the lock (so the caller skips cleanly).
export async function beginManualRun(
  companyId: string | null,
  opts?: { force?: boolean },
): Promise<{ summaryId: string; runId: string } | null> {
  const runId = crypto.randomUUID();
  // Repair any dead run + stale locks before acquiring, so a previously-crashed
  // browser run can't block a new one.
  await expireStaleRuns(companyId);
  await supabase.rpc("expire_stale_intelligence_locks");
  const { data: acquired } = await supabase.rpc("acquire_intelligence_run_lock", {
    p_lock_key: lockKey(companyId),
    p_run_id: runId,
    p_ttl_seconds: LOCK_TTL_SECONDS,
    p_acquired_by: "manual",
  });
  if (!acquired) return null;

  const { data } = await supabase
    .from("intelligence_run_summaries")
    .insert({
      pipeline_run_id: runId,
      trigger_type: "manual",
      status: "running",
      company_id: companyId,
      schedule_name: opts?.force ? "manual · force full" : "manual",
      lock_key: lockKey(companyId),
      heartbeat_at: new Date().toISOString(),
      current_stage: "queued",
      current_stage_label: "Starting intelligence run…",
      current_stage_index: 0,
      total_stages: 13,
      progress_pct: 0,
    })
    .select("id")
    .single();

  return { summaryId: (data as { id: string })?.id, runId };
}

// True when this company has never had a completed run — the first run must not
// be short-circuited by "no material change" logic.
export async function isFirstRunForCompany(companyId: string | null): Promise<boolean> {
  if (!companyId) return true;
  const { count } = await supabase
    .from("intelligence_run_summaries")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .in("status", ["completed", "completed_with_warnings"]);
  return (count ?? 0) === 0;
}

export async function finishManualRun(
  companyId: string | null,
  handle: { summaryId: string; runId: string },
  result: {
    status: "completed" | "completed_with_warnings" | "failed";
    error?: string;
    counts?: Partial<RunSummary>;
    // Honest run metadata — surfaced in run history so a quick run is never an
    // unexplained "completed · 0 generated".
    note?: string;
    runMode?: string;
    force?: boolean;
    firstRun?: boolean;
    stagesExecuted?: string[];
    extra?: Record<string, unknown>;
  },
): Promise<void> {
  // Record the ACTIVE published state after the run (not just "newly published"), so run
  // history never misleadingly reads "0 published" while the dashboard shows active issues.
  let activePublished = 0;
  let activeActions = 0;
  if (result.status !== "failed") {
    let pubQ = supabase
      .from("risk_register")
      .select("*", { count: "exact", head: true })
      .in("display_section", ["risk_register", "operating_changes"]);
    // Count only issue-linked active actions (risk / operating change), matching the dashboard's
    // Open Actions. Opportunity candidates do not get executive actions, so they never count here.
    let actQ = supabase
      .from("risk_actions")
      .select("*", { count: "exact", head: true })
      .neq("status", "completed")
      .in("source_type", ["risk", "operating_change"]);
    if (companyId) {
      pubQ = pubQ.eq("company_id", companyId);
      actQ = actQ.eq("company_id", companyId);
    }
    const [{ count: pub }, { count: act }] = await Promise.all([pubQ, actQ]);
    activePublished = pub ?? 0;
    activeActions = act ?? 0;
  }

  await supabase
    .from("intelligence_run_summaries")
    .update({
      status: result.status,
      completed_at: new Date().toISOString(),
      error_message: result.error?.slice(0, 500) ?? null,
      // Surface the honest note in the run-history "Note" column even on success.
      skipped_reason: result.note ?? null,
      candidates_published: activePublished,
      actions_created: activeActions,
      summary: {
        scope: "active_state_after_merge",
        company_id: companyId,
        run_mode: result.runMode ?? "full",
        force: result.force ?? false,
        first_run_for_company: result.firstRun ?? false,
        stages_executed: result.stagesExecuted ?? [],
        active_published_issues: activePublished,
        active_actions: activeActions,
        note: result.note ?? "Existing published intelligence preserved; counts reflect active state, not only newly generated.",
        ...(result.extra ?? {}),
      },
      ...(result.counts ?? {}),
    })
    .eq("id", handle.summaryId);
  await supabase.rpc("release_intelligence_run_lock", {
    p_lock_key: lockKey(companyId),
    p_run_id: handle.runId,
  });
}
