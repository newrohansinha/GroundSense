// Verified Shock Engine (Part 6).
// Turns trusted structured metrics into verified shocks, and decides whether an article's
// numeric claim is backed by a structured metric. A number is only a *verified shock* when
// a trusted source supports it — article text alone is never a shock.

import { supabase } from "../../lib/supabase";
import { getSourceById } from "./freeSourceRegistry";
import type {
  ArticleMetricClaim,
  NormalizedMetric,
  ShockType,
  VerificationStatus,
  VerifiedShock,
} from "./types";

// ── Driver → shock-type mapping ───────────────────────────────────────────────

const DRIVER_SHOCK_TYPE: Array<{ match: RegExp; type: ShockType }> = [
  { match: /freight|logistics|container|shipping|ocean/i, type: "freight_rate_change" },
  { match: /tariff|duty|trade.?policy|hts/i, type: "tariff_rate_change" },
  { match: /import|export|trade.?flow|volume/i, type: "import_volume_change" },
  { match: /steel|copper|aluminum|metal|commodity|ppi/i, type: "commodity_price_change" },
  { match: /macro|gdp|cpi|demand|rate/i, type: "macro_indicator_change" },
  { match: /company|revenue|financial|margin|cogs/i, type: "company_financial_change" },
];

export function shockTypeForDriver(driver: string, category?: string): ShockType {
  if (category === "producer_prices") return "ppi_change";
  for (const { match, type } of DRIVER_SHOCK_TYPE) {
    if (match.test(driver)) return type;
  }
  return "macro_indicator_change";
}

// ── Trust → verification status ───────────────────────────────────────────────

function statusForTrust(trustTier: string, sourceCount: number): VerificationStatus {
  if (sourceCount >= 2) return "corroborated_by_multiple_sources";
  switch (trustTier) {
    case "user_imported_structured_data":
      return "verified_manual_structured_metric";
    case "official_government":
    case "official_multilateral":
    case "official_economic_database":
    case "company_disclosure":
      return "verified_official_source";
    default:
      return "verified_public_metric";
  }
}

// Confidence 0..100 from trust tier, change completeness, and corroboration.
export function classifyShockConfidence(shock: Pick<VerifiedShock, "verification_status" | "percent_change" | "baseline_value" | "source_count">): number {
  let score = 40;
  switch (shock.verification_status) {
    case "corroborated_by_multiple_sources": score = 90; break;
    case "verified_official_source": score = 80; break;
    case "verified_manual_structured_metric": score = 72; break;
    case "verified_public_metric": score = 68; break;
    case "article_claim_only": score = 30; break;
    case "conflicting_sources": score = 35; break;
    case "rejected_contextual_number": score = 15; break;
    case "scenario_assumption_only": score = 25; break;
  }
  if (shock.baseline_value !== null && shock.percent_change !== null) score += 5;
  if ((shock.source_count ?? 1) >= 2) score += 5;
  return Math.max(0, Math.min(100, score));
}

// ── Metric → shock ────────────────────────────────────────────────────────────

export function deriveShockFromMetric(metric: NormalizedMetric, sourceCount = 1): VerifiedShock | null {
  if (!metric.metric_key || !metric.driver) return null;
  const src = getSourceById(metric.source_id);
  const baseline = metric.baseline_value ?? null;
  const current = metric.current_value ?? metric.value ?? null;
  if (current === null) return null;

  const absolute = baseline !== null ? Math.round((current - baseline) * 1000) / 1000 : null;
  const percent =
    metric.percent_change ?? (baseline !== null && baseline !== 0 ? Math.round(((current - baseline) / Math.abs(baseline)) * 1000) / 10 : null);

  const verification = statusForTrust(metric.trust_tier, sourceCount);
  const shock: VerifiedShock = {
    driver: metric.driver,
    shock_type: shockTypeForDriver(metric.driver, metric.category),
    metric_key: metric.metric_key,
    baseline_value: baseline,
    current_value: current,
    absolute_change: absolute,
    percent_change: percent,
    unit: metric.unit || "",
    period_start: metric.period_start ?? null,
    period_end: metric.period_end ?? null,
    source_count: sourceCount,
    primary_source_id: metric.source_id,
    verification_status: verification,
    confidence_score: 0,
    source_agreement_score: sourceCount >= 2 ? 100 : 60,
    notes:
      src && !src.numeric_exposure_allowed
        ? `${metric.metric_name} — macro context indicator; not company-specific by itself. Company exposure mapping required before company-specific publication.`
        : `${metric.metric_name} from ${metric.source_name ?? src?.name ?? metric.source_id}.`,
  };
  shock.confidence_score = classifyShockConfidence(shock);
  // Context-only sources (World Bank macro, GDELT) are capped to low-medium confidence —
  // they are corroborating context, never company-specific exposure on their own.
  if (src && !src.numeric_exposure_allowed) {
    shock.confidence_score = Math.min(shock.confidence_score, 45);
  }
  return shock;
}

// Build a shock from a time-series of observations (latest vs prior).
export function deriveShockFromMetricSeries(observations: NormalizedMetric[]): VerifiedShock | null {
  if (observations.length === 0) return null;
  const sorted = [...observations].sort((a, b) => String(b.period_end ?? "").localeCompare(String(a.period_end ?? "")));
  const current = sorted[0];
  const prior = sorted[1];
  const merged: NormalizedMetric = {
    ...current,
    baseline_value: current.baseline_value ?? prior?.current_value ?? prior?.value ?? null,
  };
  return deriveShockFromMetric(merged, observations.length >= 2 ? 1 : 1);
}

