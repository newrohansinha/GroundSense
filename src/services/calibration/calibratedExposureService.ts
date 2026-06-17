// Calibration Center — labeled calibrated-exposure overlay (Part 8).
// Recomputes freight + steel/tariff exposure ranges from calibrated company data
// using the SAME shock model the scenario engine uses. This is a non-destructive
// overlay: it never overwrites the stored evidence-backed/scenario-modeled values —
// it sits alongside them, clearly labeled, so the headline can reflect real data
// without removing the evidence-backed vs scenario-modeled distinction.

import type { CompanyCalibrationInput } from "../calibrationService";

// Shock assumptions kept in sync with ScenarioEditor + calibrationImpactService.
const FREIGHT_SHOCK = { low: 3, mid: 7.5, high: 12 };
const COMMODITY_SHOCK = { low: 5, mid: 10, high: 20 };

export type CalibratedExposure = {
  low: number;
  mid: number;
  high: number;
  rangeLabel: string;
  basisLabel: string; // e.g. "Lane-calibrated", "Supplier-grounded"
  inputs: { label: string; value: string }[];
  rowCount: number;
};

function fmtMoney(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${Math.round(n)}`;
}

function rangeLabel(low: number, high: number): string {
  if (Math.round(low) === Math.round(high)) return `${fmtMoney(high)} point estimate`;
  return `${fmtMoney(low)}–${fmtMoney(high)}`;
}

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Freight: spot-exposed spend × shock. Returns null unless calibrated spend exists.
export function freightCalibratedExposure(
  cal: CompanyCalibrationInput | null,
  rowCount: number
): CalibratedExposure | null {
  const spend = numOrNull(cal?.freight_spend);
  const spotPct = numOrNull(cal?.freight_spot_rate_exposure_pct);
  if (spend === null || spend <= 0 || spotPct === null) return null;

  const spotExposed = spend * (spotPct / 100);
  const low = spotExposed * (FREIGHT_SHOCK.low / 100);
  const mid = spotExposed * (FREIGHT_SHOCK.mid / 100);
  const high = spotExposed * (FREIGHT_SHOCK.high / 100);

  return {
    low,
    mid,
    high,
    rangeLabel: rangeLabel(low, high),
    basisLabel: "Lane-calibrated",
    rowCount,
    inputs: [
      { label: "Annual freight spend", value: fmtMoney(spend) },
      { label: "Spot exposure", value: `${spotPct}%` },
      { label: "Spot-exposed spend", value: fmtMoney(spotExposed) },
    ],
  };
}

// Steel/tariff: import-exposed, unpassed spend × shock.
export function steelCalibratedExposure(
  cal: CompanyCalibrationInput | null,
  rowCount: number
): CalibratedExposure | null {
  const spend = numOrNull(cal?.steel_spend);
  const importPct = numOrNull(cal?.steel_import_exposure_pct);
  if (spend === null || spend <= 0 || importPct === null) return null;
  const passThrough = numOrNull(cal?.pass_through_coverage_pct) ?? 80;

  const importExposed = spend * (importPct / 100);
  const unpassed = importExposed * (1 - passThrough / 100);
  const low = unpassed * (COMMODITY_SHOCK.low / 100);
  const mid = unpassed * (COMMODITY_SHOCK.mid / 100);
  const high = unpassed * (COMMODITY_SHOCK.high / 100);

  return {
    low,
    mid,
    high,
    rangeLabel: rangeLabel(low, high),
    basisLabel: "Supplier-grounded",
    rowCount,
    inputs: [
      { label: "Steel-linked spend", value: fmtMoney(spend) },
      { label: "Import-exposed %", value: `${importPct}%` },
      { label: "Unpassed exposed spend", value: fmtMoney(unpassed) },
    ],
  };
}
