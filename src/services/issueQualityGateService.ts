// Issue quality gate — evaluates generated candidates before dashboard publication.
// Every candidate risk/opportunity passes through here.
// Weak or misaligned items are quarantined, not published to executive sections.

import {
  classifyEvidenceItems,
  computeEvidenceAlignment,
  type ClassifiedEvidenceClaim,
} from "./evidenceClaimService";

export type GateDecision = "publish" | "watchlist" | "candidate_review" | "quarantine";

export type IssueGateResult = {
  decision: GateDecision;
  qualityScore: number;
  evidenceAlignmentScore: number;
  companyRelevanceScore: number;
  forecastEligible: boolean;
  reasons: string[];
  requiredToPromote: string[];
  claims: ClassifiedEvidenceClaim[];
  alignedCount: number;
  irrelevantCount: number;
  evidenceCount: number;
};

// ─── Driver inference from issue metadata ────────────────────────────────────

function inferDriver(
  issueTitle: string | null | undefined,
  riskType: string | null | undefined,
  issueCategory: string | null | undefined
): string {
  const text = [issueTitle, riskType, issueCategory].filter(Boolean).join(" ").toLowerCase();
  if (/freight|logistic|shipping|transport|container/i.test(text)) return "freight_logistics_cost";
  if (/tariff|trade\s*policy|import\s*duty/i.test(text)) return "tariff_trade_policy";
  if (/steel|iron\s*ore|hot.rolled|cold.rolled|scrap\s*metal/i.test(text)) return "steel_metals_pricing";
  if (/copper/i.test(text)) return "copper_pricing";
  if (/aluminum|aluminium/i.test(text)) return "aluminum_pricing";
  if (/construction.*demand|construction.*opportunit/i.test(text)) return "construction_demand";
  if (/manufactur.*demand|industrial\s*demand/i.test(text)) return "manufacturing_demand";
  if (/competitor|competi/i.test(text)) return "competitor_pressure";
  if (/supplier\s*concentration|sole\s*source/i.test(text)) return "supplier_concentration";
  if (/backorder|fill\s*rate|service\s*level/i.test(text)) return "service_level_backorders";
  // Broad demand signal — treat as manufacturing_demand for alignment check
  if (/demand|customer|revenue\s*opportunity/i.test(text)) return "manufacturing_demand";
  return "irrelevant";
}

// ─── Risk gate ────────────────────────────────────────────────────────────────
// Risks are generally more defensible than opportunities.
// We only quarantine if evidence is completely unrelated AND driver is unknown.
// Scenario-modeled risks with a valid driver always publish with appropriate labeling.

