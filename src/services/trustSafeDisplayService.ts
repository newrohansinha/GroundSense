// trustSafeDisplayService.ts
// Single source of truth for display-safe text across all dashboard components.
// No component should render raw AI-generated text without going through this service.

// ─── Types ───────────────────────────────────────────────────────────────────

type MethodologyLike = Record<string, unknown> | null | undefined;

type IssueLike = {
  risk_title?: string | null;
  title?: string | null;
  issue_category?: string | null;
  display_section?: string | null;
  executive_summary?: string | null;
  what_happened?: string | null;
  why_now?: string | null;
  business_impact?: string | null;
  risk_interaction?: string | null;
  exposure_interpretation?: string | null;
  decision_required?: string | null;
  action_required?: string | null;
  summary?: string | null;
  methodology?: MethodologyLike;
  probability?: number | null;
  confidence?: number | null;
  impact_low?: number | null;
  impact_high?: number | null;
  revenue_low?: number | null;
  revenue_high?: number | null;
  numeric_basis_type?: string | null;
};

// A metric-backed issue (numeric_shock ledger or article claim) must NEVER be
// shown with the legacy hardcoded scenario copy below — it uses its own stored,
// truthful fields. Only genuinely scenario/watch issues get the canonical text.
export function isMetricBacked(issue: IssueLike): boolean {
  return ["official_structured_metric", "manual_structured_metric", "company_structured_metric", "article_numeric_claim"]
    .includes(String(issue.numeric_basis_type ?? "no_numeric_basis"));
}

// ─── Identity helpers ────────────────────────────────────────────────────────

export function isFreightIssue(issue: IssueLike): boolean {
  const cat = String(issue.issue_category || "").toLowerCase();
  const t = String(issue.risk_title || issue.title || "").toLowerCase();
  return cat.includes("freight") || cat.includes("logistics") ||
    t.includes("freight") || t.includes("container rate") || t.includes("shipping cost");
}

export function isManufacturingOpportunity(issue: IssueLike): boolean {
  const t = String(issue.title || issue.risk_title || "").toLowerCase();
  // Manufacturing-specific mention
  if (t.includes("manufacturing") && (t.includes("demand") || t.includes("opportunity") || t.includes("growth"))) return true;
  // "Industrial Demand Growth Opportunity" and similar broad demand-signal opportunity titles
  if ((t.includes("industrial") || t.includes("demand growth")) && t.includes("opportunity")) return true;
  return false;
}

export function isTariffIssue(issue: IssueLike): boolean {
  const cat = String(issue.issue_category || "").toLowerCase();
  const t = String(issue.risk_title || issue.title || "").toLowerCase();
  return cat.includes("tariff") || cat.includes("trade") || t.includes("tariff") || t.includes("trade policy");
}

export function isWatchlistIssue(issue: IssueLike): boolean {
  return String(issue.display_section || "").toLowerCase() === "watchlist";
}

// ─── Rejected value stripping ─────────────────────────────────────────────

function getRejectedPcts(methodology: MethodologyLike): number[] {
  if (!methodology) return [];
  const calc = methodology.calculation_inputs;
  const inputs = calc && typeof calc === "object" ? (calc as Record<string, unknown>) : {};
  const rejected = inputs.rejected_explicit_shocks;
  if (!Array.isArray(rejected)) return [];
  return rejected
    .map((s: any) => Number(s?.value_pct))
    .filter((v) => Number.isFinite(v) && v > 0)
    .map((v) => Math.round(v > 2 ? v : v * 100));
}

export function stripRejectedNumbers(text: string, methodology: MethodologyLike): string {
  if (!text) return text;
  const pcts = getRejectedPcts(methodology);
  if (!pcts.length) return text;
  const sentences = text.match(/[^.!?]+[.!?]?\s*/g) || [text];
  const safe = sentences.filter(
    (s) => !pcts.some((pct) => new RegExp(`\\b${pct}\\s*%`).test(s))
  );
  return safe.join("").trim() || text;
}

