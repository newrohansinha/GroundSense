// Calibration Center — activity log helpers.
// Pure functions over CalibrationState.runs.

import type { CalibrationRunRecord, CalibrationState } from "./types";

export function getCalibrationActivityLog(state: CalibrationState): CalibrationRunRecord[] {
  return [...state.runs].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

export function summarizeRecentChanges(state: CalibrationState): {
  totalRuns: number;
  inputsAdded: number;
  lastRunAt: string | null;
} {
  const runs = state.runs;
  const inputsAdded = runs.reduce((s, r) => s + r.inputsAdded, 0);
  return {
    totalRuns: runs.length,
    inputsAdded,
    lastRunAt: runs.length > 0 ? getCalibrationActivityLog(state)[0].createdAt : null,
  };
}