export function evaluateRiskGate(risk: {
  id: string;
  risk_title?: string | null;
  risk_type?: string | null;
  issue_category?: string | null;
  display_section?: string | null;
  confidence?: number | null;
  evidence_items?: { title?: string; source?: string; [key: string]: unknown }[] | null;
  methodology?: { calibration_status?: string; formula_status?: string } | null;
}): IssueGateResult {
  const evidenceItems = risk.evidence_items || [];
  const driver = inferDriver(risk.risk_title, risk.risk_type, risk.issue_category);
  const claims = classifyEvidenceItems(evidenceItems, driver);
  const alignment = computeEvidenceAlignment(claims, driver);
  const confidence = Math.max(0, Math.min(100, Number(risk.confidence || 50)));

  // Hard quarantine: evidence is completely unrelated, driver is unknown, no causal chain
  if (
    driver === "irrelevant" &&
    claims.length >= 2 &&
    alignment.irrelevantCount === claims.length
  ) {
    return {
      decision: "quarantine",
      qualityScore: 10,
      evidenceAlignmentScore: 0,
      companyRelevanceScore: 5,
      forecastEligible: false,
      reasons: [
        "Evidence does not align with any known operating driver for this company.",
        `All ${claims.length} evidence items are unrelated to the risk claim.`,
      ],
      requiredToPromote: [
        "Evidence specifically linking the claimed risk to Fastenal operations or supply chain.",
        "Clear causal chain from external event to financial impact.",
      ],
      claims,
      alignedCount: alignment.alignedCount,
      irrelevantCount: alignment.irrelevantCount,
      evidenceCount: evidenceItems.length,
    };
  }

  // Candidate review: broad-market commodity price signals with no direct company exposure.
  // Copper and aluminum price moves driven by geopolitical/macro factors need direct exposure
  // evidence (supplier spend, inventory valuation, COGS impact) before becoming a published risk.
  const isBroadMacroCommodity = ["copper_pricing", "aluminum_pricing"].includes(driver);
  const allBroadOrUnrelated = claims.length > 0 && claims.every(
    c => c.evidence_directness === "broad_market" || c.evidence_directness === "unrelated"
  );
  const hasDirectExposureEvidence = claims.some(
    c => c.evidence_directness === "company_specific" || c.evidence_directness === "industry_specific"
  );

  if (isBroadMacroCommodity && allBroadOrUnrelated && !hasDirectExposureEvidence && claims.length >= 1) {
    return {
      decision: "candidate_review",
      qualityScore: Math.round(alignment.alignmentScore * 0.25 + confidence * 0.15),
      evidenceAlignmentScore: alignment.alignmentScore,
      companyRelevanceScore: 20,
      forecastEligible: false,
      reasons: [
        `${driver === "copper_pricing" ? "Copper" : "Aluminum"} price signal is broad-market macro — no direct company exposure evidence.`,
        "Price movement attributed to geopolitical or macro factors requires Fastenal-specific commodity spend data before sizing.",
        "Cannot produce a defensible dollar forecast from broad market price reporting alone.",
      ],
      requiredToPromote: [
        `Direct evidence of Fastenal ${driver === "copper_pricing" ? "copper" : "aluminum"} or related product spend exposure.`,
        "Supplier-level commodity pricing impact on Fastenal COGS.",
        "Inventory valuation or margin exposure with company-specific data.",
        "Customer demand signal linking commodity price movement to Fastenal revenue.",
      ],
      claims,
      alignedCount: alignment.alignedCount,
      irrelevantCount: alignment.irrelevantCount,
      evidenceCount: evidenceItems.length,
    };
  }

  const qualityScore = Math.round(
    alignment.alignmentScore * 0.4 +
    confidence * 0.3 +
    (evidenceItems.length > 0 ? 20 : 0) +
    (driver !== "irrelevant" ? 10 : 0)
  );

  const forecastEligible =
    alignment.alignmentScore >= 30 && confidence >= 50 && driver !== "irrelevant";

  return {
    decision: "publish",
    qualityScore,
    evidenceAlignmentScore: alignment.alignmentScore,
    companyRelevanceScore: driver !== "irrelevant" ? Math.max(40, alignment.alignmentScore) : 20,
    forecastEligible,
    reasons: [],
    requiredToPromote: [],
    claims,
    alignedCount: alignment.alignedCount,
    irrelevantCount: alignment.irrelevantCount,
    evidenceCount: evidenceItems.length,
  };
}

// ─── Opportunity gate ────────────────────────────────────────────────────────
// Opportunities face a stricter gate than risks:
// - ALL evidence must be at least partially relevant to the claimed opportunity driver
// - Items with mostly-irrelevant evidence are quarantined
// - Items with partial alignment go to candidate_review

