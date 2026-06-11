import { supabase } from "../lib/supabase";
import { scoreEventsForCompany } from "./eventScorer";
import { generateDynamicRisksForCompany } from "./dynamicRiskGenerator";
import { matchEventsToConnections } from "./eventConnectionMatcher";
import { attachConnectionsToRisks } from "./riskConnectionBackfill";
import { fetchFreshIntelligenceForCompany } from "./freshIntelligenceService";

// ─── Types ────────────────────────────────────────────────────────────────────

export type PipelineStepStatus = "pending" | "running" | "complete" | "failed" | "skipped";

export type PipelineStep = {
  id: string;
  label: string;
  status: PipelineStepStatus;
  error?: string;
};

export type PipelineState = {
  running: boolean;
  steps: PipelineStep[];
  currentStepId: string | null;
  error: string | null;
  completedAt: Date | null;
};

// ─── Step definitions ─────────────────────────────────────────────────────────

const STEP_DEFS: { id: string; label: string }[] = [
  { id: "fetch-events",          label: "Updating external intelligence" },
  { id: "fetch-bodies",          label: "Fetching article content" },
  { id: "score-events",          label: "Scoring relevance" },
  { id: "build-connections",     label: "Building company connections" },
  { id: "match-connections",     label: "Mapping to company exposure graph" },
  { id: "generate-risks",        label: "Generating risks" },
  { id: "generate-opportunities",label: "Generating opportunities" },
  { id: "quality-gate",          label: "Running quality gate" },
  { id: "build-exposure-graph",  label: "Rebuilding exposure graph" },
];

// ─── Stop flag ────────────────────────────────────────────────────────────────

let _stopRequested = false;

export function stopPipeline() {
  _stopRequested = true;
}

export function resetPipeline() {
  _stopRequested = false;
}

// ─── Initial state ────────────────────────────────────────────────────────────

export function getInitialPipelineState(): PipelineState {
  return {
    running: false,
    steps: STEP_DEFS.map(s => ({ ...s, status: "pending" })),
    currentStepId: null,
    error: null,
    completedAt: null,
  };
}

// ─── Orchestrator ─────────────────────────────────────────────────────────────

export async function runIntelligenceUpdatePipeline(
  companyId: string,
  onProgress: (state: PipelineState) => void
): Promise<PipelineState> {
  _stopRequested = false;

  let state: PipelineState = {
    running: true,
    steps: STEP_DEFS.map(s => ({ ...s, status: "pending" })),
    currentStepId: null,
    error: null,
    completedAt: null,
  };

  function emit(update?: Partial<PipelineState>) {
    if (update) state = { ...state, ...update };
    onProgress({ ...state });
  }

  function setStep(id: string, status: PipelineStepStatus, error?: string) {
    state = {
      ...state,
      steps: state.steps.map(s => s.id === id ? { ...s, status, error } : s),
      currentStepId: status === "running" ? id : state.currentStepId,
    };
    emit();
  }

  function stepLabel(id: string): string {
    return STEP_DEFS.find(s => s.id === id)?.label ?? id;
  }

  async function runStep(id: string, fn: () => Promise<void>): Promise<boolean> {
    if (_stopRequested) {
      setStep(id, "skipped");
      return false;
    }
    setStep(id, "running");
    try {
      await fn();
      setStep(id, "complete");
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Pipeline step [${id}] failed:`, err);
      setStep(id, "failed", msg);
      emit({
        running: false,
        error: `${stepLabel(id)} failed. ${friendlyError(id, msg)}`,
        currentStepId: id,
      });
      return false;
    }
  }

  // Step 1 — Fetch Fresh Intelligence (client-side via fetch-currents-query)
  if (!await runStep("fetch-events", async () => {
    await fetchFreshIntelligenceForCompany(companyId, { silent: true });
  })) return state;

  // Step 2 — Fetch Article Bodies
  if (!await runStep("fetch-bodies", async () => {
    const { data, error } = await supabase.functions.invoke("fetch-article-content", {
      body: { companyId, limit: 15 },
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
  })) return state;

  // Step 3 — Score Events
  if (!await runStep("score-events", async () => { await scoreEventsForCompany(companyId); })) return state;

  // Step 4 — Build Connections
  if (!await runStep("build-connections", async () => {
    const { data, error } = await supabase.functions.invoke("build-company-connections", { body: { companyId } });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
  })) return state;

  // Step 5 — Match Events to Connections
  if (!await runStep("match-connections", async () => { await matchEventsToConnections(companyId); })) return state;

  // Step 6 — Generate Risks
  if (!await runStep("generate-risks", async () => {
    await generateDynamicRisksForCompany(companyId);
    await matchEventsToConnections(companyId);
    await attachConnectionsToRisks(companyId);
  })) return state;

  // Step 7 — Generate Opportunities
  if (!await runStep("generate-opportunities", async () => {
    const { data, error } = await supabase.functions.invoke("generate-opportunities", { body: { companyId } });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    await matchEventsToConnections(companyId);
    await attachConnectionsToRisks(companyId);
  })) return state;

  // Step 8 — Quality Gate (client-side evaluation; no edge function needed)
  // The gate runs in the dashboard at display time. This step signals completion.
  if (!await runStep("quality-gate", async () => {
    // Gate runs client-side; nothing to invoke here
    await new Promise<void>((resolve) => setTimeout(resolve, 300));
  })) return state;

  // Step 9 — Rebuild Exposure Graph (was Step 8)
  if (!await runStep("build-exposure-graph", async () => {
    const { data, error } = await supabase.functions.invoke("build-exposure-graph", { body: { companyId } });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
  })) return state;

  emit({ running: false, completedAt: new Date(), currentStepId: null });
  return state;
}

// ─── Error messages ───────────────────────────────────────────────────────────

function friendlyError(stepId: string, raw: string): string {
  const map: Record<string, string> = {
    "fetch-events":           "Check your tracking queries or network connection.",
    "fetch-bodies":           "Article content fetch failed. Pipeline will continue on retry.",
    "score-events":           "Events may not have been fetched yet, or the scorer timed out.",
    "build-connections":      "Company connection graph could not be built. Check calibration data.",
    "match-connections":      "Event-to-connection matching failed.",
    "generate-risks":         "Events may need to be scored first.",
    "generate-opportunities": "Events may need to be scored first.",
    "quality-gate":           "Quality gate evaluation failed (client-side).",
    "build-exposure-graph":   "Risk and connection data may be incomplete.",
  };
  const hint = map[stepId] ?? "";
  const short = raw.length > 120 ? raw.slice(0, 120) + "…" : raw;
  return `${hint}${hint && short ? " " : ""}${short}`;
}
