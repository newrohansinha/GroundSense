// Calibration Center — before/after impact computation.
// Shows how calibration data changes exposure ranges + confidence.
// Pure functions.

import type { CompanyCalibrationInput } from "../calibrationService";
import type { DomainKey, DomainRow, ImpactLine, ImpactPreview } from "./types";
import { getDomain } from "./calibrationDomains";
import {
  deriveFreightInputs,
  deriveSupplierInputs,
  deriveCrmInputs,
} from "./calibratedModelService";
import { scoreDomain, getReliabilityLabel, getMissingInputs } from "./calibrationDataQualityService";

// Scenario shock assumptions (kept in sync with ScenarioEditor defaults).
const FREIGHT_SHOCK = { low: 3, mid: 7.5, high: 12 };
const COMMODITY_SHOCK = { low: 5, mid: 10, high: 20 };

const FREIGHT_BASE = { spend: 90_000_000, spotPct: 28 };
const COMMODITY_BASE = { spend: 150_000_000, importPct: 35, passThroughPct: 80 };

function fmtMoney(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${Math.round(n)}`;
}

function freightRange(spend: number, spotPct: number): { low: number; high: number; mid: number } {
  const spotExposed = spend * (spotPct / 100);
  return {
    low: spotExposed * (FREIGHT_SHOCK.low / 100),
    mid: spotExposed * (FREIGHT_SHOCK.mid / 100),
    high: spotExposed * (FREIGHT_SHOCK.high / 100),
  };
}

function commodityRange(spend: number, importPct: number, passThroughPct: number): { low: number; high: number; mid: number } {
  const importExposed = spend * (importPct / 100);
  const unpassed = importExposed * (1 - passThroughPct / 100);
  return {
    low: unpassed * (COMMODITY_SHOCK.low / 100),
    mid: unpassed * (COMMODITY_SHOCK.mid / 100),
    high: unpassed * (COMMODITY_SHOCK.high / 100),
  };
}

function rangeLabel(r: { low: number; high: number }): string {
  if (Math.round(r.low) === Math.round(r.high)) return `${fmtMoney(r.high)} point estimate`;
  return `${fmtMoney(r.low)}–${fmtMoney(r.high)}`;
}

function deltaPct(before: number, after: number): number | null {
  if (before === 0) return null;
  return Math.round(((after - before) / before) * 1000) / 10;
}

export function calculateFreightImpact(rows: DomainRow[], base: CompanyCalibrationInput | null): ImpactPreview {
  const def = getDomain("freight");
  const baseSpend = Number(base?.freight_spend ?? FREIGHT_BASE.spend);
  const baseSpot = Number(base?.freight_spot_rate_exposure_pct ?? FREIGHT_BASE.spotPct);
  const before = freightRange(baseSpend, baseSpot);

  const { overrides } = deriveFreightInputs(rows);
  const hasChange = rows.length > 0 && overrides.freight_spend != null;

  const afterSpend = Number(overrides.freight_spend ?? baseSpend);
  const afterSpot = Number(overrides.freight_spot_rate_exposure_pct ?? baseSpot);
  const after = freightRange(afterSpend, afterSpot);

  const scoreAfter = scoreDomain("freight", rows);

  const beforeLines: ImpactLine[] = [
    { label: "Annual freight spend", value: fmtMoney(baseSpend), source: base?.freight_spend ? "Company model" : "Inferred benchmark" },
    { label: "Spot exposure", value: `${baseSpot}%`, source: base?.freight_spot_rate_exposure_pct ? "Company model" : "Inferred benchmark" },
    { label: "Exposure range", value: rangeLabel(before), source: "Scenario-modeled" },
  ];
  const afterLines: ImpactLine[] = [
    { label: "Annual freight spend", value: fmtMoney(afterSpend), source: hasChange ? `Imported · ${rows.length} lanes` : "Inferred benchmark" },
    { label: "Spot exposure", value: `${afterSpot}%`, source: hasChange ? "Derived from lane data" : "Inferred benchmark" },
    { label: "Exposure range", value: rangeLabel(after), source: hasChange ? "Lane-calibrated scenario" : "Scenario-modeled" },
  ];

  return {
    domain: "freight",
    label: def.label,
    hasChange,
    beforeLines,
    afterLines,
    rangeBefore: rangeLabel(before),
    rangeAfter: rangeLabel(after),
    rangeDeltaPct: hasChange ? deltaPct(before.high, after.high) : null,
    confidenceBefore: getReliabilityLabel(0),
    confidenceAfter: getReliabilityLabel(scoreAfter),
    affectedIssues: ["Freight risk", "Logistics action ROI"],
    remainingMissing: getMissingInputs("freight", rows),
    summary: hasChange
      ? `Freight range recalculated from ${rows.length} lanes. Confidence: Scenario-modeled → ${getReliabilityLabel(scoreAfter)}.`
      : "Upload freight lanes to replace inferred spend and spot-exposure assumptions.",
  };
}

export function calculateSupplierImpact(rows: DomainRow[], base: CompanyCalibrationInput | null): ImpactPreview {
  const def = getDomain("supplier");
  const baseSpend = Number(base?.steel_spend ?? COMMODITY_BASE.spend);
  const baseImport = Number(base?.steel_import_exposure_pct ?? COMMODITY_BASE.importPct);
  const basePassThrough = Number(base?.pass_through_coverage_pct ?? COMMODITY_BASE.passThroughPct);
  const before = commodityRange(baseSpend, baseImport, basePassThrough);

  const { overrides } = deriveSupplierInputs(rows);
  const hasChange = rows.length > 0 && overrides.steel_spend != null;

  // Compare on the same basis as "before" (steel-specific), so the delta reflects
  // a real change in exposure assumptions — not a swap of the spend denominator.
  const afterSpend = Number(overrides.steel_spend ?? baseSpend);
  const afterImport = Number(overrides.steel_import_exposure_pct ?? baseImport);
  // Pass-through is NOT derived from supplier rows (see calibratedModelService);
  // it stays at the inferred/approved value until real pass-through data exists.
  const afterPassThrough = basePassThrough;
  const after = commodityRange(afterSpend, afterImport, afterPassThrough);

  const scoreAfter = scoreDomain("supplier", rows);
  // Tariff-exposed spend, steel-specific to match the published steel/tariff issue.
  const tariffExposed = rows
    .filter((r) => r.tariff_exposed === true && String(r.commodity ?? "").toLowerCase().includes("steel"))
    .reduce((acc, r) => acc + (Number(r.annual_spend) || 0), 0);

  const beforeLines: ImpactLine[] = [
    { label: "Commodity spend", value: fmtMoney(baseSpend), source: base?.steel_spend ? "Company model" : "Inferred benchmark" },
    { label: "Import exposed", value: `${baseImport}%`, source: "Inferred benchmark" },
    { label: "Modeled exposure", value: rangeLabel(before), source: "Scenario-modeled" },
  ];
  const afterLines: ImpactLine[] = [
    { label: "Steel-linked spend", value: fmtMoney(afterSpend), source: hasChange ? `Imported · ${rows.length} suppliers` : "Inferred benchmark" },
    { label: "Steel tariff exposure", value: tariffExposed > 0 ? fmtMoney(tariffExposed) : "—", source: hasChange ? "Supplier rows (steel commodity)" : "—" },
    { label: "Modeled exposure", value: rangeLabel(after), source: hasChange ? "Supplier-grounded scenario" : "Scenario-modeled" },
  ];

  return {
    domain: "supplier",
    label: def.label,
    hasChange,
    beforeLines,
    afterLines,
    rangeBefore: rangeLabel(before),
    rangeAfter: rangeLabel(after),
    rangeDeltaPct: hasChange ? deltaPct(before.high, after.high) : null,
    confidenceBefore: getReliabilityLabel(0),
    confidenceAfter: getReliabilityLabel(scoreAfter),
    affectedIssues: ["Tariff / steel exposure", "Procurement action"],
    remainingMissing: getMissingInputs("supplier", rows),
    summary: hasChange
      ? `Tariff/steel exposure traceable to ${rows.length} suppliers. Confidence: Scenario-modeled → ${getReliabilityLabel(scoreAfter)}.`
      : "Upload suppliers to ground tariff/steel exposure in country-of-origin and PO data.",
  };
}

// CRM impact is special: it gates opportunity promotion (Part 8).
export function calculateCrmImpact(rows: DomainRow[], _base: CompanyCalibrationInput | null): ImpactPreview & {
  promotionSupported: boolean;
  promotionReason: string;
} {
  const def = getDomain("crm");
  const { overrides } = deriveCrmInputs(rows);
  const hasChange = rows.length > 0;

  // Promotion requires segment-specific evidence + real demand growth.
  const constructionRows = rows.filter((r) => String(r.segment ?? "").toLowerCase().includes("construction"));
  const strongConstruction = constructionRows.filter((r) => {
    const quote = Number(r.quote_volume_change_pct ?? 0);
    const order = Number(r.order_growth_pct ?? 0);
    return quote >= 10 || order >= 8;
  });
  const promotionSupported = strongConstruction.length > 0;
  const promotionReason = promotionSupported
    ? `${strongConstruction.length} construction account(s) show quote/order growth above promotion threshold.`
    : constructionRows.length > 0
    ? "Construction accounts present but growth is below the promotion threshold (quote +10% or order +8%). Candidate stays blocked."
    : "No construction account-level demand evidence uploaded. Candidate stays blocked.";

  const beforeLines: ImpactLine[] = [
    { label: "Construction demand", value: "Blocked candidate", source: "No CRM evidence" },
    { label: "Account coverage", value: "0 accounts", source: "—" },
  ];
  const afterLines: ImpactLine[] = [
    { label: "Construction demand", value: promotionSupported ? "CRM-supported candidate" : "Still blocked", source: hasChange ? `${constructionRows.length} accounts` : "No CRM evidence" },
    { label: "Manufacturing revenue", value: overrides.manufacturing_revenue ? fmtMoney(Number(overrides.manufacturing_revenue)) : "—", source: hasChange ? "CRM segment revenue" : "—" },
  ];

  const scoreAfter = scoreDomain("crm", rows);
  return {
    domain: "crm",
    label: def.label,
    hasChange,
    beforeLines,
    afterLines,
    rangeBefore: null,
    rangeAfter: null,
    rangeDeltaPct: null,
    confidenceBefore: getReliabilityLabel(0),
    confidenceAfter: getReliabilityLabel(scoreAfter),
    affectedIssues: ["Construction demand candidate", "Customer/revenue model"],
    remainingMissing: getMissingInputs("crm", rows),
    summary: promotionReason,
    promotionSupported,
    promotionReason,
  };
}

// Generic reliability-only impact for domains without a direct $ issue mapping.
export function calculateGenericImpact(domain: DomainKey, rows: DomainRow[]): ImpactPreview {
  const def = getDomain(domain);
  const scoreAfter = scoreDomain(domain, rows);
  const hasChange = rows.length > 0;
  return {
    domain,
    label: def.label,
    hasChange,
    beforeLines: [{ label: "Model basis", value: "Inferred only", source: "Benchmark" }],
    afterLines: [{ label: "Model basis", value: hasChange ? `${rows.length} rows` : "Inferred only", source: hasChange ? "Imported/manual" : "Benchmark" }],
    rangeBefore: null,
    rangeAfter: null,
    rangeDeltaPct: null,
    confidenceBefore: getReliabilityLabel(0),
    confidenceAfter: getReliabilityLabel(scoreAfter),
    affectedIssues: def.affects,
    remainingMissing: getMissingInputs(domain, rows),
    summary: hasChange
      ? `${def.label} reliability improved to ${getReliabilityLabel(scoreAfter)}.`
      : `Add ${def.shortLabel.toLowerCase()} data to improve related issue reliability.`,
  };
}

export function calculateImpactForDomain(
  domain: DomainKey,
  rows: DomainRow[],
  base: CompanyCalibrationInput | null
): ImpactPreview {
  if (domain === "freight") return calculateFreightImpact(rows, base);
  if (domain === "supplier") return calculateSupplierImpact(rows, base);
  if (domain === "crm") return calculateCrmImpact(rows, base);
  return calculateGenericImpact(domain, rows);
}