// ─── Signal count / marketing noise stripping ─────────────────────────────

const SIGNAL_NOISE_PATTERNS: RegExp[] = [
  /\d+\s+signals?\s+support\s+action[^.]*\./gi,
  /\d+\s+signals?\s+(?:identified|analyzed|detected|found)?[^.]*\./gi,
  /\b[7-9]\d%\s+(?:probability|confidence|certainty)[^.]*\./gi,
  /industrial\s+demand\s+growth\s+opportunity\b[^.]*\./gi,
  /\$[\d.,]+[kKmMbB][\s–\-–]+\$[\d.,]+[kKmMbB]\s+modeled\s+upside[^.]*\./gi,
  /\bvalidated\s+opportunity\b[^.]*\./gi,
];

export function stripSignalCountMarketing(text: string): string {
  if (!text) return "";
  let cleaned = text;
  for (const p of SIGNAL_NOISE_PATTERNS) {
    cleaned = cleaned.replace(p, "");
  }
  return cleaned.trim().replace(/\s{2,}/g, " ").replace(/^\.\s*/, "");
}

// ─── Text cleanup ─────────────────────────────────────────────────────────

export function cleanTruncatedText(text: string): string {
  if (!text) return "";
  // Remove dangling words that look like truncation artifacts
  return text
    .replace(/\b(stee|pote|manu|tarri|oppo|suppl)\w*$/i, "")
    .trim()
    .replace(/[.,;:]\s*$/, "")
    .trim();
}

// ─── Canonical safe content ───────────────────────────────────────────────

const FREIGHT_RISK_SUMMARY =
  "Freight markets are tightening due to geopolitical disruption, congestion, carrier surcharges, and peak-season demand. GroundSense did not find a clean current incremental rate, so the $756K–$3.0M range is scenario-modeled.";

const FREIGHT_WHAT_CHANGED =
  "Freight market conditions have tightened due to geopolitical disruption, port congestion, carrier surcharges, and peak-season demand pressure. GroundSense evaluated available rate data but did not find a clean, current, incremental freight rate change tied directly to Fastenal-specific lanes.";

const FREIGHT_WHY_NOW =
  "Freight surcharges and spot-rate exposure are live operating decisions. Waiting to validate lane-level exposure increases risk of unbudgeted freight cost.";

const FREIGHT_DECISION_TRIGGER =
  "Escalate if spot-exposed freight spend exceeds 20% of total freight spend, new surcharges are announced on top-volume inbound lanes, or spot rates on key lanes rise more than 5% month-over-month.";

const TARIFF_OP_CHANGE_SUMMARY =
  "The verified tariff metric (25% → 15%) applies to steel-linked import exposure, creating potential procurement relief. Aluminum and copper require separate tariff metrics or supplier validation before being independently quantified. Procurement should validate supplier country-of-origin, import-category exposure, and landed-cost assumptions before treating relief as realized.";

const STEEL_TARIFF_RISK_SUMMARY =
  "The verified tariff metric (25% → 15%) applies to steel-linked import exposure, creating potential landed-cost relief. Aluminum and copper require separate tariff metrics or supplier validation before being independently quantified. The realized saving depends on supplier country-of-origin, open PO coverage, and whether suppliers have updated landed-cost assumptions.";

const STEEL_TARIFF_WHAT_CHANGED =
  "The verified tariff metric (25% → 15%) applies to steel-linked import exposure. Aluminum and copper require separate tariff metrics or supplier validation before being independently quantified. Procurement should validate which suppliers and SKUs are affected and whether landed-cost assumptions have been updated.";

const STEEL_TARIFF_WHY_NOW =
  "Tariff rates changed recently — procurement windows, open POs, and supplier contracts may still reflect the prior rate. Validating now prevents locked-in exposure from appearing as margin drag in future quarters.";

