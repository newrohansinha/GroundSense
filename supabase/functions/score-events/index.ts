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
  content_text?: string | null;
  source_url?: string | null;
  source_name?: string | null;
  source_api?: string | null;
  source_quality?: number | null;
  source_tier?: string | null;
  relevance_seed_score?: number | null;
  event_age_days?: number | null;
  published_at?: string | null;
  query_text?: string | null;
  matched_terms?: string[] | null;
  signal_terms?: string[] | null;
  quality_reason?: string | null;
  rejected_reason?: string | null;
};

type QuantifiedShock = {
  shock_type:
    | "commodity_price"
    | "tariff_rate"
    | "freight_rate"
    | "demand_metric"
    | "competitor_metric"
    | "other";
  value_pct: number;
  direction: "up" | "down" | "mixed" | "unknown";
  metric: string;
  basis: string;
  confidence: "high" | "medium" | "low";
  validated_source_text: boolean;
  extraction_method: "deterministic_regex" | "gemini_candidate_validated";
};

type ScoredEvent = {
  raw_event_id: string;
  relevant: boolean;
  impact_type: string;
  impact_level: string;
  confidence: number;
  strategic_score: number;
  why_it_matters: string;
  recommended_action: string;
  direction: string;
  matched_entities: string[];
  quantified_shocks: QuantifiedShock[];
};

const SCORER_VERSION = "score-events-v6-source-verified-shocks";

const DEFAULT_MAX_EVENTS = 40;
const BATCH_SIZE = 20;

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

