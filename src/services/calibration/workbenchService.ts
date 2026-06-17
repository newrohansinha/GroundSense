// Calibration Center — workbench facade.
// Assembles the full view-model the UI renders, from raw state + base calibration.
// Pure (no React); the React hook lives in useCalibrationWorkbench.ts.

import type { CompanyCalibrationInput } from "../calibrationService";
import type {
  AssumptionRow,
  CalibrationState,
  DomainKey,
  DomainScore,
  ImpactPreview,
} from "./types";
import { CALIBRATION_DOMAINS, getDomain } from "./calibrationDomains";
import { getRowsByKey } from "./calibrationStore";
import { buildDomainScore, scoreOverallOperatingModel } from "./calibrationDataQualityService";
import { calculateImpactForDomain } from "./calibrationImpactService";
import { buildAssumptionInventory, countInferredAssumptions } from "./assumptionInventoryService";
import { deriveAllCalibration, mergeCalibration } from "./calibratedModelService";

const ALL_KEYS: DomainKey[] = CALIBRATION_DOMAINS.map((d) => d.key);

export type CalibrationSummary = {
  modelReliability: number;
  inputsCalibrated: number;
  inputsRequired: number;
  inferredAssumptions: number;
  importedDataSources: number;
  estimatesImproved: number;
  blockedByMissingData: number;
};

export type RoadmapItem = {
  rank: number;
  title: string;
  impactLevel: "High" | "Medium" | "Low";
  affectedIssue: string;
  requiredData: string;
  estimatedImprovement: string;
  domain: DomainKey;
  done: boolean;
};

export type IssueDependency = {
  issue: string;
  reliability: string;
  missingData: string[];
  calibrationNeeded: string;
  domain: DomainKey;
};

export type CalibrationWorkbench = {
  summary: CalibrationSummary;
  domainScores: DomainScore[];
  assumptions: AssumptionRow[];
  impacts: Record<DomainKey, ImpactPreview>;
  roadmap: RoadmapItem[];
  dependencies: IssueDependency[];
  mergedCalibration: CompanyCalibrationInput;
  derivedOverrides: Partial<CompanyCalibrationInput>;
};

export function buildCalibrationWorkbench(
  state: CalibrationState,
  base: CompanyCalibrationInput | null,
  blockedCandidateCount = 0
): CalibrationWorkbench {
  const rowsByKey = getRowsByKey(state);
  const lastUpdated = state.updatedAt;

  // Per-domain scores (previous score = the prior run's afterScore, if any).
  const domainScores: DomainScore[] = ALL_KEYS.map((key) => {
    const rows = rowsByKey[key];
    const sources = state.domains[key]?.sources ?? [];
    const priorRun = state.runs.find((r) => r.domainLabel === getDomain(key).label && r.runType !== "reset");
    const previousScore = priorRun ? priorRun.beforeScore : 0;
    const lastRunForDomain = state.runs.find((r) => r.domainLabel === getDomain(key).label);
    return buildDomainScore(
      key,
      rows,
      previousScore,
      sources.length,
      lastRunForDomain ? lastRunForDomain.createdAt : null
    );
  });

  const modelReliability = scoreOverallOperatingModel(domainScores);

  const assumptionOverrides = state.assumptionOverrides ?? {};
  const assumptions = buildAssumptionInventory(base, rowsByKey, lastUpdated, assumptionOverrides);
  const inferredAssumptions = countInferredAssumptions(assumptions);

  const impacts = {} as Record<DomainKey, ImpactPreview>;
  for (const key of ALL_KEYS) {
    impacts[key] = calculateImpactForDomain(key, rowsByKey[key], base);
  }
  const estimatesImproved = ALL_KEYS.filter((k) => impacts[k].hasChange && impacts[k].rangeDeltaPct !== null).length;

  const importedDataSources = ALL_KEYS.reduce((acc, k) => acc + (state.domains[k]?.sources.length ?? 0), 0);

  const inputsCalibrated = domainScores.reduce((s, d) => s + d.inputsCalibrated, 0);
  const inputsRequired = domainScores.reduce((s, d) => s + d.inputsRequired, 0);

  const summary: CalibrationSummary = {
    modelReliability,
    inputsCalibrated,
    inputsRequired,
    inferredAssumptions,
    importedDataSources,
    estimatesImproved,
    blockedByMissingData: blockedCandidateCount,
  };

  const { overrides } = deriveAllCalibration(rowsByKey);
  // Priority (Part 10.5): imported/derived row data > manual/approved overrides > inferred base.
  const manualPatch: Partial<CompanyCalibrationInput> = {};
  for (const [k, v] of Object.entries(assumptionOverrides)) {
    (manualPatch as Record<string, unknown>)[k] = v.value;
  }
  const effectiveOverrides = { ...manualPatch, ...overrides };
  const mergedCalibration = mergeCalibration(base, effectiveOverrides);

  return {
    summary,
    domainScores,
    assumptions,
    impacts,
    roadmap: buildRoadmap(rowsByKey, blockedCandidateCount),
    dependencies: buildDependencies(rowsByKey),
    mergedCalibration,
    derivedOverrides: effectiveOverrides,
  };
}

