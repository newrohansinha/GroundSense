// issueSummaryService.ts
// Central trust-safe summary layer.
// Rejected values never appear outside Model Audit / Evidence Detail sections.

type MethodologyLike = Record<string, unknown> | null | undefined;

// ---------------------------------------------------------------------------
// Rejected value detection
// ---------------------------------------------------------------------------

function getRejectedShockPcts(methodology: MethodologyLike): number[] {
  if (!methodology) return [];
  const calc = methodology.calculation_inputs;
  const inputs: Record<string, unknown> =
    calc && typeof calc === "object" ? (calc as Record<string, unknown>) : {};
  const rejected = inputs.rejected_explicit_shocks;
  if (!Array.isArray(rejected)) return [];
  return rejected
    .map((s: any) => Number(s?.value_pct))
    .filter((v) => Number.isFinite(v) && v > 0)
    .map((v) => Math.round(v > 2 ? v : v * 100));
}

function isCumulativeText(text: string): boolean {
  const t = text.toLowerCase();
  return [
    "since the start", "since start", "since the war", "since war",
    "since the pandemic", "since pandemic", "year to date", "ytd",
    "over the past", "over the last", "from last year", "versus last year",
    "compared with last year", "since 2024", "since 2025",
  ].some((kw) => t.includes(kw));
}

function extractPercentNums(text: string): number[] {
  return [...String(text).matchAll(/(\d+(?:\.\d+)?)\s*%/g)]
    .map((m) => Number(m[1]))
    .filter((v) => Number.isFinite(v) && v > 0)
    .map((v) => Math.round(v));
}

function collectRejectedPcts(text: string, methodology: MethodologyLike): number[] {
  const stored = getRejectedShockPcts(methodology);
  if (stored.length) return stored;
  if (isCumulativeText(text)) return extractPercentNums(text);
  return [];
}

// ---------------------------------------------------------------------------
// Core stripping
// ---------------------------------------------------------------------------

export function stripRejectedValues(text: string, methodology: MethodologyLike): string {
  if (!text) return text;
  const rejectedPcts = collectRejectedPcts(text, methodology);
  if (!rejectedPcts.length) return text;
  const sentences = text.match(/[^.!?]+[.!?]?\s*/g) || [text];
  const safe = sentences.filter(
    (s) => !rejectedPcts.some((pct) => new RegExp(`\\b${pct}\\s*%`).test(s))
  );
  return safe.join("").trim() || text;
}

export function getRejectedValues(methodology: MethodologyLike): number[] {
  return getRejectedShockPcts(methodology);
}

export function getRejectedValueNote(methodology: MethodologyLike): string | null {
  const pcts = getRejectedShockPcts(methodology);
  if (!pcts.length) return null;
  const list = pcts.map((v) => `${v}%`).join(", ");
  return `Rejected contextual/cumulative value: ${list}. These values were not used in the exposure calculation.`;
}

export function isRejectedValueMention(text: string, methodology: MethodologyLike): boolean {
  const pcts = getRejectedShockPcts(methodology);
  if (!pcts.length) return false;
  return pcts.some((pct) => new RegExp(`\\b${pct}\\s*%`).test(text));
}

// ---------------------------------------------------------------------------
// Opportunity summary sanitization
// ---------------------------------------------------------------------------

const OPPORTUNITY_NOISE_PATTERNS: RegExp[] = [
  // "72 signals support action this cycle."
  /\d+\s+signals?\s+support\s+action[^.]*\./gi,
  // "72 signals." or "72 signals identified."
  /\d+\s+signals?\s+(?:identified|analyzed|detected)?[^.]*\./gi,
  // "82% probability." / "82% confidence."
  /\b[7-9]\d%\s+(?:probability|confidence)[^.]*\./gi,
  // "Industrial Demand Growth Opportunity." (generic title reused as body)
  /industrial\s+demand\s+growth\s+opportunity\b[^.]*\./gi,
  // "$2.0M–$6.0M modeled upside."
  /\$[\d.,]+[kKmMbB][\s–-]+\$[\d.,]+[kKmMbB]\s+modeled\s+upside[^.]*\./gi,
  // "Validated Opportunity"
  /\bvalidated\s+opportunity\b[^.]*\./gi,
];

