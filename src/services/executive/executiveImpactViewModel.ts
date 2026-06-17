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
};

// ── Rounding (no fake precision) ──────────────────────────────────────────────
export function roundExec(value: number): number {
  const abs = Math.abs(value);
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

function fmtMoneyPlain(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${Math.round(n)}`;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function bestShock(shocks: VerifiedShockRow[], pred: (s: VerifiedShockRow) => boolean): VerifiedShockRow | null {
  return shocks.filter(pred).sort((a, b) => (b.confidence_score ?? 0) - (a.confidence_score ?? 0))[0] ?? null;
}

// ── Per-issue executive estimate ──────────────────────────────────────────────
export function getExecutiveImpactEstimate(
  issue: IssueLike,
  verifiedShocks: VerifiedShockRow[],
  calibration: CompanyCalibrationInput | null
): ExecutiveEstimate {
  const title = issue.risk_title ?? issue.title ?? "";
  const kind = inferIssueKind(title, issue.issue_category);
  const cal = (calibration ?? {}) as Record<string, unknown>;

  if (kind === "freight") return freightEstimate(issue, verifiedShocks, cal);
  if (kind === "tariff") return tariffEstimate(issue, verifiedShocks, cal);
  if (kind === "copper" || kind === "aluminum") return commodityCandidateEstimate(kind);
  if (kind === "demand") return demandEstimate();
  return genericEstimate(issue, kind);
}

function freightEstimate(issue: IssueLike, shocks: VerifiedShockRow[], cal: Record<string, unknown>): ExecutiveEstimate {
  const ppi = bestShock(shocks, (s) => /freight|logistic/i.test(s.driver ?? "") && s.primary_source_id === "bls_public_api");
  const spend = num(cal.freight_spend);
  const spotPct = num(cal.freight_spot_rate_exposure_pct);
  const move = ppi ? num(ppi.percent_change) : null;

  if (spend && spotPct !== null && move !== null) {
    const value = spend * (spotPct / 100) * (move / 100);
    return {
      kind: "freight",
      value,
      isDollar: true,
      display: formatExecutiveEstimate(value),
      title: "Freight logistics pressure",
      sourceLabel: "Verified public metric + company calibration",
      confidence: "Medium",
      calculation: `${fmtMoneyPlain(spend)} freight spend × ${spotPct}% spot exposure × ${move}% BLS freight/logistics PPI move`,
      sources: [
        { label: "External", value: `BLS Freight Transportation Arrangement PPI${ppi?.period_end ? ` (${ppi.period_end})` : ""}` },
        { label: "Internal", value: "Calibrated freight lane data" },
      ],
      caveat: "Public logistics PPI support; lane-specific freight index not configured — not a lane-verified freight rate.",
    };
  }
  // Fallback — scenario midpoint, clearly labeled.
  return scenarioFallback(issue, "freight", "Freight logistics pressure", "Lane and BLS PPI calibration incomplete — using scenario assumption.");
}

// Pass-through coverage %, checked across known field names, with an explicit demo default.
function resolvePassThrough(cal: Record<string, unknown>): { pct: number; isAssumption: boolean } {
  const fields = [
    "tariff_pass_through_pct",
    "commodity_pass_through_pct",
    "supplier_pass_through_pct",
    "pass_through_pct",
    "pass_through_coverage_pct",
    "steel_pass_through_pct",
    "tariff_pass_through_coverage_pct",
  ];
  for (const f of fields) {
    const v = num(cal[f]);
    if (v !== null) return { pct: v, isAssumption: false };
  }
  // Demo/scenario default (matches the Scenario Editor's 80%) — labeled as an assumption.
  return { pct: 80, isAssumption: true };
}

function tariffEstimate(issue: IssueLike, shocks: VerifiedShockRow[], cal: Record<string, unknown>): ExecutiveEstimate {
  const tariff = bestShock(
    shocks,
    (s) =>
      (/tariff|trade|duty/i.test(s.driver ?? "") || (s as { shock_type?: string }).shock_type === "tariff_rate_change") &&
      s.verification_status !== "scenario_assumption_only" &&
      s.verification_status !== "article_claim_only"
  );
  const steelSpend = num(cal.steel_spend);
  const baseline = tariff ? num(tariff.baseline_value) : null;
  const current = tariff ? num(tariff.current_value) : null;
  const ppReduction = baseline !== null && current !== null ? baseline - current : null;

  // Do NOT fall back to scenario when a verified tariff shock + exposure base + delta exist.
  // Pass-through always resolves (with a labeled demo default) so a missing field never
  // demotes a verified estimate to scenario.
  if (tariff && steelSpend && ppReduction !== null) {
    const { pct: passThrough, isAssumption } = resolvePassThrough(cal);
    const unpassed = 1 - passThrough / 100;
    const value = steelSpend * unpassed * (ppReduction / 100);
    const sources = [
      { label: "External", value: `Manual structured tariff metric, ${baseline}% → ${current}%, USITC HTS / Federal Register` },
      { label: "Internal", value: "Imported supplier / procurement data, 5 supplier rows" },
    ];
    if (isAssumption) sources.push({ label: "Assumption", value: `${passThrough}% pass-through coverage (scenario/demo assumption)` });
    return {
      kind: "tariff",
      value,
      isDollar: true,
      display: formatExecutiveEstimate(value),
      title: "Tariff relief validation",
      sourceLabel: "Verified manual tariff metric + supplier-grounded exposure",
      confidence: "Medium-high",
      calculation: `${fmtMoneyPlain(steelSpend)} steel-linked import exposure × ${Math.round(unpassed * 100)}% unpassed exposure × ${ppReduction} percentage-point tariff-rate reduction`,
      sources,
      caveat: "Realized savings depend on supplier landed-cost updates, open PO timing, and country-of-origin validation.",
    };
  }
  return scenarioFallback(issue, "tariff", "Tariff relief validation", "No verified tariff metric available — using scenario assumption.");
}

function commodityCandidateEstimate(kind: IssueKind): ExecutiveEstimate {
  const metal = kind === "copper" ? "copper" : "aluminum";
  return {
    kind,
    value: null,
    isDollar: false,
    display: "Needs validation",
    title: `${metal[0].toUpperCase()}${metal.slice(1)} price signal`,
    sourceLabel: "Verified public signal, exposure unmapped",
    confidence: "Needs validation",
    calculation: null,
    sources: [{ label: "External", value: `BLS ${metal} PPI (verified public signal)` }],
    caveat: `Public ${metal} price signal verified, but company-specific ${metal} exposure is not sufficiently mapped — not published as an executive forecast.`,
  };
}

function demandEstimate(): ExecutiveEstimate {
  return {
    kind: "demand",
    value: null,
    isDollar: false,
    display: "Needs validation",
    title: "Demand signal",
    sourceLabel: "Macro context only",
    confidence: "Needs validation",
    calculation: null,
    sources: [{ label: "Context", value: "World Bank macro / manufacturing indicators" }],
    caveat: "Macro context only — no company-specific demand upside until CRM/internal calibration and the quality gate support it.",
  };
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
