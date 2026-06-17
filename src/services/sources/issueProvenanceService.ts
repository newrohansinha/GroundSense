// Issue provenance (Parts 11 + 14).
// Maps a published issue to its verified external shock (if any) and produces the
// "External Shock Provenance" display, plus the external/internal/final confidence stack.
// Pure — the dashboard passes in the verified shocks it already loaded.

export type VerifiedShockRow = {
  id?: string;
  driver: string | null;
  shock_type: string | null;
  baseline_value: number | null;
  current_value: number | null;
  percent_change: number | null;
  unit: string | null;
  period_start: string | null;
  period_end: string | null;
  primary_source_id: string | null;
  verification_status: string | null;
  confidence_score: number | null;
  notes: string | null;
};

export type IssueProvenance = {
  // External shock
  hasVerifiedShock: boolean;
  externalStatusLabel: string;
  externalStatusTone: "verified" | "manual" | "support" | "article_only" | "scenario";
  shockType: string | null;
  valueUsed: string | null;
  baseline: string | null;
  current: string | null;
  percentChange: string | null;
  source: string | null;
  period: string | null;
  reason: string;
  // Confidence stack (Part 14)
  externalConfidence: ConfLevel;
  internalConfidence: ConfLevel;
  finalConfidence: ConfLevel;
};

export type ConfLevel = "high" | "medium" | "low" | "none";

const SOURCE_LABELS: Record<string, string> = {
  manual_structured_metric_csv: "Manual structured metric CSV",
  bls_public_api: "BLS Producer Price Index",
  fred_api: "FRED",
  sec_edgar_api: "SEC EDGAR",
  world_bank_indicators: "World Bank",
  census_trade_api: "Census Trade",
  usitc_dataweb_api: "USITC DataWeb",
  un_comtrade_api: "UN Comtrade",
  gdelt_doc_api: "GDELT",
};

export type IssueKind = "freight" | "tariff" | "steel" | "copper" | "aluminum" | "demand" | "other";

export function inferIssueKind(title?: string | null, category?: string | null): IssueKind {
  const t = [title, category].filter(Boolean).join(" ").toLowerCase();
  if (/freight|logistic|shipping|container|ocean/.test(t)) return "freight";
  if (/tariff|trade policy|import duty|duties/.test(t)) return "tariff";
  if (/steel|iron|rebar/.test(t)) return "steel";
  if (/copper/.test(t)) return "copper";
  if (/alumin/.test(t)) return "aluminum";
  if (/demand|construction|manufactur/.test(t)) return "demand";
  return "other";
}

function kindMatchesDriver(kind: IssueKind, driver: string | null): boolean {
  if (!driver) return false;
  const d = driver.toLowerCase();
  switch (kind) {
    case "freight": return /freight|logistic|shipping|container/.test(d);
    case "tariff": return /tariff|trade|duty/.test(d);
    case "steel": return /steel|metal|iron|ppi/.test(d);
    case "copper": return /copper/.test(d);
    case "aluminum": return /alumin/.test(d);
    case "demand": return /demand|macro|gdp/.test(d);
    default: return false;
  }
}

