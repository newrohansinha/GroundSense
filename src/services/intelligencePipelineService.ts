// Pipeline progress view-model (display only).
//
// IMPORTANT: The intelligence pipeline NO LONGER runs in the browser. It is
// fully server-owned (supabase/functions/start-intelligence-run +
// _shared/intelligence-orchestrator.ts). This module used to execute the long
// fetch/score/generate loop client-side and was the source of the "browser
// closed → run expired" bug. That execution code has been removed.
//
// What remains is purely the shape the dashboard uses to render run progress
// (mapped from the persisted DB run via DashboardPage.snapshotToPipelineState).
// The stage list mirrors the SERVER stages in _shared/intelligence-orchestrator.

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

// Mirrors _shared/intelligence-orchestrator.ts STAGES (server-owned).
const STEP_DEFS: { id: string; label: string }[] = [
  { id: "fetch-fresh",            label: "Fetching external intelligence" },
  { id: "score-events",          label: "Scoring relevance" },
  { id: "detect-changes",        label: "Detecting material change" },
  { id: "build-connections",     label: "Building company connections" },
  { id: "generate-risks",        label: "Generating risks" },
  { id: "generate-opportunities",label: "Generating opportunities" },
  { id: "quality-gate",          label: "Running quality gate" },
  { id: "generate-brief",        label: "Rebuilding leadership brief" },
  { id: "finalize",              label: "Finalizing & consistency check" },
];

export function getInitialPipelineState(): PipelineState {
  return {
    running: false,
    steps: STEP_DEFS.map((s) => ({ ...s, status: "pending" })),
    currentStepId: null,
    error: null,
    completedAt: null,
  };
}

// Kept for the "Stop / Reset" control. These no longer interrupt server-side
// execution (the browser is not the worker) — they only reset the local view.
let _dismissed = false;
export function stopPipeline() {
  _dismissed = true;
}
export function resetPipeline() {
  _dismissed = false;
}
export function isPipelineDismissed() {
  return _dismissed;
}