const STEEL_TARIFF_BUSINESS_IMPACT =
  "Potential landed-cost relief on steel-linked import exposure if the rate decrease (25% → 15%) flows through supplier pricing. Aluminum and copper require separate tariff metrics or supplier validation before being independently quantified. Net P&L effect depends on whether suppliers update landed costs, the import-exposed share of spend, and open PO exposure. Benefit is source-backed but not realized until procurement validates supplier landed costs, open POs, and country-of-origin exposure.";

const TARIFF_DECISION_TRIGGER =
  "Validate savings if steel-linked imports exceed $10M or suppliers have not updated landed-cost assumptions.";

const MANUFACTURING_OPP_TITLE = "Manufacturing Demand Opportunity Candidate";

const MANUFACTURING_OPP_SUMMARY =
  "Broad industrial and materials signals may indicate demand support in manufacturing accounts, but current evidence is not account-specific. Treat the $2.0M–$6.0M range as candidate upside until CRM, quote volume, or customer order data validates demand.";

const MANUFACTURING_OPP_WHAT_CHANGED =
  "Broad market and industrial signals were detected, but GroundSense did not find account-specific demand evidence for Fastenal manufacturing customers.";

const MANUFACTURING_OPP_WHY_NOW =
  "Validation is low-cost and can determine whether the candidate upside deserves a sales campaign.";

const MANUFACTURING_OPP_DECISION_TRIGGER =
  "Promote to sales campaign only if CRM/account data confirms quote growth, order strength, or customer demand in manufacturing accounts.";

const WATCHLIST_UPGRADE_TRIGGER =
  "Upgrade to modeled issue if a current source provides a new and incremental percentage, rate, cost, demand, supply, or policy movement tied to Fastenal-relevant inputs.";

// ─── Public display APIs ──────────────────────────────────────────────────

export function getRiskSummary(issue: IssueLike): string {
  if (!isMetricBacked(issue)) {
    if (isFreightIssue(issue)) return FREIGHT_RISK_SUMMARY;
    if (isTariffIssue(issue)) return STEEL_TARIFF_RISK_SUMMARY;
  }
  const raw = String(issue.business_impact || issue.executive_summary || issue.what_happened || "");
  return stripRejectedNumbers(raw, issue.methodology ?? null);
}

export function getRiskWhatChanged(issue: IssueLike): string {
  if (!isMetricBacked(issue)) {
    if (isFreightIssue(issue)) return FREIGHT_WHAT_CHANGED;
    if (isTariffIssue(issue)) return STEEL_TARIFF_WHAT_CHANGED;
  }
  const raw = String(issue.what_happened || issue.executive_summary || "");
  return stripRejectedNumbers(raw, issue.methodology ?? null);
}

export function getRiskWhyNow(issue: IssueLike): string {
  if (!isMetricBacked(issue)) {
    if (isFreightIssue(issue)) return FREIGHT_WHY_NOW;
    if (isTariffIssue(issue)) return STEEL_TARIFF_WHY_NOW;
  }
  return String(issue.why_now || "");
}

export function getRiskBusinessImpact(issue: IssueLike): string {
  if (!isMetricBacked(issue) && isTariffIssue(issue)) return STEEL_TARIFF_BUSINESS_IMPACT;
  return String((issue as Record<string, unknown>).business_impact as string || (issue as Record<string, unknown>).risk_interaction as string || "");
}