const HIGH_SIGNAL_TERMS = [
  "fastenal",
  "grainger",
  "msc industrial",
  "applied industrial",
  "steel",
  "tariff",
  "duties",
  "imports",
  "fasteners",
  "manufacturing",
  "industrial",
  "construction",
  "freight",
  "logistics",
  "supply chain",
  "supplier",
  "shortage",
  "disruption",
  "port",
  "rail",
  "truckload",
  "inventory",
  "fulfillment",
  "backlog",
  "pmi",
  "ism",
  "factory orders",
  "industrial production",
  "earnings",
  "guidance",
  "margin",
  "pricing",
  "sales",
  "distribution center",
  "branch",
  "acquisition",
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
function sourceTextForEvent(event: RawEvent, max = 60000) {
  return [
    event.title,
    event.description,
    event.content_text,
    event.query_text,
    event.source_name,
  ]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function getContextWindow(rawText: string, index: number, radius = 240) {
  const start = Math.max(0, index - radius);
  const end = Math.min(rawText.length, index + radius);

  return rawText.slice(start, end).replace(/\s+/g, " ").trim();
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function percentValueContexts(value: number, text: string) {
  if (!Number.isFinite(value)) return [];

  const base = Number.isInteger(value)
    ? String(value)
    : String(value).replace(/\.0+$/, "");

  const variants = [...new Set([base, value.toFixed(1).replace(/\.0$/, "")])]
    .filter(Boolean)
    .map(escapeRegex);

  const pattern = new RegExp(
    `(^|[^0-9.])(${variants.join("|")})\\s*(?:%|percent|percentage points?)\\b`,
    "gi"
  );

  const contexts: string[] = [];

  for (const match of text.matchAll(pattern)) {
    contexts.push(getContextWindow(text, match.index || 0));
  }

  return contexts;
}

function parsePercentNumber(raw: string) {
  return Number(
    String(raw || "")
      .replace(/%/g, "")
      .replace(/percentage points?/gi, "")
      .replace(/percent/gi, "")
      .trim()
  );
}

function shockTypeFromContext(context: string): QuantifiedShock["shock_type"] {
  const text = normalize(context);

  if (
    containsAny(text, [
      "tariff",
      "tariffs",
      "levy",
      "levies",
      "duty",
      "duties",
      "section 232",
      "import",
      "imports",
    ])
  ) {
    return "tariff_rate";
  }

  if (
    containsAny(text, [
      "freight",
      "container",
      "shipping",
      "truckload",
      "ocean",
      "surcharge",
      "gri",
      "spot rate",
      "rates",
    ])
  ) {
    return "freight_rate";
  }

  if (
    containsAny(text, [
      "steel",
      "copper",
      "aluminum",
      "aluminium",
      "commodity",
      "commodities",
      "industrial metals",
      "metal prices",
    ])
  ) {
    return "commodity_price";
  }

  if (
    containsAny(text, [
      "demand",
      "orders",
      "sales",
      "pmi",
      "production",
      "manufacturing activity",
      "construction spending",
    ])
  ) {
    return "demand_metric";
  }

  if (
    containsAny(text, [
      "competitor",
      "market share",
      "quote",
      "churn",
      "grainger",
      "msc industrial",
      "applied industrial",
    ])
  ) {
    return "competitor_metric";
  }

  return "other";
}

function directionFromContext(context: string): QuantifiedShock["direction"] {
  const text = normalize(context);

  if (
    containsAny(text, [
      "down from",
      "reduced",
      "lowered",
      "cut",
      "fell",
      "declined",
      "decreased",
      "dropped",
    ])
  ) {
    return "down";
  }

  if (
    containsAny(text, [
      "up from",
      "rose",
      "rising",
      "increased",
      "increase",
      "jumped",
      "spiked",
      "surged",
      "hiked",
      "raised",
      "boosted",
      "doubled",
    ])
  ) {
    return "up";
  }

  return "unknown";
}

function hasBadNumericContext(context: string) {
  const text = normalize(context);

  return containsAny(text, [
    "confidence",
    "source quality",
    "quality score",
    "relevance",
    "priority",
    "probability",
    "strategic score",
    "stock ownership",
    "shares",
    "stake",
    "holdings",
    "content consists",
    "content include",
    "content includes",
    "u s melted",
    "melted and poured",
    "smelted and cast",
    "by weight",
    "threshold",
    "currently the threshold",
    "at least",
    "qualify for",
    "if their capital equipment",
    "newsletter",
    "subscribe",
    "updated",
    "published",
  ]);
}

function hasBusinessShockContext(context: string) {
  const text = normalize(context);

  return containsAny(text, [
    "tariff",
    "tariffs",
    "levy",
    "levies",
    "duty",
    "duties",
    "section 232",
    "import",
    "imports",
    "freight",
    "container",
    "shipping",
    "truckload",
    "surcharge",
    "gri",
    "steel",
    "copper",
    "aluminum",
    "aluminium",
    "commodity",
    "price",
    "prices",
    "cost",
    "costs",
    "demand",
    "orders",
    "sales",
    "pmi",
    "production",
    "manufacturing",
  ]);
}

function addShockIfValid(
  shocks: QuantifiedShock[],
  input: {
    valuePct: number;
    context: string;
    shockType?: QuantifiedShock["shock_type"];
    direction?: QuantifiedShock["direction"];
    metric: string;
    confidence: QuantifiedShock["confidence"];
    extractionMethod: QuantifiedShock["extraction_method"];
  }
) {
  if (!Number.isFinite(input.valuePct)) return;
  if (input.valuePct <= 0) return;
  if (input.valuePct > 75) return;
  if (hasBadNumericContext(input.context)) return;
  if (!hasBusinessShockContext(input.context)) return;

  shocks.push({
    shock_type: input.shockType || shockTypeFromContext(input.context),
    value_pct: input.valuePct,
    direction: input.direction || directionFromContext(input.context),
    metric: input.metric,
    basis: input.context.slice(0, 420),
    confidence: input.confidence,
    validated_source_text: true,
    extraction_method: input.extractionMethod,
  });
}

function dedupeShocks(shocks: QuantifiedShock[]) {
  const seen = new Set<string>();

  return shocks.filter((shock) => {
    const key = `${shock.shock_type}:${shock.value_pct}:${shock.metric}:${normalize(
      shock.basis
    ).slice(0, 120)}`;

    if (seen.has(key)) return false;

    seen.add(key);
    return true;
  });
}

function extractQuantifiedShocksFromEvent(event: RawEvent): QuantifiedShock[] {
  const rawText = sourceTextForEvent(event);
  const shocks: QuantifiedShock[] = [];

  const fromToPattern =
    /\bfrom\s+(\d+(?:\.\d+)?)\s*(?:%|percent|percentage points?)\s+(?:to|up to|down to|into)\s+(\d+(?:\.\d+)?)\s*(?:%|percent|percentage points?)/gi;

  for (const match of rawText.matchAll(fromToPattern)) {
    const first = Number(match[1]);
    const second = Number(match[2]);
    const context = getContextWindow(rawText, match.index || 0);
    const isTariff = shockTypeFromContext(context) === "tariff_rate";

    if (!Number.isFinite(first) || !Number.isFinite(second)) continue;

    if (isTariff) {
      addShockIfValid(shocks, {
        valuePct: first,
        context,
        shockType: "tariff_rate",
        direction: second >= first ? "up" : "down",
        metric: "starting_tariff_rate_level",
        confidence: "high",
        extractionMethod: "deterministic_regex",
      });

      addShockIfValid(shocks, {
        valuePct: second,
        context,
        shockType: "tariff_rate",
        direction: second >= first ? "up" : "down",
        metric: "ending_tariff_rate_level",
        confidence: "high",
        extractionMethod: "deterministic_regex",
      });
    }

    addShockIfValid(shocks, {
      valuePct: Math.abs(second - first),
      context,
      shockType: isTariff ? "tariff_rate" : shockTypeFromContext(context),
      direction: second >= first ? "up" : "down",
      metric: isTariff
        ? "tariff_percentage_point_change"
        : "percentage_point_change",
      confidence: "high",
      extractionMethod: "deterministic_regex",
    });
  }

  const tariffLevelPatterns = [
    /\b(\d+(?:\.\d+)?)\s*(?:%|percent)\s+(?:tariff|tariffs|levy|levies|duty|duties|rate|rates)\b/gi,
    /\b(?:tariff|tariffs|levy|levies|duty|duties|rate|rates)\s+(?:of|at|to|is|are|was|were|charged for|set at|face|faced|apply|applies)?\s*(\d+(?:\.\d+)?)\s*(?:%|percent)\b/gi,
    /\b(?:reduced|lowered|cut|down)\s+(?:to\s+)?(\d+(?:\.\d+)?)\s*(?:%|percent)\s+(?:tariff|tariffs|levy|levies|duty|duties|rate|rates)?\b/gi,
    /\b(?:hiked|raised|increased|jumped|boosted|lifted|doubled)\s+(?:[^.]{0,120}?)\s+(?:to\s+)?(\d+(?:\.\d+)?)\s*(?:%|percent)\b/gi,
  ];

  for (const pattern of tariffLevelPatterns) {
    for (const match of rawText.matchAll(pattern)) {
      const value = Number(match[1]);
      const context = getContextWindow(rawText, match.index || 0);

      if (shockTypeFromContext(context) !== "tariff_rate") continue;

      addShockIfValid(shocks, {
        valuePct: value,
        context,
        shockType: "tariff_rate",
        metric: "tariff_rate_level",
        confidence: "high",
        extractionMethod: "deterministic_regex",
      });
    }
  }

  const freightPattern =
    /\b(?:freight|container|shipping|truckload|ocean|spot|gri|surcharge|rates?)\b.{0,120}?(\d+(?:\.\d+)?)\s*(?:%|percent)\b|\b(\d+(?:\.\d+)?)\s*(?:%|percent)\b.{0,120}?\b(?:freight|container|shipping|truckload|ocean|spot|gri|surcharge|rates?)\b/gi;

  for (const match of rawText.matchAll(freightPattern)) {
    const value = Number(match[1] || match[2]);
    const context = getContextWindow(rawText, match.index || 0);

    addShockIfValid(shocks, {
      valuePct: value,
      context,
      shockType: "freight_rate",
      metric: "freight_rate_percent_mention",
      confidence: "medium",
      extractionMethod: "deterministic_regex",
    });
  }

  const commodityPricePattern =
    /\b(?:steel|copper|aluminum|aluminium|industrial metals|metal prices|commodity prices)\b.{0,120}?(\d+(?:\.\d+)?)\s*(?:%|percent)\b|\b(\d+(?:\.\d+)?)\s*(?:%|percent)\b.{0,120}?\b(?:steel|copper|aluminum|aluminium|industrial metals|metal prices|commodity prices)\b/gi;

  for (const match of rawText.matchAll(commodityPricePattern)) {
    const value = Number(match[1] || match[2]);
    const context = getContextWindow(rawText, match.index || 0);

    addShockIfValid(shocks, {
      valuePct: value,
      context,
      shockType: "commodity_price",
      metric: "commodity_price_percent_mention",
      confidence: "medium",
      extractionMethod: "deterministic_regex",
    });
  }

  return dedupeShocks(shocks).slice(0, 16);
}

function validateGeminiShocksAgainstEvent(
  event: RawEvent,
  candidates: any[]
): QuantifiedShock[] {
  const rawText = sourceTextForEvent(event);
  const accepted: QuantifiedShock[] = [];

  for (const candidate of candidates || []) {
    const value = Number(candidate.value_pct);
    if (!Number.isFinite(value) || value <= 0 || value > 75) continue;

    const contexts = percentValueContexts(value, rawText);

    if (contexts.length === 0) continue;

    const context =
      contexts.find(
        (item) => !hasBadNumericContext(item) && hasBusinessShockContext(item)
      ) || "";

    if (!context) continue;

    const rawShockType = String(candidate.shock_type || "other");
    const shockType = [
      "commodity_price",
      "tariff_rate",
      "freight_rate",
      "demand_metric",
      "competitor_metric",
      "other",
    ].includes(rawShockType)
      ? (rawShockType as QuantifiedShock["shock_type"])
      : shockTypeFromContext(context);

    const rawDirection = String(candidate.direction || "unknown");
    const direction = ["up", "down", "mixed", "unknown"].includes(rawDirection)
      ? (rawDirection as QuantifiedShock["direction"])
      : directionFromContext(context);

    const rawConfidence = String(candidate.confidence || "medium");
    const confidence = ["high", "medium", "low"].includes(rawConfidence)
      ? (rawConfidence as QuantifiedShock["confidence"])
      : "medium";

    accepted.push({
      shock_type: shockType,
      value_pct: value,
      direction,
      metric: String(candidate.metric || "gemini_validated_percent_mention"),
      basis: context.slice(0, 420),
      confidence,
      validated_source_text: true,
      extraction_method: "gemini_candidate_validated",
    });
  }

  return dedupeShocks(accepted);
}
function countMatches(text: string, terms: string[]) {
  const n = normalize(text);
  return terms.filter((term) => n.includes(normalize(term))).length;
}

function sourceQuality(event: RawEvent) {
  const domain = domainFromUrl(event.source_url);
  const sourceName = normalize(event.source_name);
  const combined = `${domain} ${sourceName}`;

  if (containsAny(combined, BLOCKED_SOURCE_NAMES)) {
    return {
      score: 0,
      tier: "blocked",
      reason: `Blocked source: ${event.source_name || domain}`,
    };
  }

  if (containsAny(combined, TIER_1_SOURCE_NAMES)) {
    return {
      score: 95,
      tier: "tier_1",
      reason: `Tier 1 source: ${event.source_name || domain}`,
    };
  }

  if (containsAny(combined, TIER_2_SOURCE_NAMES)) {
    return {
      score: 82,
      tier: "tier_2",
      reason: `Tier 2 source: ${event.source_name || domain}`,
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
    score: Math.max(50, num(event.source_quality, 50)),
    tier: "tier_3",
    reason: `Unclassified source: ${event.source_name || domain || "unknown"}`,
  };
}

function inferFallbackRelevance(event: RawEvent) {
  const text = sourceTextForEvent(event, 10000);
  const n = normalize(text);

  let score = 0;

  score += Math.min(55, countMatches(n, HIGH_SIGNAL_TERMS) * 8);

  if (n.includes("fastenal")) score += 25;
  if (n.includes("grainger")) score += 18;
  if (n.includes("msc industrial")) score += 18;
  if (n.includes("applied industrial")) score += 18;

  if (n.includes("steel") && n.includes("tariff")) score += 25;
  if (n.includes("aluminum") && n.includes("tariff")) score += 25;
  if (n.includes("copper") && n.includes("tariff")) score += 22;
  if (n.includes("steel") && n.includes("import")) score += 20;
  if (n.includes("fastener") && n.includes("tariff")) score += 22;
  if (n.includes("manufacturing") && n.includes("pmi")) score += 22;
  if (n.includes("construction") && n.includes("spending")) score += 18;
  if (n.includes("freight") && n.includes("rates")) score += 18;
  if (n.includes("supply chain") && n.includes("disruption")) score += 18;

  const matchedTerms = Array.isArray(event.matched_terms)
    ? event.matched_terms.length
    : 0;

  const signalTerms = Array.isArray(event.signal_terms)
    ? event.signal_terms.length
    : 0;

  score += matchedTerms * 8;
  score += signalTerms * 10;

  return clamp(score, 0, 100);
}

function backendRejectReason(event: RawEvent) {
  const source = sourceQuality(event);
  const title = event.title || "";
  const description = event.description || "";
  const sourceName = event.source_name || "";
  const combined = `${title} ${description} ${sourceName}`;

  if (source.tier === "blocked") {
    return source.reason;
  }

  if (containsAny(combined, HARD_REJECT_TERMS)) {
    return "Rejected investment ownership / valuation noise";
  }

  if (source.score < 50) {
    return `Rejected low source quality: ${source.score}`;
  }

  const relevance = Math.max(num(event.relevance_seed_score, 0), inferFallbackRelevance(event));

  if (relevance < 35) {
    return `Rejected low relevance: ${relevance}`;
  }

  return null;
}

function rankEvent(event: RawEvent) {
  const source = sourceQuality(event);
  const relevance = Math.max(num(event.relevance_seed_score, 0), inferFallbackRelevance(event));
  const ageDays = num(event.event_age_days, 7);

  const matchedTermBoost = Array.isArray(event.matched_terms)
    ? event.matched_terms.length * 4
    : 0;

  const signalTermBoost = Array.isArray(event.signal_terms)
    ? event.signal_terms.length * 5
    : 0;

  const freshnessPenalty = Math.min(20, ageDays * 1.5);

  return (
    relevance * 0.55 +
    source.score * 0.35 +
    matchedTermBoost +
    signalTermBoost -
    freshnessPenalty
  );
}

function inferRuleBasedScore(event: RawEvent): ScoredEvent {
  const text = normalize(sourceTextForEvent(event, 15000));
  const source = sourceQuality(event);
  const relevance = Math.max(
    num(event.relevance_seed_score, 0),
    inferFallbackRelevance(event)
  );

  let impactType = "other";
  let impactLevel = "medium";
  let direction = "unknown";
  let why = "Potentially relevant external signal for company monitoring.";
  let action =
    "Review the signal and decide whether it affects current operating assumptions.";

  const entities: string[] = [];

  if (text.includes("fastenal")) entities.push("Fastenal");
  if (text.includes("grainger")) entities.push("W.W. Grainger");
  if (text.includes("msc industrial")) entities.push("MSC Industrial Direct");
  if (text.includes("applied industrial")) {
    entities.push("Applied Industrial Technologies");
  }
  if (text.includes("steel")) entities.push("Steel");
  if (text.includes("aluminum") || text.includes("aluminium")) {
    entities.push("Aluminum");
  }
  if (text.includes("copper")) entities.push("Copper");
  if (text.includes("manufacturing")) entities.push("Manufacturing Customers");
  if (text.includes("construction")) entities.push("Construction Customers");
  if (text.includes("freight") || text.includes("logistics")) {
    entities.push("Freight");
  }

  if (
    text.includes("tariff") ||
    text.includes("tariffs") ||
    text.includes("duties") ||
    text.includes("duty") ||
    text.includes("section 232") ||
    text.includes("steel") ||
    text.includes("aluminum") ||
    text.includes("copper") ||
    text.includes("imports")
  ) {
    impactType = "commodity_cost";
    impactLevel = "high";
    direction = "negative";
    why =
      "Commodity or tariff signal may affect input costs, pass-through timing, and margin exposure.";
    action =
      "Review exposed commodity spend, pass-through coverage, tariff treatment, and supplier alternatives.";
  } else if (
    text.includes("freight") ||
    text.includes("truckload") ||
    text.includes("container") ||
    text.includes("shipping") ||
    text.includes("port") ||
    text.includes("supply chain")
  ) {
    impactType = "supply_chain";
    impactLevel = "medium";
    direction = "negative";
    why =
      "Supply chain or logistics signal may affect freight cost, lead time, and service levels.";
    action =
      "Review freight exposure, carrier contracts, supplier lead times, and expedite cost risk.";
  } else if (
    text.includes("grainger") ||
    text.includes("msc industrial") ||
    text.includes("applied industrial")
  ) {
    impactType = "competitor_pressure";
    impactLevel = "medium";
    direction = "negative";
    why =
      "Competitor signal may affect pricing pressure, customer retention, or account defense priorities.";
    action =
      "Review affected customer segments, quote-loss risk, and competitive response options.";
  } else if (
    text.includes("manufacturing") ||
    text.includes("pmi") ||
    text.includes("industrial production") ||
    text.includes("factory orders")
  ) {
    impactType = "customer_demand";
    impactLevel = "medium";
    direction =
      text.includes("soften") || text.includes("decline") ? "negative" : "mixed";
    why =
      "Manufacturing or industrial demand signal may affect order frequency and revenue assumptions.";
    action =
      "Review sales assumptions, backlog, quote volume, and customer demand indicators.";
  }

  const confidence = clamp(
    Math.round(relevance * 0.55 + source.score * 0.35),
    45,
    90
  );

  const strategicScore = clamp(
    Math.round(relevance * 0.6 + confidence * 0.4),
    40,
    95
  );

  return {
    raw_event_id: event.id,
    relevant: impactType !== "other",
    impact_type: impactType,
    impact_level: impactLevel,
    confidence,
    strategic_score: strategicScore,
    why_it_matters: why,
    recommended_action: action,
    direction,
    matched_entities: [...new Set(entities)],
    quantified_shocks: extractQuantifiedShocksFromEvent(event),
  };
}

async function callGemini(events: RawEvent[]) {
  const apiKey =
    Deno.env.get("GEMINI_API_KEY") ||
    Deno.env.get("GOOGLE_GENERATIVE_AI_API_KEY") ||
    Deno.env.get("GOOGLE_API_KEY");

  if (!apiKey) {
    return events.map(inferRuleBasedScore);
  }

  const model = Deno.env.get("GEMINI_MODEL") || "gemini-2.5-flash";

  const compactEvents = events.map((event) => ({
    raw_event_id: event.id,
    title: event.title,
    description: event.description || "",
    source_text_excerpt: sourceTextForEvent(event, 5000),
    source_name: event.source_name,
    source_quality: sourceQuality(event).score,
    relevance_seed_score: Math.max(
      num(event.relevance_seed_score, 0),
      inferFallbackRelevance(event)
    ),
    matched_terms: event.matched_terms || [],
    signal_terms: event.signal_terms || [],
    query_text: event.query_text || "",
    published_at: event.published_at,
  }));

  const prompt = `
You are scoring external news for GroundSense, an executive intelligence system.

Company context:
- Company: Fastenal
- Industry: Industrial Distribution
- Customers: Manufacturing, Construction, Utilities, Industrial Maintenance
- Competitors: W.W. Grainger, MSC Industrial Direct, Applied Industrial Technologies
- Commodities: Steel, Copper, Aluminum, Freight
- Suppliers: China Fastener Supplier, Mexico Tool Supplier, US Safety Equipment Supplier, Vietnam Hardware Supplier

Task:
Score each news item for whether it is relevant to Fastenal's operating risks or opportunities.

Hard rules:
- Reject pure stock ownership, investor position, valuation, price target, and analyst-rating articles.
- Reject entertainment, sports, crime, consumer product, and unrelated politics.
- Relevant signals include tariffs, steel, aluminum, copper, fasteners, freight, supplier disruption, manufacturing demand, construction demand, competitor operations, pricing, fulfillment, inventory, guidance, margin, and sales.
- Be conservative. If the article is not clearly relevant, relevant=false.

Candidate quantified shock rules:
- You may suggest candidate_quantified_shocks, but only when the exact number appears in source_text_excerpt as "%", "percent", or "percentage points".
- Do not infer, estimate, average, or invent percentages.
- Do not extract source quality, confidence, relevance, probability, stock ownership, content thresholds, dates, or "85% U.S. content" style thresholds.
- For tariff articles, valid candidates include explicit tariff, duty, levy, or rate levels such as "15% tariff", "25% rate", or "levies to 50%".
- Include a short basis_quote copied from the source_text_excerpt around the number.

Return ONLY valid JSON in this exact shape:
[
  {
    "raw_event_id": "uuid",
    "relevant": true,
    "impact_type": "commodity_cost | competitor_pressure | customer_demand | supply_chain | supplier_disruption | service_level | company_financial | other",
    "impact_level": "low | medium | high",
    "confidence": 0,
    "strategic_score": 0,
    "why_it_matters": "one sentence",
    "recommended_action": "one sentence",
    "direction": "positive | negative | mixed | unknown",
    "matched_entities": ["Steel"],
    "candidate_quantified_shocks": [
      {
        "shock_type": "commodity_price | tariff_rate | freight_rate | demand_metric | competitor_metric | other",
        "value_pct": 15,
        "direction": "up | down | mixed | unknown",
        "metric": "tariff_rate_level",
        "basis_quote": "exact short source text around the number",
        "confidence": "high | medium | low"
      }
    ]
  }
]

Events:
${JSON.stringify(compactEvents, null, 2)}
`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }],
          },
        ],
        generationConfig: {
          temperature: 0.05,
          maxOutputTokens: 8192,
        },
      }),
    }
  );

  if (!response.ok) {
    console.log("Gemini HTTP error", response.status, await response.text());
    return events.map(inferRuleBasedScore);
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";

  const cleaned = String(text)
    .replace(/```json/g, "")
    .replace(/```/g, "")
    .trim();

  try {
    const parsed = JSON.parse(cleaned);

    if (!Array.isArray(parsed)) {
      return events.map(inferRuleBasedScore);
    }

    const parsedById = new Map(
      parsed.map((item: any) => [String(item.raw_event_id || ""), item])
    );

    return events.map((event) => {
      const ruleScore = inferRuleBasedScore(event);
      const item = parsedById.get(event.id);

      if (!item) return ruleScore;

      const validatedGeminiShocks = validateGeminiShocksAgainstEvent(
        event,
        Array.isArray(item.candidate_quantified_shocks)
          ? item.candidate_quantified_shocks
          : []
      );

      return {
        raw_event_id: event.id,
        relevant: Boolean(item.relevant),
        impact_type: String(item.impact_type || "other"),
        impact_level: String(item.impact_level || "medium"),
        confidence: clamp(Math.round(num(item.confidence, 50)), 0, 100),
        strategic_score: clamp(
          Math.round(num(item.strategic_score, 50)),
          0,
          100
        ),
        why_it_matters: String(item.why_it_matters || ruleScore.why_it_matters),
        recommended_action: String(
          item.recommended_action || ruleScore.recommended_action
        ),
        direction: String(item.direction || "unknown"),
        matched_entities: Array.isArray(item.matched_entities)
          ? item.matched_entities.map(String)
          : ruleScore.matched_entities,
        quantified_shocks: dedupeShocks([
          ...ruleScore.quantified_shocks,
          ...validatedGeminiShocks,
        ]).slice(0, 16),
      } as ScoredEvent;
    });
  } catch (error) {
    console.log("Gemini parse error", error, cleaned.slice(0, 1000));
    return events.map(inferRuleBasedScore);
  }
}

