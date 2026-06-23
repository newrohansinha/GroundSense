// Executive Point-Estimate Mode (presentation/view-model layer).
// Converts internal ranges + verified shocks + calibration into a single source-backed
// point estimate per issue, with provenance. NEVER overwrites risk_register values — the
// original ranges live on and are only shown inside collapsed methodology/audit sections.

import type { CompanyCalibrationInput } from "../calibrationService";
import { inferIssueKind, type IssueKind, type VerifiedShockRow } from "../sources/issueProvenanceService";

// Default ON for the demo/presentation. (Single source of truth.)
export const EXECUTIVE_POINT_ESTIMATE_MODE = true;

export function shouldShowRangeInExecutiveMode(): boolean {
  return !EXECUTIVE_POINT_ESTIMATE_MODE;
}

export type ExecConfidence = "Low" | "Medium" | "Medium-high" | "High" | "Needs validation";

export type ExecutiveEstimate = {
  kind: IssueKind;
  // Dollar value of the point estimate, or null when not dollarizable.
  value: number | null;
  isDollar: boolean;
  // Executive-safe display: "~$145K", "Needs validation", "Supporting signal", etc.
  display: string;
  title: string;
  sourceLabel: string;
  confidence: ExecConfidence;
  calculation: string | null;
  sources: { label: string; value: string }[];
  caveat: string | null;
};

type IssueLike = {
  risk_title?: string | null;
  title?: string | null;
  issue_category?: string | null;
  impact_low?: number | null;
  impact_high?: number | null;
  revenue_low?: number | null;
  revenue_high?: number | null;
  // Canonical numeric-shock-ledger basis fields (single source of truth).
  numeric_basis_type?: string | null;
  numeric_basis_value?: number | null;
  numeric_basis_unit?: string | null;
  numeric_basis_source_label?: string | null;
  numeric_basis_source_url?: string | null;
  numeric_basis_snippet?: string | null;
  methodology?: Record<string, unknown> | null;
};

const METRIC_BACKED = new Set([
  "official_structured_metric",
  "manual_structured_metric",
  "company_structured_metric",
  "article_numeric_claim",
]);

// ── Rounding (no fake precision) ──────────────────────────────────────────────
export function roundExec(value: number): number {
  const abs = Math.abs(value);
  // Finer granularity below $250K so small but real estimates aren't distorted
  // (e.g. $62K must read ~$60K, not ~$50K). Larger tiers keep coarse rounding.
  if (abs < 250_000) return Math.round(value / 5_000) * 5_000;           // nearest $5K
  if (abs < 1_000_000) return Math.round(value / 25_000) * 25_000;       // nearest $25K
  if (abs < 10_000_000) return Math.round(value / 100_000) * 100_000;    // nearest $0.1M
  return Math.round(value / 1_000_000) * 1_000_000;                       // nearest $1M
}

function fmtRounded(value: number): string {
  const v = roundExec(value);
  const abs = Math.abs(v);
  if (abs >= 1_000_000_000) return `$${(v / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${Math.round(v / 1_000)}K`;
  return `$${Math.round(v)}`;
}

// "~$145K" for modeled estimates.
export function formatExecutiveEstimate(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "Needs validation";
  if (Math.round(roundExec(value)) === 0) return "<$25K";
  return `~${fmtRounded(value)}`;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ── Per-issue executive estimate ──────────────────────────────────────────────
export function getExecutiveImpactEstimate(
  issue: IssueLike,
  _verifiedShocks: VerifiedShockRow[],
  _calibration: CompanyCalibrationInput | null
): ExecutiveEstimate {
  const title = issue.risk_title ?? issue.title ?? "";
  const kind = inferIssueKind(title, issue.issue_category);

  // ── Canonical path: the numeric_shock-ledger basis stored on the row is the
  // single source of truth. The displayed dollar = stored impact_high, the
  // displayed formula = methodology.formula, the source = numeric_basis_source.
  // This is the SAME number the risk card, brief, and DB all use — no recompute
  // from the legacy verified_shocks table (which is empty and produced the
  // "scenario assumption / +0.8%" contradictions).
  const nbType = String(issue.numeric_basis_type ?? "no_numeric_basis");
  const high = num(issue.impact_high);
  const meth = (issue.methodology ?? {}) as Record<string, unknown>;
  const formula = typeof meth.formula === "string" && meth.formula ? (meth.formula as string) : null;
  const nbValue = num(issue.numeric_basis_value);
  const nbUnit = issue.numeric_basis_unit ?? "pct";
  const srcLabel = issue.numeric_basis_source_label ?? null;
  const snippet = issue.numeric_basis_snippet ?? null;

  if (METRIC_BACKED.has(nbType) && high !== null && high !== 0) {
    const official = nbType !== "article_numeric_claim";
    const changeStr = nbValue !== null ? `${nbValue > 0 ? "+" : ""}${nbValue}${nbUnit === "pct" ? "%" : nbUnit}` : "";
    return {
      kind,
      value: high,
      isDollar: true,
      display: formatExecutiveEstimate(high),
      title,
      sourceLabel: official ? `Official metric · ${srcLabel ?? "source"}` : `Article-claimed · ${srcLabel ?? "source"}`,
      confidence: official ? "Medium-high" : "Low",
      calculation: formula,
      sources: [
        { label: official ? "Official metric" : "Article claim", value: `${srcLabel ?? "source"}${changeStr ? ` · ${changeStr}` : ""}` },
        ...(snippet ? [{ label: "Basis", value: String(snippet).slice(0, 140) }] : []),
      ],
      caveat: official ? null : "Article-claimed metric — validation required before treating as confirmed.",
    };
  }

  // No numeric basis → genuinely scenario / needs validation. Published issues
  // never reach here (the gate requires a numeric basis); only watch items do.
  return genericEstimate(issue, kind);
}

function scenarioFallback(issue: IssueLike, kind: IssueKind, title: string, why: string): ExecutiveEstimate {
  const low = num(issue.impact_low);
  const high = num(issue.impact_high);
  if (low !== null && high !== null && (low > 0 || high > 0)) {
    const mid = (low + high) / 2;
    return {
      kind,
      value: mid,
      isDollar: true,
      display: formatExecutiveEstimate(mid),
      title,
      sourceLabel: "Scenario assumption",
      confidence: "Low",
      calculation: "Scenario midpoint of the modeled exposure (no verified external metric yet).",
      sources: [{ label: "Basis", value: "Scenario-modeled" }],
      caveat: why,
    };
  }
  return {
    kind, value: null, isDollar: false, display: "Needs validation", title,
    sourceLabel: "Needs validation", confidence: "Needs validation", calculation: null,
    sources: [], caveat: why,
  };
}

function genericEstimate(issue: IssueLike, kind: IssueKind): ExecutiveEstimate {
  return scenarioFallback(issue, kind, issue.risk_title ?? issue.title ?? "Operating issue", "No verified external metric for this driver — using scenario assumption.");
}

// Sum the dollarizable executive estimates (for the top Risk Exposure metric).
export function sumExecutiveEstimates(estimates: ExecutiveEstimate[]): number {
  return estimates.reduce((acc, e) => acc + (e.isDollar && e.value ? roundExec(e.value) : 0), 0);
}
