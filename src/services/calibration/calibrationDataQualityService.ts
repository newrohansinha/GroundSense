// Calibration Center — data quality + reliability scoring.
// Pure functions over domain rows.

import type { DomainKey, DomainRow, DomainScore } from "./types";
import { getDomain, CALIBRATION_DOMAINS } from "./calibrationDomains";

export function getReliabilityLabel(score: number): string {
  if (score >= 80) return "Company-calibrated";
  if (score >= 55) return "Partially company-calibrated";
  if (score >= 25) return "Partially calibrated";
  if (score > 0) return "Lightly calibrated";
  return "Inferred only";
}

// Coverage of a column across the row set (0..1).
// A provided boolean (true or false) counts as filled.
function columnCoverage(rows: DomainRow[], key: string): number {
  if (rows.length === 0) return 0;
  const filled = rows.filter((r) => {
    const v = r[key];
    return v !== null && v !== undefined && v !== "";
  }).length;
  return filled / rows.length;
}

// ── Realistic per-domain scoring (Part 5) ─────────────────────────────────────
// Each domain declares weighted *factors*. A factor's coverage is a 0..1 measure
// of how well the imported rows satisfy that requirement. The domain score is the
// weighted average of factor coverage, then scaled by a row-adequacy multiplier so
// thin evidence (e.g. one demo row) cannot reach "company-calibrated". This is the
// single source of truth for completeness across the whole app.

type DomainFactor = {
  key: string;
  // 0..1 — how well the row set satisfies this requirement.
  coverage: (rows: DomainRow[]) => number;
  weight: number;
};

type DomainScoreConfig = {
  // Number of well-populated rows at which the domain is considered fully evidenced.
  rowTarget: number;
  // Floor of the row-adequacy multiplier (so coverage still matters at low row counts).
  adequacyFloor: number;
  factors: DomainFactor[];
};

// Helpers ----------------------------------------------------------------------
const frac = (rows: DomainRow[], key: string) => columnCoverage(rows, key);

// Fraction of rows whose value (after lower-casing) is in the allowed set.
function fracIn(rows: DomainRow[], key: string, allowed: string[]): number {
  if (rows.length === 0) return 0;
  const set = new Set(allowed.map((a) => a.toLowerCase()));
  const ok = rows.filter((r) => set.has(String(r[key] ?? "").toLowerCase().trim())).length;
  return ok / rows.length;
}

// Distinct non-empty values present for a key.
function distinctCount(rows: DomainRow[], key: string): number {
  const seen = new Set<string>();
  for (const r of rows) {
    const v = String(r[key] ?? "").toLowerCase().trim();
    if (v) seen.add(v);
  }
  return seen.size;
}