export function evaluateOpportunityGate(opportunity: {
  id: string;
  title?: string | null;
  summary?: string | null;
  confidence?: number | null;
  evidence_items?: { title?: string; source?: string; [key: string]: unknown }[] | null;
  methodology?: { calibration_status?: string } | null;
}): IssueGateResult {
  const evidenceItems = opportunity.evidence_items || [];
  const driver = inferDriver(opportunity.title, null, null);
  const claims = classifyEvidenceItems(evidenceItems, driver);
  const alignment = computeEvidenceAlignment(claims, driver);
  const confidence = Math.max(0, Math.min(100, Number(opportunity.confidence || 30)));

  // Hard quarantine: all or most evidence is irrelevant/noise
  const allIrrelevant =
    claims.length > 0 && claims.every(
      (c) => c.driver === "irrelevant" || c.claim_type === "irrelevant_or_noise"
    );
  const mostlyIrrelevant =
    claims.length > 0 &&
    alignment.irrelevantCount > 0 &&
    alignment.irrelevantCount / claims.length > 0.5 &&
    alignment.alignedCount === 0;

  if (allIrrelevant || mostlyIrrelevant) {
    const irrelevantTitles = claims
      .filter((c) => c.driver === "irrelevant" || c.claim_type === "irrelevant_or_noise")
      .map((c) => c.title)
      .slice(0, 3);

    const requiredToPromote = buildRequiredToPromote(driver);

    return {
      decision: "quarantine",
      qualityScore: Math.round(confidence * 0.1),
      evidenceAlignmentScore: alignment.alignmentScore,
      companyRelevanceScore: 5,
      forecastEligible: false,
      reasons: [
        `${alignment.irrelevantCount} of ${claims.length} evidence items are unrelated to the claimed opportunity.`,
        `Supporting evidence does not establish ${formatDriver(driver)} demand or upside for this company.`,
        ...irrelevantTitles.map((t) => `"${t.slice(0, 80)}" — unrelated`),
      ],
      requiredToPromote,
      claims,
      alignedCount: alignment.alignedCount,
      irrelevantCount: alignment.irrelevantCount,
      evidenceCount: evidenceItems.length,
    };
  }

  // Candidate review: partial alignment (< 50%)
  if (alignment.alignmentScore < 50) {
    return {
      decision: "candidate_review",
      qualityScore: Math.round(alignment.alignmentScore * 0.4 + confidence * 0.2),
      evidenceAlignmentScore: alignment.alignmentScore,
      companyRelevanceScore: Math.round(alignment.alignmentScore * 0.5),
      forecastEligible: false,
      reasons: [
        `Partial evidence alignment (${alignment.alignmentScore}%). Missing direct demand signal.`,
        `${alignment.alignedCount} of ${claims.length} evidence items relate to the opportunity driver.`,
      ],
      requiredToPromote: buildRequiredToPromote(driver),
      claims,
      alignedCount: alignment.alignedCount,
      irrelevantCount: alignment.irrelevantCount,
      evidenceCount: evidenceItems.length,
    };
  }

  // Publish: good alignment
  const qualityScore = Math.round(
    alignment.alignmentScore * 0.4 + confidence * 0.3 + (evidenceItems.length > 2 ? 20 : 10)
  );
  const forecastEligible = alignment.alignmentScore >= 60 && confidence >= 50;

  return {
    decision: "publish",
    qualityScore,
    evidenceAlignmentScore: alignment.alignmentScore,
    companyRelevanceScore: Math.round(alignment.alignmentScore * 0.8),
    forecastEligible,
    reasons: [],
    requiredToPromote: [],
    claims,
    alignedCount: alignment.alignedCount,
    irrelevantCount: alignment.irrelevantCount,
    evidenceCount: evidenceItems.length,
  };
}

// ─── Batch evaluation ─────────────────────────────────────────────────────────

export function runQualityGateOnAll(
  risks: Parameters<typeof evaluateRiskGate>[0][],
  opportunities: Parameters<typeof evaluateOpportunityGate>[0][]
): Map<string, IssueGateResult> {
  const results = new Map<string, IssueGateResult>();
  for (const r of risks) results.set(r.id, evaluateRiskGate(r));
  for (const o of opportunities) results.set(o.id, evaluateOpportunityGate(o));
  return results;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDriver(driver: string): string {
  return driver.replace(/_/g, " ");
}

function buildRequiredToPromote(driver: string): string[] {
  const base = [
    "Customer or segment-specific demand signal (CRM data, order growth, quote volume).",
    "Industry publication reporting demand directly relevant to industrial MRO distribution.",
  ];

  const driverSpecific: Record<string, string[]> = {
    construction_demand: [
      "Construction customer order trend or quote volume increase.",
      "Construction spending data tied to industrial fasteners or MRO demand.",
      "Fastenal construction-segment account growth or pipeline evidence.",
    ],
    manufacturing_demand: [
      "Manufacturing account order growth or CRM pipeline expansion.",
      "ISM, PMI, or segment-specific manufacturing demand data.",
    ],
    competitor_pressure: [
      "Win/loss data showing account displacement or competitive pricing pressure.",
    ],
  };

  return [...(driverSpecific[driver] ?? []), ...base];
}