export function sanitizeOpportunitySummary(summary: string | null | undefined): string {
  if (!summary) return "";
  let cleaned = summary;
  for (const pattern of OPPORTUNITY_NOISE_PATTERNS) {
    cleaned = cleaned.replace(pattern, "");
  }
  return cleaned.trim().replace(/\s{2,}/g, " ").replace(/^\.\s*/, "");
}

// ---------------------------------------------------------------------------
// Canonical safe summaries for known issues
// ---------------------------------------------------------------------------

const FREIGHT_SAFE_EXEC =
  "Freight markets are tightening due to geopolitical disruption, congestion, carrier surcharges, and peak-season demand. The $756K–$3.0M range is scenario-modeled because no clean current incremental rate was found in evidence.";

const FREIGHT_SAFE_FORECAST =
  "Source-backed logistics price pressure estimate; lane-specific freight-rate validation pending.";

const OPPORTUNITY_CANDIDATE_SAFE =
  "Broad industrial and materials signals may indicate demand support in manufacturing accounts, but current evidence is not account-specific. Treat the $2.0M–$6.0M range as candidate upside until CRM, quote volume, or customer order data validates demand.";

function isFreightIssue(issue: { risk_title?: string | null; title?: string | null; issue_category?: string | null }): boolean {
  const cat = String(issue.issue_category || "").toLowerCase();
  const t = String(issue.risk_title || issue.title || "").toLowerCase();
  return cat.includes("freight") || cat.includes("logistics") ||
    t.includes("freight") || t.includes("container rate") || t.includes("shipping cost");
}

function isManufacturingOpportunity(issue: { title?: string | null }): boolean {
  const t = String(issue.title || "").toLowerCase();
  if (t.includes("manufacturing") && (t.includes("demand") || t.includes("opportunity"))) return true;
  if ((t.includes("industrial") || t.includes("demand growth")) && t.includes("opportunity")) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function getSafeExecutiveSummary(issue: {
  risk_title?: string | null;
  title?: string | null;
  executive_summary?: string | null;
  summary?: string | null;
  issue_category?: string | null;
  methodology?: MethodologyLike;
}): string {
  if (isFreightIssue(issue)) return FREIGHT_SAFE_EXEC;
  const raw = String(issue.executive_summary || issue.summary || "");
  return stripRejectedValues(raw, issue.methodology ?? null);
}

export function getSafeForecastSummary(issue: {
  risk_title?: string | null;
  title?: string | null;
  executive_summary?: string | null;
  summary?: string | null;
  issue_category?: string | null;
  methodology?: MethodologyLike;
}): string {
  if (isFreightIssue(issue)) return FREIGHT_SAFE_FORECAST;
  if (isManufacturingOpportunity(issue)) {
    return "Candidate upside requires CRM/account validation before being treated as forecast.";
  }
  const raw = String(issue.executive_summary || issue.summary || "");
  const stripped = stripRejectedValues(raw, issue.methodology ?? null);
  return stripped.slice(0, 120) || String(issue.risk_title || issue.title || "");
}

export function getSafeMemoSummary(issue: {
  risk_title?: string | null;
  title?: string | null;
  executive_summary?: string | null;
  summary?: string | null;
  issue_category?: string | null;
  methodology?: MethodologyLike;
}): string {
  return getSafeExecutiveSummary(issue).slice(0, 150);
}

export function getTrustSafeOpportunitySummary(opp: {
  title?: string | null;
  summary?: string | null;
  methodology?: MethodologyLike;
}): string {
  if (isManufacturingOpportunity({ title: opp.title })) return OPPORTUNITY_CANDIDATE_SAFE;
  return sanitizeOpportunitySummary(opp.summary);
}