function fmtVal(v: number | null, unit: string | null): string | null {
  if (v === null || v === undefined) return null;
  const u = unit ?? "";
  if (u === "USD" || u === "$") {
    if (Math.abs(v) >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
    if (Math.abs(v) >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
    return `$${v.toLocaleString()}`;
  }
  if (u === "%") return `${v}%`;
  return `${v.toLocaleString()}${u ? ` ${u}` : ""}`;
}

function confFromScore(score: number | null): ConfLevel {
  if (score === null) return "none";
  if (score >= 75) return "high";
  if (score >= 50) return "medium";
  if (score > 0) return "low";
  return "none";
}

function verifiedTone(status: string | null): "verified" | "manual" | "article_only" | "scenario" {
  switch (status) {
    case "verified_manual_structured_metric": return "manual";
    case "verified_official_source":
    case "verified_public_metric":
    case "corroborated_by_multiple_sources": return "verified";
    case "article_claim_only":
    case "conflicting_sources": return "article_only";
    default: return "scenario";
  }
}

// Build provenance for an issue. `hasCalibratedOverlay` = company calibration drives the
// exposure base (internal confidence). Verified shock drives external confidence.
export function buildIssueProvenance(
  opts: { title?: string | null; category?: string | null; hasCalibratedOverlay: boolean },
  shocks: VerifiedShockRow[]
): IssueProvenance {
  const kind = inferIssueKind(opts.title, opts.category);

  // Best matching verified shock for this issue's driver.
  const matched = shocks
    .filter((s) => kindMatchesDriver(kind, s.driver))
    .sort((a, b) => (b.confidence_score ?? 0) - (a.confidence_score ?? 0))[0] ?? null;

  const internalConfidence: ConfLevel = opts.hasCalibratedOverlay ? "high" : "low";

  if (matched && verifiedTone(matched.verification_status) !== "scenario" && verifiedTone(matched.verification_status) !== "article_only") {
    const tone = verifiedTone(matched.verification_status);
    const isBlsPpi = matched.primary_source_id === "bls_public_api";
    const common = {
      shockType: (matched.shock_type ?? "").replace(/_/g, " "),
      valueUsed: fmtVal(matched.current_value, matched.unit),
      baseline: fmtVal(matched.baseline_value, matched.unit),
      current: fmtVal(matched.current_value, matched.unit),
      percentChange: matched.percent_change !== null ? `${matched.percent_change}%` : null,
      source: SOURCE_LABELS[matched.primary_source_id ?? ""] ?? matched.primary_source_id ?? "Structured metric",
      period: matched.period_end ?? null,
      internalConfidence,
    };

    // BLS PPI is a public PRICE-PRESSURE indicator — supporting context, never a
    // lane-verified freight rate or a company-specific exposure. Label it as support.
    if (isBlsPpi) {
      const externalConfidence: ConfLevel = "low";
      return {
        hasVerifiedShock: true,
        externalStatusLabel: "Supporting public price metric (BLS PPI)",
        externalStatusTone: "support",
        ...common,
        reason:
          kind === "freight"
            ? "BLS transportation/freight PPI supports public logistics price pressure. Lane-specific freight-rate validation remains pending until a freight-index CSV is uploaded."
            : "Public producer-price index corroborates price pressure. Not a company-specific exposure by itself.",
        externalConfidence,
        finalConfidence: combine(externalConfidence, internalConfidence),
      };
    }

    const externalConfidence = confFromScore(matched.confidence_score);
    return {
      hasVerifiedShock: true,
      externalStatusLabel: tone === "manual" ? "Verified manual structured metric" : "Verified official source",
      externalStatusTone: tone,
      ...common,
      reason: matched.notes ?? "Backed by a trusted structured metric.",
      externalConfidence,
      finalConfidence: combine(externalConfidence, internalConfidence),
    };
  }

  // No verified shock — scenario / article-only fallback, kind-specific.
  const fallback = scenarioFallback(kind);
  return {
    hasVerifiedShock: false,
    externalStatusLabel: fallback.label,
    externalStatusTone: fallback.tone,
    shockType: null,
    valueUsed: null,
    baseline: null,
    current: null,
    percentChange: null,
    source: fallback.source,
    period: null,
    reason: fallback.reason,
    externalConfidence: "none",
    internalConfidence,
    finalConfidence: combine("none", internalConfidence),
  };
}

function scenarioFallback(kind: IssueKind): { label: string; tone: "article_only" | "scenario"; reason: string; source: string } {
  switch (kind) {
    case "freight":
      return {
        label: "Scenario assumption only",
        tone: "scenario",
        reason: "No free structured freight-rate source is configured for this lane. Article context supports monitoring, but exposure uses scenario shocks. Upload freight_index_template.csv to verify.",
        source: "Scenario assumption",
      };
    case "copper":
    case "aluminum":
      return {
        label: "Article claim only / pending review",
        tone: "article_only",
        reason: "Broad macro article did not match a verified commodity metric or company exposure mapping. Configure FRED or upload commodity_price_template.csv to verify.",
        source: "Article claim",
      };
    case "tariff":
      return {
        label: "Article claim only — verify with structured metric",
        tone: "article_only",
        reason: "No verified tariff metric yet. Upload tariff_metric_template.csv (or configure USITC) to make this evidence-backed.",
        source: "Article claim",
      };
    default:
      return {
        label: "Scenario assumption only",
        tone: "scenario",
        reason: "No verified external metric for this driver. Exposure uses scenario assumptions until a structured source is configured or uploaded.",
        source: "Scenario assumption",
      };
  }
}

const RANK: Record<ConfLevel, number> = { none: 0, low: 1, medium: 2, high: 3 };
const UNRANK: ConfLevel[] = ["none", "low", "medium", "high"];

// Final exposure confidence = the weaker of external and internal (a chain is as strong
// as its weakest link), nudged up one notch only when BOTH are at least medium.
function combine(external: ConfLevel, internal: ConfLevel): ConfLevel {
  const lo = Math.min(RANK[external], RANK[internal]);
  if (RANK[external] >= 2 && RANK[internal] >= 2) return UNRANK[Math.min(3, lo + 1)];
  return UNRANK[lo];
}
