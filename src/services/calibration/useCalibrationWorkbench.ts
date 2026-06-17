// Calibration Center — React hook binding store + workbench facade.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { CompanyCalibrationInput } from "../calibrationService";
import type { CalibrationState, DomainKey, DomainRow, SourceType } from "./types";
import { loadState, applyRows, clearDomain, emptyState, setAssumptionOverride, clearAssumptionOverride } from "./calibrationStore";
import { buildCalibrationWorkbench, type CalibrationWorkbench } from "./workbenchService";

export type UseCalibrationWorkbench = {
  state: CalibrationState;
  workbench: CalibrationWorkbench;
  applyDomainRows: (domain: DomainKey, rows: DomainRow[], sourceType: SourceType, sourceName: string) => Promise<{ beforeScore: number; afterScore: number; added: number; replaced: number }>;
  resetDomain: (domain: DomainKey) => void;
  setAssumption: (key: string, value: number, status: "Manual" | "Approved") => void;
  resetAssumption: (key: string) => void;
  persistence: "supabase" | "local";
};

export function useCalibrationWorkbench(
  companyId: string | null,
  base: CompanyCalibrationInput | null,
  blockedCandidateCount = 0,
  onCalibrationChange?: (merged: CompanyCalibrationInput) => void
): UseCalibrationWorkbench {
  const [state, setState] = useState<CalibrationState>(() =>
    companyId ? loadState(companyId) : emptyState("unknown")
  );

  useEffect(() => {
    if (companyId) setState(loadState(companyId));
  }, [companyId]);

  const workbench = useMemo(
    () => buildCalibrationWorkbench(state, base, blockedCandidateCount),
    [state, base, blockedCandidateCount]
  );

  // Push merged calibration upward whenever derived overrides change.
  const overridesSignature = JSON.stringify(workbench.derivedOverrides);
  useEffect(() => {
    if (onCalibrationChange && Object.keys(workbench.derivedOverrides).length > 0) {
      onCalibrationChange(workbench.mergedCalibration);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overridesSignature]);

  const applyDomainRows = useCallback(
    async (domain: DomainKey, rows: DomainRow[], sourceType: SourceType, sourceName: string) => {
      if (!companyId) return { beforeScore: 0, afterScore: 0, added: 0, replaced: 0 };
      const result = await applyRows(companyId, domain, rows, sourceType, sourceName);
      setState(result.state);
      return { beforeScore: result.beforeScore, afterScore: result.afterScore, added: result.added, replaced: result.replaced };
    },
    [companyId]
  );

  const resetDomain = useCallback(
    (domain: DomainKey) => {
      if (!companyId) return;
      setState(clearDomain(companyId, domain));
    },
    [companyId]
  );

  const setAssumption = useCallback(
    (key: string, value: number, status: "Manual" | "Approved") => {
      if (!companyId) return;
      setState(setAssumptionOverride(companyId, key, value, status));
    },
    [companyId]
  );

  const resetAssumption = useCallback(
    (key: string) => {
      if (!companyId) return;
      setState(clearAssumptionOverride(companyId, key));
    },
    [companyId]
  );

  return {
    state,
    workbench,
    applyDomainRows,
    resetDomain,
    setAssumption,
    resetAssumption,
    persistence: state.persistence,
  };
}