function buildRoadmap(
  rowsByKey: Record<DomainKey, { length: number }[] | unknown[]>,
  blockedCandidateCount: number
): RoadmapItem[] {
  const has = (k: DomainKey) => (rowsByKey[k] as unknown[]).length > 0;
  const items: RoadmapItem[] = [
    {
      rank: 1,
      title: "Upload freight lanes",
      impactLevel: "High",
      affectedIssue: "Freight risk (top Act issue)",
      requiredData: "Lane-level spend, spot/contract split, surcharge exposure",
      estimatedImprovement: "Replaces inferred freight assumptions",
      domain: "freight",
      done: has("freight"),
    },
    {
      rank: 2,
      title: "Upload supplier country-of-origin",
      impactLevel: "High",
      affectedIssue: "Tariff / steel exposure",
      requiredData: "Supplier spend, country, tariff exposure, open PO",
      estimatedImprovement: "Grounds tariff exposure in real supplier data",
      domain: "supplier",
      done: has("supplier"),
    },
    {
      rank: 3,
      title: "Upload CRM quote/order trends",
      impactLevel: blockedCandidateCount > 0 ? "High" : "Medium",
      affectedIssue: "Blocked demand opportunity",
      requiredData: "Segment pipeline, quote/order growth by account",
      estimatedImprovement: "Required to promote blocked demand candidate",
      domain: "crm",
      done: has("crm"),
    },
    {
      rank: 4,
      title: "Add financial anchors",
      impactLevel: "Medium",
      affectedIssue: "All percentage-based exposure estimates",
      requiredData: "Revenue, gross margin, freight & commodity spend",
      estimatedImprovement: "Anchors every % exposure to real financials",
      domain: "financial",
      done: has("financial"),
    },
    {
      rank: 5,
      title: "Add actual outcome history",
      impactLevel: "Medium",
      affectedIssue: "Forecast accuracy scoring",
      requiredData: "Resolved forecast actuals vs predicted",
      estimatedImprovement: "Enables forecast accuracy + model calibration",
      domain: "outcomes",
      done: has("outcomes"),
    },
  ];
  // Incomplete items first, by rank.
  return items.sort((a, b) => Number(a.done) - Number(b.done) || a.rank - b.rank);
}

function buildDependencies(rowsByKey: Record<DomainKey, unknown[]>): IssueDependency[] {
  const has = (k: DomainKey) => rowsByKey[k].length > 0;
  return [
    {
      issue: "Freight risk",
      reliability: has("freight") ? "Lane-calibrated" : "Scenario-modeled",
      missingData: has("freight") ? [] : ["Lane spend", "Spot/contract split", "Surcharge exposure"],
      calibrationNeeded: "Freight CSV",
      domain: "freight",
    },
    {
      issue: "Tariff / steel operating change",
      reliability: has("supplier") ? "Supplier-grounded" : "Evidence-backed rate, inferred exposure",
      missingData: has("supplier") ? [] : ["Supplier country of origin", "Open PO exposure", "SKU landed cost"],
      calibrationNeeded: "Supplier CSV",
      domain: "supplier",
    },
    {
      issue: "Construction demand candidate",
      reliability: has("crm") ? "CRM-supported (gate still applies)" : "Pending review / blocked",
      missingData: has("crm") ? [] : ["CRM quote growth", "Order growth", "Customer pipeline evidence"],
      calibrationNeeded: "CRM CSV",
      domain: "crm",
    },
  ];
}