function chunk<T>(items: T[], size: number) {
  const result: T[][] = [];

  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size));
  }

  return result;
}

async function insertAssessments(
  supabase: any,
  companyId: string,
  scores: ScoredEvent[]
) {
  if (scores.length === 0) {
    return {
      inserted: 0,
      insertErrors: 0,
    };
  }

  const rawEventIds = scores.map((score) => score.raw_event_id).filter(Boolean);

  if (rawEventIds.length > 0) {
    await supabase
      .from("event_assessments")
      .delete()
      .eq("company_id", companyId)
      .in("raw_event_id", rawEventIds);
  }

  console.log(
    "quantified shock extraction sample",
    scores
      .filter((score) => score.quantified_shocks?.length)
      .slice(0, 15)
      .map((score) => ({
        raw_event_id: score.raw_event_id,
        impact_type: score.impact_type,
        shocks: score.quantified_shocks,
      }))
  );

  const rows = scores.map((score) => ({
    company_id: companyId,
    raw_event_id: score.raw_event_id,
    relevant: score.relevant,
    impact_type: score.impact_type,
    impact_level: score.impact_level,
    confidence: score.confidence,
    strategic_score: score.strategic_score,
    why_it_matters: score.why_it_matters,
    recommended_action: score.recommended_action,
    direction: score.direction,
    matched_entities: score.matched_entities,
    metadata: {
      scorer_version: SCORER_VERSION,
      source_quality_filtered: true,
      quantified_shocks: score.quantified_shocks || [],
      has_quantified_shock: Boolean(score.quantified_shocks?.length),
      shock_extraction_policy:
        "Gemini candidates are used only after exact source-text validation.",
    },
  }));

  const { error } = await supabase.from("event_assessments").insert(rows);

  if (!error) {
    return {
      inserted: rows.length,
      insertErrors: 0,
    };
  }

  console.log("event_assessments full insert failed", error.message);

  const fallbackRows = scores.map((score) => ({
    company_id: companyId,
    raw_event_id: score.raw_event_id,
    relevant: score.relevant,
    impact_type: score.impact_type,
    impact_level: score.impact_level,
    confidence: score.confidence,
    strategic_score: score.strategic_score,
    why_it_matters: score.why_it_matters,
    recommended_action: score.recommended_action,
    direction: score.direction,
    matched_entities: score.matched_entities,
    metadata: {
      scorer_version: `${SCORER_VERSION}-fallback`,
      source_quality_filtered: true,
      quantified_shocks: score.quantified_shocks || [],
      has_quantified_shock: Boolean(score.quantified_shocks?.length),
    },
  }));

  const fallback = await supabase.from("event_assessments").insert(fallbackRows);

  if (fallback.error) {
    console.log("event_assessments fallback insert failed", fallback.error.message);

    return {
      inserted: 0,
      insertErrors: scores.length,
    };
  }

  return {
    inserted: fallbackRows.length,
    insertErrors: 0,
  };
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

    const {
      companyId,
      mode = "batch",
      maxEvents = DEFAULT_MAX_EVENTS,
      candidateRawEventIds = [],
      sourceQualityFiltered = false,
    } = await req.json();

    if (!companyId) {
      return jsonResponse(
        {
          error: "Missing companyId",
        },
        400
      );
    }

    const cleanCandidateRawEventIds = Array.isArray(candidateRawEventIds)
      ? candidateRawEventIds.filter(Boolean)
      : [];

    let rawEventQuery = supabase
      .from("raw_events")
      .select("*")
      .eq("company_id", companyId)
      .is("rejected_reason", null)
      .order("relevance_seed_score", { ascending: false, nullsFirst: false })
      .order("published_at", { ascending: false, nullsFirst: false })
      .limit(Number(maxEvents) || DEFAULT_MAX_EVENTS);

    if (cleanCandidateRawEventIds.length > 0) {
      rawEventQuery = supabase
  .from("raw_events")
  .select("*")
  .eq("company_id", companyId)
  .in("id", cleanCandidateRawEventIds);
    }

    const { data: rawEventsData, error: rawEventsError } = await rawEventQuery;

    if (rawEventsError) {
      return jsonResponse(
        {
          error: rawEventsError.message,
          stage: "load_raw_events",
        },
        500
      );
    }

    const rawEvents = (rawEventsData || []) as RawEvent[];

    const cleanRawEvents = rawEvents
      .filter((event) => !backendRejectReason(event))
      .sort((a, b) => rankEvent(b) - rankEvent(a))
      .slice(0, Number(maxEvents) || DEFAULT_MAX_EVENTS);

    console.log("score-events raw event load", {
      companyId,
      mode,
      requestedCandidateIds: cleanCandidateRawEventIds.length,
      rawEventsLoaded: rawEvents.length,
      cleanRawEvents: cleanRawEvents.length,
      sourceQualityFiltered,
      topCleanEvents: cleanRawEvents.slice(0, 10).map((event) => ({
        title: event.title,
        source: event.source_name,
        sourceQuality: sourceQuality(event),
        relevance: Math.max(num(event.relevance_seed_score, 0), inferFallbackRelevance(event)),
        rank: Math.round(rankEvent(event)),
      })),
    });

    const batches = chunk(cleanRawEvents, BATCH_SIZE);

    let allScores: ScoredEvent[] = [];
    let geminiErrors = 0;
    let parseErrors = 0;

    for (const batch of batches) {
      try {
        const scores = await callGemini(batch);

        allScores = allScores.concat(
          scores.filter((score) =>
            batch.some((event) => event.id === score.raw_event_id)
          )
        );
      } catch (error) {
        geminiErrors += 1;
        console.log("Gemini batch failed, falling back to rules", error);
        allScores = allScores.concat(batch.map(inferRuleBasedScore));
      }
    }

    allScores = allScores.map((score) => ({
      ...score,
      confidence: clamp(Math.round(num(score.confidence, 50)), 0, 100),
      strategic_score: clamp(Math.round(num(score.strategic_score, 50)), 0, 100),
      relevant: Boolean(score.relevant) && score.impact_type !== "other",
    }));

    const insertResult = await insertAssessments(supabase, companyId, allScores);

    const relevant = allScores.filter((score) => score.relevant).length;
    const irrelevant = allScores.length - relevant;

    return jsonResponse({
      mode,
      scorer_version: SCORER_VERSION,
      sourceQualityFiltered,
      requested_candidate_ids: cleanCandidateRawEventIds.length,
      raw_events_loaded: rawEvents.length,
      candidates_after_rule_filter: cleanRawEvents.length,
      batches_attempted: batches.length,
      batch_size: BATCH_SIZE,
      scored: allScores.length,
      relevant,
      irrelevant,
      inserted: insertResult.inserted,
      insertErrors: insertResult.insertErrors,
      geminiErrors,
      parseErrors,
      remaining_unscored_estimate: 0,
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