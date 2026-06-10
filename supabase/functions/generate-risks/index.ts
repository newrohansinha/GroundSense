import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

type RawEvent = {
  id: string;
  company_id: string;
  title?: string | null;
  description?: string | null;
  source_url?: string | null;
  source_name?: string | null;
  source_quality?: number | null;
  source_tier?: string | null;
  published_at?: string | null;
  event_age_days?: number | null;
  relevance_seed_score?: number | null;
  query_text?: string | null;
  matched_terms?: string[] | null;
  signal_terms?: string[] | null;
  quality_reason?: string | null;
  rejected_reason?: string | null;
};

type AssessmentRow = {
  id: string;
  company_id: string;
  raw_event_id: string;
  relevant?: boolean | null;
  impact_type?: string | null;
  impact_level?: string | null;
  confidence?: number | null;
  strategic_score?: number | null;
  why_it_matters?: string | null;
  recommended_action?: string | null;
  direction?: string | null;
  matched_entities?: string[] | null;
  raw_events?: RawEvent | null;
  raw_event?: RawEvent | null;
};

type CleanAssessment = AssessmentRow & {
  raw: RawEvent;
  effective_source_quality: number;
  effective_source_tier: string;
  effective_source_reason: string;
};

type RiskDraft = {
  title: string;
  risk_type: string;
  description: string;
  priority_score: number;
  movement: number;
  probability: number;
  exposure_low: number;
  exposure_high: number;
  decision: string;
  owner: string;
  due_date: string;
  expected_benefit: string;
  evidence: any[];
  methodology: Record<string, unknown>;
  metadata: Record<string, unknown>;
};

const COMPANY_ID_REQUIRED_MESSAGE = "Missing companyId";

const BLOCKED_SOURCE_NAMES = [
  "ad hoc",
  "ad-hoc",
  "marketbeat",
  "simplywall",
  "simply wall st",
  "moomoo",
  "indexbox",
  "kalkine",
  "thelegaladvocate",
  "legal advocate",
];

const HARD_REJECT_TERMS = [
  "takes position",
  "new position",
  "grows stake",
  "increases holdings",
  "sells shares",
  "sells stock",
  "purchases shares",
  "bought by",
  "trims stock",
  "stock holdings",
  "price target",
  "analyst says",
  "analyst rating",
  "valuation check",
  "valuation after",
  "shareholder returns",
  "institutional investor",
  "asset management",
  "wealth management",
  "norges bank",
  "fideuram",
  "legal & general",
  "nomura",
  "jefferies",
  "morgan stanley adjusts",
  "wall street bullish",
  "wall street bearish",
  "stock price expected",
  "stock split",
  "insider buying",
  "director acquires",
  "shares acquired",
  "shares of stock",
];

const TIER_1_SOURCE_NAMES = [
  "reuters",
  "associated press",
  "ap news",
  "bloomberg",
  "wall street journal",
  "financial times",
  "cnbc",
  "nasdaq",
  "yahoo finance",
  "federal register",
  "u.s. census",
  "bureau of labor statistics",
  "bureau of economic analysis",
  "institute for supply management",
  "american iron and steel institute",
];

const TIER_2_SOURCE_NAMES = [
  "supply chain dive",
  "construction dive",
  "manufacturing dive",
  "industryweek",
  "freightwaves",
  "s&p global",
  "sp global",
  "kitco",
  "gmk center",
  "eurometal",
  "world steel",
  "business wire",
  "pr newswire",
  "globe newswire",
  "mlex",
  "steel market update",
];

function normalize(value: unknown) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^\w\s.$%-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function num(value: unknown, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function money(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value));
}