const avg = (...xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

const DOMAIN_SCORING: Record<DomainKey, DomainScoreConfig> = {
  freight: {
    rowTarget: 5,
    adequacyFloor: 0.7,
    factors: [
      { key: "lane_spend", weight: 20, coverage: (r) => frac(r, "annual_spend") },
      { key: "lanes_exist", weight: 15, coverage: (r) => clamp01(r.length / 5) },
      { key: "spot_contract_split", weight: 20, coverage: (r) => fracIn(r, "spot_or_contract", ["spot", "contract", "mixed"]) },
      { key: "contract_coverage", weight: 15, coverage: (r) => frac(r, "contract_coverage_pct") },
      { key: "surcharge", weight: 15, coverage: (r) => frac(r, "surcharge_exposed") },
      { key: "mode_geo", weight: 10, coverage: (r) => avg(frac(r, "mode"), frac(r, "origin"), frac(r, "destination")) },
      { key: "recency", weight: 5, coverage: () => 0.5 },
    ],
  },
  supplier: {
    rowTarget: 5,
    adequacyFloor: 0.7,
    factors: [
      { key: "suppliers_exist", weight: 15, coverage: (r) => clamp01(r.length / 5) },
      { key: "annual_spend", weight: 20, coverage: (r) => frac(r, "annual_spend") },
      { key: "country_of_origin", weight: 20, coverage: (r) => frac(r, "country_of_origin") },
      { key: "tariff_exposed", weight: 15, coverage: (r) => frac(r, "tariff_exposed") },
      { key: "commodity_category", weight: 10, coverage: (r) => avg(frac(r, "commodity"), frac(r, "category")) },
      { key: "open_po", weight: 10, coverage: (r) => frac(r, "open_po_exposure") },
      { key: "landed_cost", weight: 10, coverage: (r) => avg(frac(r, "landed_cost_updated"), frac(r, "pass_through_terms")) },
    ],
  },
  crm: {
    rowTarget: 6,
    adequacyFloor: 0.6,
    factors: [
      { key: "segment_coverage", weight: 15, coverage: (r) => clamp01(distinctCount(r, "segment") / 3) },
      { key: "account_rows", weight: 15, coverage: (r) => frac(r, "account_name") * clamp01(r.length / 5) },
      { key: "pipeline_value", weight: 15, coverage: (r) => frac(r, "pipeline_value") },
      { key: "quote_trend", weight: 20, coverage: (r) => frac(r, "quote_volume_change_pct") },
      { key: "order_growth", weight: 20, coverage: (r) => frac(r, "order_growth_pct") },
      { key: "win_rate_period", weight: 10, coverage: (r) => avg(frac(r, "win_rate"), frac(r, "signal_period")) },
      { key: "segment_mapping", weight: 5, coverage: () => 0.5 },
    ],
  },
  financial: {
    rowTarget: 2,
    adequacyFloor: 0.75,
    factors: [
      { key: "revenue", weight: 15, coverage: (r) => frac(r, "revenue") },
      { key: "gross_margin_pct", weight: 15, coverage: (r) => frac(r, "gross_margin_pct") },
      { key: "cogs", weight: 15, coverage: (r) => frac(r, "cogs") },
      { key: "sgna", weight: 10, coverage: (r) => frac(r, "sgna") },
      { key: "freight_spend", weight: 15, coverage: (r) => frac(r, "freight_spend") },
      { key: "commodity_spend", weight: 15, coverage: (r) => frac(r, "commodity_spend") },
      { key: "period", weight: 10, coverage: (r) => clamp01(distinctCount(r, "period") / 2) },
      { key: "ebitda_cash", weight: 5, coverage: (r) => avg(frac(r, "ebitda"), frac(r, "cash_flow")) },
    ],
  },
  inventory: {
    rowTarget: 3,
    adequacyFloor: 0.65,
    factors: [
      { key: "category_rows", weight: 20, coverage: (r) => clamp01(r.length / 3) },
      { key: "inventory_value", weight: 20, coverage: (r) => frac(r, "inventory_value") },
      { key: "fill_rate", weight: 20, coverage: (r) => frac(r, "fill_rate_pct") },
      { key: "backorder_rate", weight: 20, coverage: (r) => frac(r, "backorder_rate_pct") },
      { key: "service_sla", weight: 10, coverage: (r) => frac(r, "service_level_sla_pct") },
      { key: "lead_time", weight: 10, coverage: (r) => frac(r, "supplier_lead_time_days") },
    ],
  },
  competitive: {
    rowTarget: 4,
    adequacyFloor: 0.6,
    factors: [
      { key: "competitor_rows", weight: 15, coverage: (r) => clamp01(r.length / 4) },
      { key: "win_loss_decided", weight: 25, coverage: (r) => fracIn(r, "win_loss", ["win", "loss"]) },
      { key: "deal_value", weight: 20, coverage: (r) => frac(r, "deal_value") },
      { key: "price_gap", weight: 15, coverage: (r) => frac(r, "price_gap_pct") },
      { key: "segment", weight: 15, coverage: (r) => frac(r, "segment") },
      { key: "account", weight: 10, coverage: (r) => frac(r, "account_name") },
    ],
  },
  outcomes: {
    // Forecast accuracy must stay low until several real outcomes are resolved.
    rowTarget: 3,
    adequacyFloor: 0.2,
    factors: [
      { key: "resolved_rows", weight: 30, coverage: (r) => clamp01(r.filter((x) => num(x.actual_impact) !== null).length / 3) },
      { key: "actual_vs_predicted", weight: 25, coverage: (r) => avg(frac(r, "actual_impact"), frac(r, "predicted_mid")) },
      { key: "protected_value", weight: 15, coverage: (r) => frac(r, "protected_value") },
      { key: "outcome_status", weight: 15, coverage: (r) => frac(r, "outcome_status") },
      { key: "accuracy_metric", weight: 15, coverage: (r) => avg(frac(r, "accuracy_class"), frac(r, "actual_metric")) },
    ],
  },
};

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Per-factor coverage for a domain (used by score + calibrated-input counting).
function factorCoverages(domain: DomainKey, rows: DomainRow[]): { key: string; coverage: number; weight: number }[] {
  const cfg = DOMAIN_SCORING[domain];
  return cfg.factors.map((f) => ({ key: f.key, coverage: clamp01(f.coverage(rows)), weight: f.weight }));
}

// Domain score: weighted factor coverage × row-adequacy multiplier. Single source of truth.
export function scoreDomain(domain: DomainKey, rows: DomainRow[]): number {
  if (rows.length === 0) return 0;
  const cfg = DOMAIN_SCORING[domain];
  const totalWeight = cfg.factors.reduce((s, f) => s + f.weight, 0);
  if (totalWeight === 0) return 0;

  const covered = factorCoverages(domain, rows).reduce((acc, f) => acc + f.weight * f.coverage, 0);
  const coverageScore = covered / totalWeight; // 0..1

  // Row adequacy: thin evidence cannot reach a full score even with rich columns.
  const adequacy = cfg.adequacyFloor + (1 - cfg.adequacyFloor) * clamp01(rows.length / cfg.rowTarget);

  return Math.round(Math.min(100, coverageScore * adequacy * 100));
}

// Number of factors a domain tracks (denominator for "X of Y inputs calibrated").
export function domainFactorCount(domain: DomainKey): number {
  return DOMAIN_SCORING[domain].factors.length;
}

// Factors considered satisfied (coverage ≥ 0.5). Zero rows ⇒ nothing calibrated.
export function domainCalibratedFactorCount(domain: DomainKey, rows: DomainRow[]): number {
  if (rows.length === 0) return 0;
  return factorCoverages(domain, rows).filter((f) => f.coverage >= 0.5).length;
}

export function getMissingInputs(domain: DomainKey, rows: DomainRow[]): string[] {
  const def = getDomain(domain);
  if (rows.length === 0) return def.criticalInputs;

  const missing: string[] = [];
  for (const col of def.columns) {
    if (!(col.required || col.recommended || (col.scoringWeight ?? 0) >= 2)) continue;
    if (columnCoverage(rows, col.key) < 0.5) {
      missing.push(col.label);
    }
  }
  // Always surface the named critical inputs not yet covered.
  for (const ci of def.criticalInputs) {
    if (!missing.includes(ci) && rows.length < 3) missing.push(ci);
  }
  return Array.from(new Set(missing)).slice(0, 5);
}

export function getWarnings(domain: DomainKey, rows: DomainRow[]): string[] {
  const warnings: string[] = [];
  if (rows.length === 0) return warnings;
  if (rows.length < 3) {
    warnings.push(`Only ${rows.length} row${rows.length === 1 ? "" : "s"} — add more for a confident calibration.`);
  }
  if (domain === "supplier") {
    const tariffNoCountry = rows.filter(
      (r) => r.tariff_exposed === true && (!r.country_of_origin || r.country_of_origin === "")
    ).length;
    if (tariffNoCountry > 0) {
      warnings.push(`${tariffNoCountry} tariff-exposed supplier(s) missing country of origin.`);
    }
  }
  if (domain === "freight") {
    const noSplit = rows.filter((r) => !r.spot_or_contract || r.spot_or_contract === "unknown").length;
    if (noSplit > 0) warnings.push(`${noSplit} lane(s) missing spot/contract classification.`);
  }
  return warnings;
}

function basisFor(domain: DomainKey, rows: DomainRow[]): string {
  if (rows.length === 0) return "Inferred benchmark assumptions";
  const def = getDomain(domain);
  return `${rows.length} ${def.shortLabel.toLowerCase()} row${rows.length === 1 ? "" : "s"} imported/entered`;
}

export function buildDomainScore(
  domain: DomainKey,
  rows: DomainRow[],
  previousScore: number,
  sourceCount: number,
  lastUpdated: string | null
): DomainScore {
  const def = getDomain(domain);
  const score = scoreDomain(domain, rows);
  const calibrated = domainCalibratedFactorCount(domain, rows);
  const required = domainFactorCount(domain);

  return {
    domain,
    label: def.label,
    score,
    previousScore,
    reliabilityLabel: getReliabilityLabel(score),
    rowCount: rows.length,
    sourceCount,
    inputsCalibrated: calibrated,
    inputsRequired: required,
    missingInputs: getMissingInputs(domain, rows),
    basis: basisFor(domain, rows),
    affects: def.affects,
    nextBestAction: def.nextBestAction,
    lastUpdated,
  };
}

// Overall operating-model reliability across all domains (weighted average).
export function scoreOverallOperatingModel(scores: DomainScore[]): number {
  if (scores.length === 0) return 0;
  // Domain weights per Part 5 — freight/supplier/CRM dominate (they map to live issues).
  const weights: Record<DomainKey, number> = {
    freight: 20,
    supplier: 20,
    crm: 20,
    financial: 15,
    inventory: 10,
    competitive: 7.5,
    outcomes: 7.5,
  };
  let acc = 0;
  let totalW = 0;
  for (const s of scores) {
    const w = weights[s.domain] ?? 1;
    acc += s.score * w;
    totalW += w;
  }
  return Math.round(acc / totalW);
}

export const ALL_DOMAIN_KEYS: DomainKey[] = CALIBRATION_DOMAINS.map((d) => d.key);