export function getDecisionTrigger(issue: IssueLike): string {
  // Metric-backed issues use their own stored, owner-specific action.
  if (isMetricBacked(issue)) {
    const stored = String(issue.decision_required || issue.action_required || "").trim();
    if (stored.length > 10) return stored.slice(0, 240);
  }
  // Freight: canonical only for scenario-backed
  if (!isMetricBacked(issue) && isFreightIssue(issue)) return FREIGHT_DECISION_TRIGGER;

  // Tariff operating change
  if (!isMetricBacked(issue) && isTariffIssue(issue) && String(issue.display_section || "").includes("operating")) {
    return TARIFF_DECISION_TRIGGER;
  }

  // Manufacturing opportunity
  if (isManufacturingOpportunity(issue)) return MANUFACTURING_OPP_DECISION_TRIGGER;

  // Watchlist
  if (isWatchlistIssue(issue)) {
    return "Upgrade to active risk when a direct adverse signal with company-specific evidence arrives.";
  }

  // Use stored field if it's not the same generic fallback text
  const stored = String(issue.decision_required || "").trim();
  if (stored && stored.length > 20 && !stored.toLowerCase().includes("monitor for escalation")) {
    return stored.slice(0, 200);
  }

  // Category-based fallbacks
  const cat = String(issue.issue_category || "").toLowerCase();
  if (cat.includes("tariff") || cat.includes("trade")) return TARIFF_DECISION_TRIGGER;
  if (cat.includes("steel") || cat.includes("metal") || cat.includes("copper")) {
    return "Escalate if supplier landed cost impact exceeds $5M or country-of-origin data is unavailable for top-spend categories.";
  }

  return "Escalate if a company-specific adverse trigger event is confirmed or exposure is validated for action.";
}

export function getOpportunityTitle(issue: IssueLike): string {
  if (isManufacturingOpportunity(issue)) return MANUFACTURING_OPP_TITLE;
  return String(issue.title || issue.risk_title || "");
}

export function getOpportunitySummary(issue: IssueLike): string {
  if (isManufacturingOpportunity(issue)) return MANUFACTURING_OPP_SUMMARY;
  const raw = String(issue.summary || "");
  return stripSignalCountMarketing(stripRejectedNumbers(raw, issue.methodology ?? null));
}

export function getOpportunityWhatChanged(issue: IssueLike): string {
  if (isManufacturingOpportunity(issue)) return MANUFACTURING_OPP_WHAT_CHANGED;
  const raw = String(issue.what_happened || "");
  return stripSignalCountMarketing(stripRejectedNumbers(raw, issue.methodology ?? null));
}

export function getOpportunityWhyNow(issue: IssueLike): string {
  if (isManufacturingOpportunity(issue)) return MANUFACTURING_OPP_WHY_NOW;
  return String(issue.why_now || "");
}

export function getOperatingChangeSummary(issue: IssueLike): string {
  if (!isMetricBacked(issue) && isTariffIssue(issue)) return TARIFF_OP_CHANGE_SUMMARY;
  const s1 = String(issue.exposure_interpretation || issue.executive_summary || issue.what_happened || "");
  const s2 = String(issue.business_impact || issue.risk_interaction || "");
  return [s1, s2].filter(Boolean).join(" ").slice(0, 400);
}

export function getOperatingChangeDecisionTrigger(issue: IssueLike): string {
  if (isTariffIssue(issue)) return TARIFF_DECISION_TRIGGER;
  return getDecisionTrigger(issue);
}