function domainFromUrl(url: unknown) {
  try {
    return new URL(String(url || "")).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function containsAny(text: string, terms: string[]) {
  const n = normalize(text);
  return terms.some((term) => n.includes(normalize(term)));
}

function countMatches(text: string, terms: string[]) {
  const n = normalize(text);
  return terms.filter((term) => n.includes(normalize(term))).length;
}

function addDays(days: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function sourceQuality(raw: RawEvent) {
  const domain = domainFromUrl(raw.source_url);
  const sourceName = normalize(raw.source_name);
  const combined = `${domain} ${sourceName}`;

  if (containsAny(combined, BLOCKED_SOURCE_NAMES)) {
    return {
      score: 0,
      tier: "blocked",
      reason: `Blocked source: ${raw.source_name || domain}`,
    };
  }

  if (containsAny(combined, TIER_1_SOURCE_NAMES)) {
    return {
      score: 95,
      tier: "tier_1",
      reason: `Tier 1 source: ${raw.source_name || domain}`,
    };
  }

  if (containsAny(combined, TIER_2_SOURCE_NAMES)) {
    return {
      score: 82,
      tier: "tier_2",
      reason: `Tier 2 source: ${raw.source_name || domain}`,
    };
  }

  if (domain.endsWith(".gov")) {
    return {
      score: 94,
      tier: "tier_1",
      reason: `Government source: ${domain}`,
    };
  }

  if (domain.endsWith(".edu")) {
    return {
      score: 78,
      tier: "tier_2",
      reason: `Academic source: ${domain}`,
    };
  }

  if (
    domain.includes("business") ||
    domain.includes("finance") ||
    domain.includes("industry") ||
    domain.includes("logistics") ||
    domain.includes("manufacturing")
  ) {
    return {
      score: 65,
      tier: "tier_3",
      reason: `Business-adjacent source: ${domain}`,
    };
  }

  return {
    score: Math.max(50, num(raw.source_quality, 50)),
    tier: "tier_3",
    reason: `Unclassified source: ${raw.source_name || domain || "unknown"}`,
  };
}

function isCleanEvidence(row: AssessmentRow): CleanAssessment | null {
  const raw = row.raw_events || row.raw_event;

  if (!raw) return null;
  if (raw.rejected_reason) return null;
  if (row.relevant === false) return null;

  const title = raw.title || "";
  const description = raw.description || "";
  const sourceName = raw.source_name || "";
  const combined = `${title} ${description} ${sourceName}`;

  const source = sourceQuality(raw);
  const effectiveQuality = Math.max(num(raw.source_quality, 0), source.score);

  if (source.tier === "blocked") return null;
  if (effectiveQuality < 50) return null;

  if (containsAny(combined, HARD_REJECT_TERMS)) return null;

  return {
    ...row,
    raw,
    effective_source_quality: effectiveQuality,
    effective_source_tier: source.tier,
    effective_source_reason: source.reason,
  };
}

function textOf(row: CleanAssessment) {
  return normalize(
    `${row.raw.title || ""} ${row.raw.description || ""} ${row.raw.query_text || ""} ${
      row.impact_type || ""
    } ${(row.matched_entities || []).join(" ")}`
  );
}

function groupMatches(row: CleanAssessment, group: string) {
  const text = textOf(row);
  const impactType = normalize(row.impact_type);

  if (group === "steel_china_cost") {
    return (
      impactType.includes("commodity") ||
      text.includes("steel") ||
      text.includes("tariff") ||
      text.includes("duties") ||
      text.includes("fastener") ||
      text.includes("china")
    );
  }

  if (group === "construction_competitive") {
    const competitor =
      text.includes("grainger") ||
      text.includes("msc industrial") ||
      text.includes("applied industrial") ||
      text.includes("white cap") ||
      impactType.includes("competitor");

    const construction =
      text.includes("construction") ||
      text.includes("branch") ||
      text.includes("distribution") ||
      text.includes("pricing") ||
      text.includes("fulfillment");

    return competitor && construction;
  }

  if (group === "industrial_demand") {
    return (
      impactType.includes("customer_demand") ||
      text.includes("manufacturing pmi") ||
      text.includes("industrial production") ||
      text.includes("factory orders") ||
      text.includes("industrial demand") ||
      text.includes("manufacturing demand") ||
      text.includes("fastenal") ||
      text.includes("sales growth") ||
      text.includes("earnings") ||
      text.includes("guidance")
    );
  }

 if (group === "supply_chain_freight") {
  const isCommodityOnly =
    impactType.includes("commodity") ||
    text.includes("steel tariff") ||
    text.includes("steel import") ||
    text.includes("steel imports") ||
    text.includes("steel duties");

  if (isCommodityOnly) return false;

  return (
    impactType.includes("supply_chain") ||
    impactType.includes("supplier") ||
    text.includes("freight") ||
    text.includes("truckload") ||
    text.includes("logistics") ||
    text.includes("port") ||
    text.includes("rail") ||
    text.includes("supply chain") ||
    text.includes("supplier disruption")
  );
}

  if (group === "service_level") {
    return (
      impactType.includes("service") ||
      text.includes("inventory") ||
      text.includes("fulfillment") ||
      text.includes("backlog") ||
      text.includes("shortage") ||
      text.includes("backorder")
    );
  }

  return false;
}

function avg(values: number[]) {
  const clean = values.filter((v) => Number.isFinite(v));
  if (clean.length === 0) return 0;
  return clean.reduce((a, b) => a + b, 0) / clean.length;
}

function max(values: number[]) {
  const clean = values.filter((v) => Number.isFinite(v));
  if (clean.length === 0) return 0;
  return Math.max(...clean);
}

function buildEvidence(rows: CleanAssessment[]) {
  return rows.slice(0, 8).map((row) => ({
  raw_event_id: row.raw.id,
  assessment_id: row.id,

  title: row.raw.title,

  source: row.raw.source_name,
  source_name: row.raw.source_name,

  url: row.raw.source_url,
  source_url: row.raw.source_url,

  published_at: row.raw.published_at,

  age_days: row.raw.event_age_days,
  event_age_days: row.raw.event_age_days,

  quality: row.effective_source_quality,
  source_quality: row.effective_source_quality,

  tier: row.effective_source_tier,
  source_tier: row.effective_source_tier,

  relevance_seed_score: row.raw.relevance_seed_score,
  confidence: row.confidence,
  strategic_score: row.strategic_score,
  impact_type: row.impact_type,
  impact_level: row.impact_level,
  why_it_matters: row.why_it_matters,
  source_quality_reason: row.effective_source_reason,
}));
}

function probabilityFromEvidence(rows: CleanAssessment[]) {
  const signalCount = rows.length;
  const avgConfidence = avg(rows.map((row) => num(row.confidence, 50)));
  const avgQuality = avg(rows.map((row) => row.effective_source_quality));
  const signalBoost = Math.min(14, signalCount * 2.5);

  return clamp(Math.round(avgConfidence * 0.48 + avgQuality * 0.38 + signalBoost), 45, 92);
}

function priorityFromRisk(input: {
  probability: number;
  exposureHigh: number;
  annualRevenue: number;
  avgStrategicScore: number;
}) {
  const exposureRatio = input.annualRevenue > 0 ? input.exposureHigh / input.annualRevenue : 0;
  const exposureScore = clamp(exposureRatio * 2500, 0, 25);

  return clamp(
    Math.round(input.probability * 0.48 + input.avgStrategicScore * 0.32 + exposureScore),
    0,
    100
  );
}

function pct(value: unknown) {
  const n = num(value, 0);
  if (n <= 0) return 0;
  return n > 1 ? n / 100 : n;
}

function getCalibrationNumber(calibration: any, keys: string[], fallback = 0) {
  for (const key of keys) {
    const value = num(calibration?.[key], 0);
    if (value > 0) return value;
  }

  return fallback;
}

function buildRiskDrafts(input: {
  assessments: CleanAssessment[];
  calibration: any;
}) {
  const annualRevenue = getCalibrationNumber(
    input.calibration,
    ["annual_revenue", "revenue", "net_sales"],
    7546000000
  );

  const manufacturingRevenue = getCalibrationNumber(
    input.calibration,
    ["manufacturing_revenue", "manufacturing_customers_revenue"],
    annualRevenue * 0.74
  );

  const constructionRevenue = getCalibrationNumber(
    input.calibration,
    ["construction_revenue", "construction_customers_revenue"],
    annualRevenue * 0.082
  );

  const steelSpend = getCalibrationNumber(
    input.calibration,
    ["steel_spend", "annual_steel_spend"],
    0
  );

  const cogs = getCalibrationNumber(input.calibration, ["cogs", "cost_of_goods_sold"], 0);

  const quoteWinRate = pct(input.calibration?.quote_win_rate_pct);
  const explicitLostQuoteRate = pct(input.calibration?.lost_quote_rate_pct);
  const derivedLostQuoteRate =
    explicitLostQuoteRate > 0
      ? 0
      : quoteWinRate > 0 && quoteWinRate < 1
        ? 1 - quoteWinRate
        : 0;

  const lostQuoteRate = explicitLostQuoteRate || derivedLostQuoteRate || 0.06;
  const churnRate = pct(input.calibration?.customer_churn_rate_pct) || 0.03;

  const passThroughCoverage = pct(input.calibration?.pass_through_coverage_pct) || 0.8;
  const unpassedCostRate = clamp(1 - passThroughCoverage, 0.05, 1);

  const drafts: RiskDraft[] = [];

  const groups = [
    {
      key: "steel_china_cost",
      title: "China and Steel Sourcing Cost Exposure",
      type: "commodity_cost",
      owner: "VP Procurement",
      dueDays: 7,
      minSignals: 2,
      decision:
        "Approve a 7-day review of China-exposed steel and fastener contracts, including pass-through language and alternate supplier coverage.",
      expectedBenefit:
        "Could reduce exposed landed-cost pressure by 20% to 30% if alternate supply or customer pass-through coverage is confirmed.",
    },
    {
      key: "construction_competitive",
      title: "Construction Channel Competitive Pressure",
      type: "competitor_pressure",
      owner: "VP Sales",
      dueDays: 7,
      minSignals: 2,
      decision:
        "Approve a construction-account defense push before competitors reset customer expectations.",
      expectedBenefit:
        "Could protect high-value construction accounts and reduce share-loss risk in a key revenue segment.",
    },
    {
      key: "industrial_demand",
      title: "Industrial Demand Sensitivity",
      type: "customer_demand",
      owner: "CRO / Finance",
      dueDays: 14,
      minSignals: 2,
      decision:
        "Decide whether next-quarter sales assumptions should be revised for manufacturing and construction demand sensitivity.",
      expectedBenefit:
        "Could prevent inventory and sales planning from lagging demand changes.",
    },
    {
      key: "supply_chain_freight",
      title: "Freight and Supplier Disruption Exposure",
      type: "supply_chain",
      owner: "VP Supply Chain",
      dueDays: 7,
      minSignals: 2,
      decision:
        "Review freight, supplier lead-time, and expedite-cost exposure for the next operating cycle.",
      expectedBenefit:
        "Could reduce expedite leakage and protect customer service levels if disruption risk rises.",
    },
    {
      key: "service_level",
      title: "Inventory and Fulfillment Service Risk",
      type: "service_level",
      owner: "Operations",
      dueDays: 10,
      minSignals: 2,
      decision:
        "Review inventory availability and service-level exposure for priority customer segments.",
      expectedBenefit:
        "Could reduce backorder leakage and protect key accounts from service-level failures.",
    },
  ];

  for (const group of groups) {
    const rows = input.assessments.filter((row) => groupMatches(row, group.key));

    if (rows.length < group.minSignals) continue;

    const probability = probabilityFromEvidence(rows);
    const avgStrategicScore = avg(rows.map((row) => num(row.strategic_score, 50)));
    const avgSourceQuality = avg(rows.map((row) => row.effective_source_quality));
    const evidence = buildEvidence(rows);

    let baseExposure = 0;
    let baseType = "unknown";
    let exposureLow = 0;
    let exposureHigh = 0;
    let methodologyFormula = "";

    if (group.key === "steel_china_cost") {
      baseExposure = steelSpend > 0 ? steelSpend : cogs > 0 ? cogs * 0.12 : annualRevenue * 0.06;
      baseType = steelSpend > 0 ? "steel_spend" : cogs > 0 ? "estimated_steel_exposed_cogs" : "estimated_steel_exposure";

      const lowMove = 0.08;
      const highMove = 0.18;

      exposureLow = baseExposure * lowMove * unpassedCostRate;
      exposureHigh = baseExposure * highMove * unpassedCostRate;

      methodologyFormula =
        "exposure = steel_exposed_spend × assumed_cost_move_range × unpassed_cost_rate";
    }

    if (group.key === "construction_competitive") {
      baseExposure = constructionRevenue;
      baseType = "construction_customer_revenue";

      const lowRate = Math.min(churnRate, lostQuoteRate);
      const highRate = Math.max(churnRate, lostQuoteRate);

      exposureLow = baseExposure * lowRate;
      exposureHigh = baseExposure * highRate;

      methodologyFormula =
        "exposure = construction_revenue × calibrated_churn_or_lost_quote_rate";
    }

    if (group.key === "industrial_demand") {
      baseExposure = manufacturingRevenue;
      baseType = "manufacturing_customer_revenue";

      exposureLow = baseExposure * 0.00125;
      exposureHigh = baseExposure * 0.0042;

      methodologyFormula =
        "exposure = manufacturing_revenue × short-term_demand_sensitivity_range";
    }

    if (group.key === "supply_chain_freight") {
      baseExposure = cogs > 0 ? cogs : annualRevenue * 0.55;
      baseType = cogs > 0 ? "cogs" : "estimated_cost_base";

      exposureLow = baseExposure * 0.0015;
      exposureHigh = baseExposure * 0.0045;

      methodologyFormula =
        "exposure = cost_base × short-term_supply_chain_cost_sensitivity_range";
    }

    if (group.key === "service_level") {
      baseExposure = manufacturingRevenue;
      baseType = "manufacturing_customer_revenue";

      exposureLow = baseExposure * 0.001;
      exposureHigh = baseExposure * 0.003;

      methodologyFormula =
        "exposure = manufacturing_revenue × service_level_leakage_sensitivity_range";
    }

    const evidenceMultiplier = clamp(1 + Math.log10(rows.length + 1) * 0.08, 1, 1.18);
    const qualityMultiplier = clamp(avgSourceQuality / 80, 0.75, 1.15);

    exposureLow = money(exposureLow * evidenceMultiplier * qualityMultiplier);
    exposureHigh = money(exposureHigh * evidenceMultiplier * qualityMultiplier);

    const priorityScore = priorityFromRisk({
      probability,
      exposureHigh,
      annualRevenue,
      avgStrategicScore,
    });

    drafts.push({
      title: group.title,
      risk_type: group.type,
      description: `${group.title}. ${rows.length} clean signals. $${Math.round(
        exposureLow / 1000000
      ).toFixed(1)}M–$${Math.round(exposureHigh / 1000000).toFixed(
        1
      )}M modeled exposure. ${probability}% probability.`,
      priority_score: priorityScore,
      movement: 0,
      probability,
      exposure_low: exposureLow,
      exposure_high: exposureHigh,
      decision: group.decision,
      owner: group.owner,
      due_date: addDays(group.dueDays),
      expected_benefit: group.expectedBenefit,
      evidence,
      methodology: {
  base_type: baseType,
  baseType,

  base_exposure: money(baseExposure),
  baseExposure: money(baseExposure),

  source_quality: Math.round(avgSourceQuality),
  sourceQuality: Math.round(avgSourceQuality),

  signals: rows.length,
  signalCount: rows.length,

  evidence_multiplier: Number(evidenceMultiplier.toFixed(3)),
  evidenceMultiplier: Number(evidenceMultiplier.toFixed(3)),

  quality_multiplier: Number(qualityMultiplier.toFixed(3)),
  qualityMultiplier: Number(qualityMultiplier.toFixed(3)),

  low_estimate: exposureLow,
  lowEstimate: exposureLow,

  high_estimate: exposureHigh,
  highEstimate: exposureHigh,

  formula: methodologyFormula,

  calibration_inputs: {
    annual_revenue: annualRevenue,
    manufacturing_revenue: manufacturingRevenue,
    construction_revenue: constructionRevenue,
    steel_spend: steelSpend || null,
    cogs: cogs || null,
    quote_win_rate_pct: input.calibration?.quote_win_rate_pct || null,
    lost_quote_rate_pct: input.calibration?.lost_quote_rate_pct || null,
    derived_lost_quote_rate_pct:
      derivedLostQuoteRate > 0 ? Number((derivedLostQuoteRate * 100).toFixed(2)) : null,
    customer_churn_rate_pct: input.calibration?.customer_churn_rate_pct || null,
    pass_through_coverage_pct: input.calibration?.pass_through_coverage_pct || null,
  },
},
      metadata: {
        generator_version: "generate-risks-v5-clean-evidence",
        evidence_raw_event_ids: evidence.map((item) => item.raw_event_id),
        evidence_assessment_ids: evidence.map((item) => item.assessment_id),
        quality_gate: "rejected low-quality, blocked, investment-noise, and valuation evidence",
      },
    });
  }

  return drafts.sort((a, b) => b.priority_score - a.priority_score).slice(0, 5);
}

async function loadCalibration(supabase: any, companyId: string) {
  const { data, error } = await supabase
    .from("company_calibration")
    .select("*")
    .eq("company_id", companyId)
    .order("updated_at", { ascending: false, nullsFirst: false })
    .limit(1);

  if (error) {
    console.log("company_calibration load failed", error.message);
    return {};
  }

  return data?.[0] || {};
}

async function loadAssessments(supabase: any, companyId: string) {
  const joined = await supabase
    .from("event_assessments")
    .select("*, raw_events(*)")
    .eq("company_id", companyId)
    .eq("relevant", true)
    .gte("confidence", 45)
    .limit(500);

  if (!joined.error) {
    return (joined.data || []) as AssessmentRow[];
  }

  console.log("event_assessments joined load failed, falling back", joined.error.message);

  const assessmentsResult = await supabase
    .from("event_assessments")
    .select("*")
    .eq("company_id", companyId)
    .eq("relevant", true)
    .gte("confidence", 45)
    .limit(500);

  if (assessmentsResult.error) {
    throw new Error(assessmentsResult.error.message);
  }

  const assessments = (assessmentsResult.data || []) as AssessmentRow[];
  const rawEventIds = [...new Set(assessments.map((row) => row.raw_event_id).filter(Boolean))];

  if (rawEventIds.length === 0) return assessments;

  const rawEventsResult = await supabase
    .from("raw_events")
    .select("*")
    .eq("company_id", companyId)
    .in("id", rawEventIds);

  if (rawEventsResult.error) {
    throw new Error(rawEventsResult.error.message);
  }

  const rawById = new Map<string, RawEvent>();

  for (const raw of rawEventsResult.data || []) {
    rawById.set(raw.id, raw as RawEvent);
  }

  return assessments.map((assessment) => ({
    ...assessment,
    raw_events: rawById.get(assessment.raw_event_id) || null,
  }));
}

async function updateRawEventQuality(supabase: any, rows: CleanAssessment[]) {
  for (const row of rows) {
    await supabase
      .from("raw_events")
      .update({
        source_quality: row.effective_source_quality,
        source_tier: row.effective_source_tier,
        quality_reason: row.raw.quality_reason
          ? `${row.raw.quality_reason} | Risk evidence source check: ${row.effective_source_reason}`
          : `Risk evidence source check: ${row.effective_source_reason}`,
      })
      .eq("id", row.raw.id);
  }
}

async function safeDeleteByCompany(supabase: any, table: string, companyId: string) {
  const { error } = await supabase.from(table).delete().eq("company_id", companyId);

  if (error) {
    console.log(`delete from ${table} failed`, error.message);
  }
}
function buildExposurePathForRisk(risk: RiskDraft) {
  const title = risk.title.toLowerCase();

  if (title.includes("steel") || title.includes("china")) {
    return [
      "China / import exposure",
      "Steel and fastener input costs",
      "Supplier landed cost pressure",
      "Unpassed cost after pass-through",
      `$${Math.round(risk.exposure_high / 1000000).toFixed(1)}M modeled exposure`,
    ];
  }

  if (title.includes("construction")) {
    return [
      "Competitor activity",
      "Construction customers",
      "Pricing or service pressure",
      "Lost quote / churn sensitivity",
      `$${Math.round(risk.exposure_high / 1000000).toFixed(1)}M modeled exposure`,
    ];
  }

  if (title.includes("industrial") || title.includes("demand")) {
    return [
      "Industrial demand signal",
      "Manufacturing customers",
      "Order frequency / sales assumptions",
      "Revenue sensitivity",
      `$${Math.round(risk.exposure_high / 1000000).toFixed(1)}M modeled exposure`,
    ];
  }

  if (title.includes("freight") || title.includes("supplier")) {
    return [
      "Supply chain signal",
      "Freight / supplier lead time",
      "Fulfillment or expedite cost",
      "Service and margin exposure",
      `$${Math.round(risk.exposure_high / 1000000).toFixed(1)}M modeled exposure`,
    ];
  }

  return [
    risk.title,
    risk.risk_type,
    "Operating exposure",
    `$${Math.round(risk.exposure_high / 1000000).toFixed(1)}M modeled exposure`,
  ];
}

async function insertRisks(supabase: any, companyId: string, drafts: RiskDraft[]) {
  if (drafts.length === 0) {
    return {
      insertedRows: [],
      insertedCount: 0,
      error: null,
    };
  }

  const rows = drafts.map((risk, index) => ({
    company_id: companyId,
    risk_title: risk.title,
    risk_type: risk.risk_type,
    probability: risk.probability,
    impact_low: risk.exposure_low,
    impact_high: risk.exposure_high,
    confidence: risk.probability,
    severity:
      risk.priority_score >= 75 ? "high" :
      risk.priority_score >= 50 ? "medium" :
      "low",
    owner: risk.owner,
    action_required: risk.decision,
    due_days: risk.owner === "CRO / Finance" ? 14 : 7,
    status: "open",

    affected_suppliers:
      risk.title.toLowerCase().includes("china") ? ["China Fastener Supplier"] : [],
    affected_customers:
      risk.title.toLowerCase().includes("construction") ? ["Construction Customers"] :
      risk.title.toLowerCase().includes("industrial") ? ["Manufacturing Customers"] :
      [],
    affected_products: [],
    affected_commodities:
      risk.title.toLowerCase().includes("steel") ? ["Steel"] :
      risk.title.toLowerCase().includes("freight") ? ["Freight"] :
      [],
    affected_facilities: [],

    source_event_ids: risk.evidence.map((item) => item.raw_event_id),
    supporting_event_count: risk.evidence.length,

    executive_summary: risk.description,
    business_impact: risk.expected_benefit,
    margin_impact_bps: null,
    estimated_revenue_exposure: risk.exposure_high,

    priority_score: risk.priority_score,
    risk_rank: index + 1,

    what_happened: risk.evidence
      .slice(0, 3)
      .map((item) => item.title)
      .join(" | "),
    why_now: `${risk.evidence.length} clean signals passed the source-quality and relevance gate.`,
    risk_interaction: risk.risk_type,

    evidence_titles: risk.evidence.map((item) => item.title).filter(Boolean),
    evidence_sources: risk.evidence.map((item) => item.source_name).filter(Boolean),
    evidence_urls: risk.evidence.map((item) => item.source_url).filter(Boolean),
    evidence_quality_score: Number(risk.methodology?.source_quality || 50),

    decision_required: risk.decision,
    expected_benefit: risk.expected_benefit,
    evidence_items: risk.evidence,
    methodology: risk.methodology,
    exposure_path: buildExposurePathForRisk(risk),
  }));

  const result = await supabase.from("risk_register").insert(rows).select("*");

  if (result.error) {
    return {
      insertedRows: [],
      insertedCount: 0,
      error: result.error.message,
    };
  }

  return {
    insertedRows: result.data || [],
    insertedCount: rows.length,
    error: null,
  };
}

async function insertActions(
  supabase: any,
  companyId: string,
  drafts: RiskDraft[],
  insertedRiskRows: any[]
) {
  if (drafts.length === 0) return;

  const rows = drafts.map((risk, index) => ({
    company_id: companyId,
    risk_id: insertedRiskRows?.[index]?.id || null,
    opportunity_id: null,
    title: risk.decision,
    owner: risk.owner,
    deadline: risk.due_date,
    expected_benefit: risk.expected_benefit,
    status: "open",
    source_type: "risk",
  }));

  const result = await supabase.from("risk_actions").insert(rows);

  if (result.error) {
    console.log("risk_actions insert failed", result.error.message);
  }
}
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse(
        {
          error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
        },
        500
      );
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const body = await req.json();
    const companyId = body.companyId;

    if (!companyId) {
      return jsonResponse(
        {
          error: COMPANY_ID_REQUIRED_MESSAGE,
        },
        400
      );
    }

    await safeDeleteByCompany(supabase, "risk_actions", companyId);
    await safeDeleteByCompany(supabase, "risk_register", companyId);

    const calibration = await loadCalibration(supabase, companyId);
    const assessments = await loadAssessments(supabase, companyId);

    const cleanAssessments = assessments
      .map(isCleanEvidence)
      .filter((row): row is CleanAssessment => Boolean(row));

    console.log("generate-risks evidence quality gate", {
      companyId,
      assessments_loaded: assessments.length,
      clean_assessments: cleanAssessments.length,
      rejected: assessments.length - cleanAssessments.length,
      rejected_samples: assessments
        .filter((row) => !isCleanEvidence(row))
        .slice(0, 10)
        .map((row) => ({
          title: row.raw_events?.title || row.raw_event?.title,
          source: row.raw_events?.source_name || row.raw_event?.source_name,
          source_quality: row.raw_events?.source_quality || row.raw_event?.source_quality,
          source_tier: row.raw_events?.source_tier || row.raw_event?.source_tier,
          rejected_reason: row.raw_events?.rejected_reason || row.raw_event?.rejected_reason,
        })),
    });

    await updateRawEventQuality(supabase, cleanAssessments);

    const drafts = buildRiskDrafts({
      assessments: cleanAssessments,
      calibration,
    });

    const insertResult = await insertRisks(supabase, companyId, drafts);

    if (insertResult.error) {
      return jsonResponse(
        {
          error: insertResult.error,
          stage: "insert_risks",
          drafts,
        },
        500
      );
    }

    await insertActions(supabase, companyId, drafts, insertResult.insertedRows);

    return jsonResponse({
      generator_version: "generate-risks-v5-clean-evidence",
      assessments_loaded: assessments.length,
      clean_assessments: cleanAssessments.length,
      rejected_assessments: assessments.length - cleanAssessments.length,
      deleted_old: true,
      inserted: insertResult.insertedCount,
      risks: drafts,
    });
  } catch (error) {
    return jsonResponse(
      {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : null,
      },
      500
    );
  }
});