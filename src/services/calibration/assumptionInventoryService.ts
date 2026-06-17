// Calibration Center — assumption inventory.
// Surfaces every important value driving GroundSense, with source provenance.
// Pure functions.

import type { CompanyCalibrationInput } from "../calibrationService";
import type { AssumptionOverride, AssumptionRow, DomainKey, DomainRow, SourceType } from "./types";
import { deriveAllCalibration, type DerivedValue } from "./calibratedModelService";

type DomainRowsByKey = Record<DomainKey, DomainRow[]>;

// The canonical assumptions GroundSense uses, with their inferred defaults.
type AssumptionDef = {
  key: string;
  label: string;
  domain: DomainKey;
  unit: string;
  inferredDefault: number;
  usedBy: string[];
};

const ASSUMPTIONS: AssumptionDef[] = [
  // Freight
  { key: "freight_spend", label: "Annual freight spend", domain: "freight", unit: "$", inferredDefault: 90_000_000, usedBy: ["Freight risk", "Scenario editor"] },
  { key: "freight_spot_rate_exposure_pct", label: "Spot-rate exposed freight %", domain: "freight", unit: "%", inferredDefault: 28, usedBy: ["Freight risk", "Scenario editor"] },
  { key: "freight_contract_coverage_pct", label: "Contract coverage %", domain: "freight", unit: "%", inferredDefault: 70, usedBy: ["Freight risk"] },
  // Supplier
  { key: "steel_spend", label: "Annual steel spend", domain: "supplier", unit: "$", inferredDefault: 150_000_000, usedBy: ["Tariff/steel exposure", "Scenario editor"] },
  { key: "steel_import_exposure_pct", label: "Steel import-exposed %", domain: "supplier", unit: "%", inferredDefault: 35, usedBy: ["Tariff/steel exposure"] },
  { key: "copper_spend", label: "Annual copper spend", domain: "supplier", unit: "$", inferredDefault: 40_000_000, usedBy: ["Copper exposure"] },
  { key: "aluminum_spend", label: "Annual aluminum spend", domain: "supplier", unit: "$", inferredDefault: 30_000_000, usedBy: ["Aluminum exposure"] },
  { key: "pass_through_coverage_pct", label: "Pass-through coverage %", domain: "supplier", unit: "%", inferredDefault: 80, usedBy: ["Tariff/steel exposure", "Scenario editor"] },
  // CRM
  { key: "manufacturing_revenue", label: "Manufacturing segment revenue", domain: "crm", unit: "$", inferredDefault: 0, usedBy: ["Demand opportunities", "Customer model"] },
  { key: "construction_revenue", label: "Construction segment revenue", domain: "crm", unit: "$", inferredDefault: 0, usedBy: ["Demand opportunities", "Customer model"] },
  { key: "quote_win_rate_pct", label: "Quote win rate %", domain: "crm", unit: "%", inferredDefault: 0, usedBy: ["Competitive model"] },
  // Financial
  { key: "annual_revenue", label: "Annual revenue", domain: "financial", unit: "$", inferredDefault: 7_500_000_000, usedBy: ["All % exposure ranges"] },
  { key: "gross_margin_pct", label: "Gross margin %", domain: "financial", unit: "%", inferredDefault: 46, usedBy: ["All margin exposure"] },
  // Inventory
  { key: "fill_rate_pct", label: "Fill rate %", domain: "inventory", unit: "%", inferredDefault: 0, usedBy: ["Service-level issues"] },
  { key: "backorder_rate_pct", label: "Backorder rate %", domain: "inventory", unit: "%", inferredDefault: 0, usedBy: ["Service-level issues"] },
];