export function getWatchlistSummary(issue: IssueLike): string {
  const rawTitle = String(issue.risk_title || issue.title || "");
  const t = rawTitle.toLowerCase();
  const pctMatch = rawTitle.match(/([+-]?\d+(?:\.\d+)?)\s*%/);
  const pctNum = pctMatch ? parseFloat(pctMatch[1]) : null;

  // Trade-flow (import flow) watch — annual UN Comtrade context, NOT a current supplier disruption.
  if (t.includes("import flow") || t.includes("trade flow")) {
    const lead = rawTitle.split(/ import flow/i)[0].trim();
    const commodity = /steel|iron/i.test(lead) ? "iron/steel" : (lead.toLowerCase() || "commodity");
    const phrase = pctNum != null ? `${pctNum < 0 ? "down" : "up"} ${Math.abs(pctNum)}%` : "shifting";
    return `UN Comtrade shows US ${commodity} import flow ${phrase} in 2025. This is annual trade-flow context, not a current supplier disruption. Upgrade only if supplier country-of-origin exposure maps to affected HS categories.`;
  }

  // Demand watch — possible upside, but needs segment exposure_share + demand beta before sizing.
  if (t.includes("demand") || t.includes("durable goods") || t.includes("orders")) {
    const phrase = pctNum != null ? `${pctNum > 0 ? "+" : ""}${pctNum}%` : "moved";
    return `Durable Goods orders ${phrase} is a possible demand-upside signal held on the watchlist. Modeling a dollar impact requires a segment exposure_share and a demand beta (<1) — until those are calibrated it stays directional, not sized.`;
  }

  // Sanitize the raw fields
  const candidates = [
    issue.executive_summary,
    issue.what_happened,
    issue.business_impact,
    issue.risk_interaction,
    issue.exposure_interpretation,
  ].filter(Boolean).map(s => String(s));

  for (const c of candidates) {
    const clean = stripRejectedNumbers(c, issue.methodology ?? null);
    if (clean && clean.length > 30) {
      return clean.slice(0, 300);
    }
  }
  return "Monitoring for changes that could escalate to a modeled risk.";
}

export function getWatchlistWhyNotModeled(_issue: IssueLike): string {
  return "No current source provides a clean incremental rate, cost, supply, or demand movement tied directly to Fastenal-relevant inputs.";
}

export function getWatchlistUpgradeTrigger(issue: IssueLike): string {
  const t = String(issue.risk_title || issue.title || "").toLowerCase();
  // Specific, issue-aware upgrade triggers — never a generic catch-all.
  if (t.includes("import flow") || t.includes("trade flow")) {
    return "Upgrade when supplier country-of-origin exposure maps to the affected HS categories and a specific lane or SKU disruption is confirmed.";
  }
  if (t.includes("demand") || t.includes("durable goods") || t.includes("orders")) {
    return "Upgrade when a segment exposure_share and demand beta (<1) are calibrated, or a CRM/order signal ties the move to specific accounts.";
  }
  return WATCHLIST_UPGRADE_TRIGGER;
}

export function getForecastSummary(issue: IssueLike): string {
  if (isMetricBacked(issue)) {
    const f = (issue.methodology as Record<string, unknown> | null | undefined)?.formula;
    if (typeof f === "string" && f) return f;
    return String(issue.business_impact || issue.exposure_interpretation || issue.risk_title || issue.title || "");
  }
  if (isFreightIssue(issue)) {
    return "Source-backed logistics price pressure estimate; lane-specific freight-rate validation pending.";
  }
  if (isTariffIssue(issue)) {
    return "Tariff rate change requires procurement validation before realized savings are confirmed.";
  }
  if (isManufacturingOpportunity(issue)) {
    return "Candidate upside requires CRM/account validation before accuracy scoring.";
  }
  const raw = String(issue.executive_summary || issue.summary || "");
  const stripped = stripSignalCountMarketing(stripRejectedNumbers(raw, issue.methodology ?? null));
  return stripped.slice(0, 120) || String(issue.risk_title || issue.title || "");
}

export function getTopMetricLabels(hasOpportunities: boolean, allCandidates: boolean): {
  title: string;
  subtitle: string;
} {
  if (!hasOpportunities) return { title: "Opportunity Pipeline", subtitle: "No opportunities identified" };
  if (allCandidates) return { title: "Candidate Upside", subtitle: "Needs CRM/customer validation" };
  return { title: "Opportunity Upside", subtitle: "Scenario-modeled upside range" };
}