// ── Conflict resolution ───────────────────────────────────────────────────────

const TRUST_RANK: Record<string, number> = {
  official_government: 5,
  official_economic_database: 5,
  official_multilateral: 4,
  company_disclosure: 4,
  user_imported_structured_data: 3,
  open_news_event_dataset: 1,
};

// Pick the most trusted metric; flag disagreement if values diverge materially.
export function resolveConflictingMetrics(metrics: NormalizedMetric[]): { winner: NormalizedMetric | null; conflict: boolean; agreement: number } {
  if (metrics.length === 0) return { winner: null, conflict: false, agreement: 0 };
  if (metrics.length === 1) return { winner: metrics[0], conflict: false, agreement: 100 };
  const ranked = [...metrics].sort((a, b) => (TRUST_RANK[b.trust_tier] ?? 0) - (TRUST_RANK[a.trust_tier] ?? 0));
  const winner = ranked[0];
  const vals = metrics.map((m) => m.current_value ?? m.value).filter((v): v is number => v !== null && v !== undefined);
  let conflict = false;
  if (vals.length >= 2) {
    const max = Math.max(...vals);
    const min = Math.min(...vals);
    const spread = max !== 0 ? Math.abs((max - min) / Math.abs(max)) : 0;
    conflict = spread > 0.1; // >10% divergence = conflict
  }
  return { winner, conflict, agreement: conflict ? 50 : 100 };
}

// ── Article-claim verification ────────────────────────────────────────────────

// Does a structured metric support the article's numeric claim?
export function verifyArticleClaimAgainstMetrics(
  claim: ArticleMetricClaim,
  metrics: NormalizedMetric[]
): { status: VerificationStatus; matchedMetric: NormalizedMetric | null; reason: string } {
  if (claim.extracted_value === null) {
    return { status: "rejected_contextual_number", matchedMetric: null, reason: "No clean numeric value extracted." };
  }
  // Candidate metrics: same driver (or metric_key) family.
  const candidates = metrics.filter((m) => {
    if (claim.metric_key && m.metric_key === claim.metric_key) return true;
    if (claim.driver && m.driver && driversAlign(claim.driver, m.driver)) return true;
    return false;
  });
  if (candidates.length === 0) {
    return { status: "article_claim_only", matchedMetric: null, reason: "No structured metric covers this driver — article claim only." };
  }
  const { winner, conflict } = resolveConflictingMetrics(candidates);
  if (conflict) {
    return { status: "conflicting_sources", matchedMetric: winner, reason: "Structured sources disagree; structured metric takes precedence with warning." };
  }
  return { status: classifyVerificationStatus(claim, winner), matchedMetric: winner, reason: "Article claim corroborated by structured metric." };
}

export function classifyVerificationStatus(_claim: ArticleMetricClaim, matchedMetric: NormalizedMetric | null): VerificationStatus {
  if (!matchedMetric) return "article_claim_only";
  return statusForTrust(matchedMetric.trust_tier, 1);
}

function driversAlign(a: string, b: string): boolean {
  const norm = (s: string) => s.toLowerCase();
  if (norm(a) === norm(b)) return true;
  const groups = [
    ["freight", "logistics", "container", "shipping"],
    ["tariff", "trade", "duty", "hts"],
    ["steel", "metal", "iron"],
    ["copper"],
    ["aluminum", "aluminium"],
    ["macro", "gdp", "demand", "cpi"],
  ];
  return groups.some((g) => g.some((t) => norm(a).includes(t)) && g.some((t) => norm(b).includes(t)));
}

// ── Persistence ───────────────────────────────────────────────────────────────

// Idempotent: upsert by (company_id, metric_key, period_end) so repeated refreshes
// update the existing shock instead of duplicating it.
export async function createVerifiedShock(companyId: string, shock: VerifiedShock): Promise<VerifiedShock | null> {
  try {
    const payload = { company_id: companyId, ...stripId(shock) };
    if (shock.metric_key) {
      const { data: existing } = await supabase
        .from("verified_shocks")
        .select("id")
        .eq("company_id", companyId)
        .eq("metric_key", shock.metric_key)
        .eq("period_end", shock.period_end ?? "")
        .limit(1);
      if (existing && existing.length > 0) {
        const id = (existing[0] as { id: string }).id;
        const { data, error } = await supabase.from("verified_shocks").update(payload).eq("id", id).select("*").single();
        if (error || !data) return null;
        return data as VerifiedShock;
      }
    }
    const { data, error } = await supabase.from("verified_shocks").insert(payload).select("*").single();
    if (error || !data) return null;
    return data as VerifiedShock;
  } catch {
    return null;
  }
}

// Most trusted, most recent verified shock for a GroundSense driver (e.g. "freight").
export async function getBestVerifiedShockForDriver(companyId: string, driver: string): Promise<VerifiedShock | null> {
  try {
    const { data } = await supabase
      .from("verified_shocks")
      .select("*")
      .eq("company_id", companyId)
      .order("confidence_score", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(50);
    if (!data) return null;
    const matches = (data as VerifiedShock[]).filter((s) => s.driver && driversAlign(driver, s.driver));
    return matches[0] ?? null;
  } catch {
    return null;
  }
}

function stripId(shock: VerifiedShock): Omit<VerifiedShock, "id" | "company_id"> {
  const { id, company_id, ...rest } = shock;
  void id;
  void company_id;
  return rest;
}