function fmtValue(value: number | null, unit: string): string {
  if (value === null) return "—";
  if (unit === "$") {
    const abs = Math.abs(value);
    if (abs >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
    if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
    if (abs >= 1_000) return `$${Math.round(value / 1_000)}K`;
    return `$${Math.round(value)}`;
  }
  if (unit === "%") return `${value}%`;
  return String(value);
}

function statusFor(sourceType: SourceType): AssumptionRow["status"] {
  switch (sourceType) {
    case "imported_csv": return "Imported";
    case "derived": return "Calibrated";
    case "manual": return "Manual";
    case "approved": return "Approved";
    case "demo": return "Demo";
    default: return "Inferred";
  }
}

function sourceLabelFor(sourceType: SourceType): string {
  switch (sourceType) {
    case "imported_csv": return "Imported CSV";
    case "derived": return "Derived from imported data";
    case "manual": return "Manual entry";
    case "approved": return "Approved assumption";
    case "demo": return "Demo assumption";
    default: return "Inferred benchmark";
  }
}

export function buildAssumptionInventory(
  base: CompanyCalibrationInput | null,
  rowsByKey: DomainRowsByKey,
  lastUpdated: string | null,
  assumptionOverrides: Record<string, AssumptionOverride> = {}
): AssumptionRow[] {
  const { overrides, provenance } = deriveAllCalibration(rowsByKey);
  const baseObj = (base ?? {}) as Record<string, unknown>;
  const domainLabels: Record<DomainKey, string> = {
    freight: "Freight & Logistics",
    supplier: "Supplier / Procurement",
    crm: "Customer / CRM",
    financial: "Financial Anchors",
    inventory: "Inventory & Service",
    competitive: "Competitive / Win-Loss",
    outcomes: "Outcomes",
  };

  // The inferred fallback value for an assumption (base value or benchmark default).
  const inferredOf = (def: AssumptionDef): number | null => {
    const baseVal = baseObj[def.key];
    if (baseVal != null && Number.isFinite(Number(baseVal))) return Number(baseVal);
    return def.inferredDefault > 0 ? def.inferredDefault : null;
  };

  return ASSUMPTIONS.map((def) => {
    const derived: DerivedValue | undefined = provenance[def.key];
    const overrideVal = (overrides as Record<string, unknown>)[def.key];
    const manual = assumptionOverrides[def.key];
    const baseVal = baseObj[def.key];

    let value: number | null;
    let sourceType: SourceType;
    let confidence: "high" | "medium" | "low";
    let lastUpd: string | null = lastUpdated;
    let isOverride = false;
    let replacedValue: string | null = null;

    if (derived && overrideVal != null) {
      // Imported/derived row data wins.
      value = Number(overrideVal);
      sourceType = derived.sourceType;
      confidence = derived.confidence;
      const inferred = inferredOf(def);
      if (inferred != null && Math.round(inferred) !== Math.round(value)) replacedValue = `${fmtValue(inferred, def.unit)} inferred`;
    } else if (manual) {
      // Manual/approved override.
      value = manual.value;
      sourceType = manual.status === "Approved" ? "approved" : "manual";
      confidence = manual.status === "Approved" ? "high" : "medium";
      lastUpd = manual.updatedAt;
      isOverride = true;
      const inferred = inferredOf(def);
      if (inferred != null && Math.round(inferred) !== Math.round(value)) replacedValue = `${fmtValue(inferred, def.unit)} inferred`;
    } else if (baseVal != null && Number.isFinite(Number(baseVal))) {
      value = Number(baseVal);
      sourceType = "inferred";
      confidence = "low";
    } else if (def.inferredDefault > 0) {
      value = def.inferredDefault;
      sourceType = "inferred";
      confidence = "low";
      lastUpd = null;
    } else {
      value = null;
      sourceType = "inferred";
      confidence = "low";
      lastUpd = null;
    }

    const isCalibrated = sourceType === "imported_csv" || sourceType === "derived" || sourceType === "manual" || sourceType === "approved";

    return {
      key: def.key,
      label: def.label,
      domain: def.domain,
      domainLabel: domainLabels[def.domain],
      value: fmtValue(value, def.unit),
      rawValue: value,
      unit: def.unit,
      sourceType,
      sourceLabel: derived?.sourceLabel ?? sourceLabelFor(sourceType),
      confidence,
      usedBy: def.usedBy,
      lastUpdated: isCalibrated ? lastUpd : null,
      status: statusFor(sourceType),
      replacedValue,
      isOverride,
    };
  });
}

export function countInferredAssumptions(rows: AssumptionRow[]): number {
  return rows.filter((r) => r.status === "Inferred" || r.status === "Demo").length;
}

export function countCalibratedAssumptions(rows: AssumptionRow[]): number {
  return rows.filter((r) => r.status === "Imported" || r.status === "Calibrated" || r.status === "Manual" || r.status === "Approved").length;
}