export function getEstimateLabel(issue: IssueLike): string {
  // Metric-backed issues carry a real, source-traced point estimate — never "scenario".
  if (isMetricBacked(issue)) {
    return String(issue.numeric_basis_type) === "article_numeric_claim"
      ? "Article-claimed estimate" : "Official metric estimate";
  }
  const cat = String(issue.issue_category || "").toLowerCase();
  if (cat.includes("tariff") || cat.includes("trade")) return "Residual exposure estimate";
  if (cat.includes("commodity") || cat.includes("steel") || cat.includes("copper")) return "Commodity exposure estimate";
  return "Scenario range";
}

function formatMoney(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000_000) {
    const v = abs / 1_000_000_000;
    return `${sign}$${v % 1 === 0 ? v.toFixed(0) : v.toFixed(1)}B`;
  }
  if (abs >= 1_000_000) {
    const v = abs / 1_000_000;
    return `${sign}$${v % 1 === 0 ? v.toFixed(0) : v.toFixed(1)}M`;
  }
  if (abs >= 1_000) {
    const v = abs / 1_000;
    return `${sign}$${v % 1 === 0 ? v.toFixed(0) : v.toFixed(1)}K`;
  }
  return `${sign}$${abs.toFixed(0)}`;
}

export function getMemoLine(context: {
  actNowRisks: IssueLike[];
  validateRisks: IssueLike[];
  topOpp: IssueLike | null;
  watchlistItems: IssueLike[];
  topChange: IssueLike | null;
  openActions: number;
  scenarioCount: number;
  needsCalibCount: number;
  totalRiskLow: number;
  totalRiskHigh: number;
  totalOppLow: number;
  totalOppHigh: number;
}): Array<{ prefix: string; className: string; text: string }> {
  const hasTariffInPublished =
    [...context.actNowRisks, ...context.validateRisks].some(r => isTariffIssue(r)) ||
    (context.topChange !== null && isTariffIssue(context.topChange));

  return [
    {
      prefix: "1. ACT NOW — Freight",
      className: "memo-act",
      text: context.actNowRisks.length > 0
        ? `Freight is the top active downside driver. GroundSense models ${formatMoney(context.totalRiskLow)}–${formatMoney(context.totalRiskHigh)} of scenario downside using inferred spot-exposed freight assumptions. No clean current incremental freight-rate percentage was found.`
        : context.totalRiskLow > 0
        ? `Top downside risk: ${formatMoney(context.totalRiskLow)}–${formatMoney(context.totalRiskHigh)} scenario range. Validate freight lane exposure before next review.`
        : "No high-priority risks requiring immediate action.",
    },
    {
      prefix: "2. VALIDATE — Tariff",
      className: "memo-validate",
      text: hasTariffInPublished
        ? "The verified tariff metric (25% → 15%) applies to steel-linked import exposure, creating potential relief. Aluminum and copper require separate tariff metrics before being independently quantified — procurement should validate supplier country-of-origin, open PO coverage, and updated landed-cost assumptions."
        : context.topChange
        ? `${String(context.topChange.risk_title || "")} — validate operating impact with procurement.`
        : "No items pending validation.",
    },
    {
      prefix: "3. WATCH / VALIDATE — Demand",
      className: "memo-watch",
      text: context.topOpp
        ? `Manufacturing demand is a candidate opportunity, not a validated upside forecast. Treat the $2.0M–$6.0M range as candidate upside until CRM, quote, or order data confirms demand.`
        : context.watchlistItems.length > 0
        ? context.watchlistItems.slice(0, 2).map(r => String(r.risk_title || "")).join(" · ")
        : "No watchlist items.",
    },
    {
      prefix: "4. OWNER ACTION",
      className: "memo-owner",
      text: context.openActions > 0
        ? `Head of Logistics should validate spot-exposed lanes, surcharge exposure, and contract coverage by Jun 22, 2026.`
        : "All actions assigned or no actions logged.",
    },
    {
      prefix: "5. MODEL CAVEAT",
      className: "memo-caveat",
      text: "Current estimates depend on inferred freight mix, contract coverage, supplier exposure, pass-through terms, and internal calibration.",
    },
  ];
}
