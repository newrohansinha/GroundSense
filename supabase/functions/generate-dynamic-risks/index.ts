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

function cleanText(value: unknown, max = 3000) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function safeArray(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}


function norm(value: unknown) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function includesAny(text: string, terms: string[]) {
  return terms.some((term) => text.includes(term));
}

function uniqueNumbers(values: number[]) {
  return [...new Set(values.filter((value) => Number.isFinite(value) && value > 0))];
}

function articleText(item: any) {
  return norm(
    [
      item.title,
      item.description,
      item.content_text,
      item.source_name,
      item.query_text,
      item.why_it_matters,
      item.impact_type,
      ...(Array.isArray(item.affected_areas) ? item.affected_areas : []),
    ].join(" ")
  );
}

function isGenericMarketNoise(text: string) {
  const financialMarketNoiseTerms = [
    "stock",
    "stocks",
    "share",
    "shares",
    "share price",
    "stock price",
    "market cap",
    "market capitalization",
    "analyst rating",
    "price target",
    "buy rating",
    "sell rating",
    "hold rating",
    "outperform",
    "underperform",
    "top pick",
    "mining pick",
    "investment case",
    "investor",
    "investors",
    "valuation",
    "fair value",
    "discounted cash flow",
    "dcf",
    "ebitda multiple",
    "earnings multiple",
    "dividend",
    "yield",
    "options now available",
    "relative strength",
    "stock watch",
    "nyse",
    "nasdaq",
    "tsx",
    "asx",
    "lse",
    "zacks",
    "motley fool",
    "insider monkey",
    "simply wall st",
    "seeking alpha",
    "proactiveinvestors",
    "marketbeat",
    "benzinga",
    "tipranks",
    "norges bank",
  ];

  const operatingOverrideTerms = [
    "tariff",
    "tariffs",
    "duty",
    "duties",
    "import cost",
    "export ban",
    "sanction",
    "freight",
    "shipping",
    "container",
    "port congestion",
    "lead time",
    "surcharge",
    "fuel cost",
    "supply disruption",
    "production outage",
    "production cut",
    "plant closure",
    "factory closure",
    "strike",
    "force majeure",
    "smelter",
    "mine disruption",
    "supplier disruption",
    "backorder",
    "inventory shortage",
    "input cost",
    "commodity cost",
    "customer demand",
    "orders fell",
    "orders rose",
    "pmi",
    "manufacturing activity",
    "construction activity",
  ];

  const hasMarketNoise = includesAny(text, financialMarketNoiseTerms);
  const hasOperatingOverride = includesAny(text, operatingOverrideTerms);

  return hasMarketNoise && !hasOperatingOverride;
}

function evidenceSupportsCluster(cluster: any, item: any) {
  const text = articleText(item);
  const riskType = norm(cluster.risk_type);
  const title = norm(cluster.risk_title);

  const isTariffRisk =
    riskType.includes("tariff") ||
    riskType.includes("trade") ||
    title.includes("tariff") ||
    title.includes("tariffs") ||
    title.includes("duty") ||
    title.includes("duties");

  const isMetalsRisk =
    title.includes("steel") ||
    title.includes("aluminum") ||
    title.includes("aluminium") ||
    title.includes("copper") ||
    title.includes("metals") ||
    riskType.includes("commodity");

  const tariffTerms = [
    "tariff",
    "tariffs",
    "duty",
    "duties",
    "import",
    "imports",
    "section 232",
    "proclamation",
    "white house",
    "trade policy",
  ];

  const directMetalTerms = [
    "steel",
    "aluminum",
    "aluminium",
    "copper",
  ];

  const broadMetalTerms = [
    "metals",
    "base metals",
  ];

  const freightTerms = [
    "freight",
    "container",
    "shipping",
    "logistics",
    "port",
    "vessel",
    "ocean",
    "air freight",
    "transportation",
    "capacity",
    "lead time",
  ];

  const demandTerms = [
    "manufacturing",
    "industrial demand",
    "pmi",
    "construction",
    "orders",
    "customer demand",
    "sales outlook",
    "capex",
    "inventory",
    "destocking",
    "restocking",
  ];

  const competitorTerms = [
    "grainger",
    "msc industrial",
    "applied industrial",
    "competitor",
    "market share",
    "pricing pressure",
    "quote",
    "churn",
  ];

  // Hard reject obvious noise first.
  if (isGenericMarketNoise(text)) {
    return false;
  }

  // For metals tariff risks, require BOTH tariff-policy language AND the exact target commodities.
  // This blocks whisky, watches, generic trade articles, and iron-ore-only articles.
  if (isTariffRisk && isMetalsRisk) {
    const hasTariffPolicy = includesAny(text, tariffTerms);
    const hasDirectTargetMetal = includesAny(text, directMetalTerms);
    const hasOnlyBroadMetal = includesAny(text, broadMetalTerms) && !hasDirectTargetMetal;

    return hasTariffPolicy && hasDirectTargetMetal && !hasOnlyBroadMetal;
  }

  // Commodity-cost risks without tariff framing still need exact commodity relevance.
  if (
    riskType.includes("commodity") ||
    title.includes("steel") ||
    title.includes("aluminum") ||
    title.includes("aluminium") ||
    title.includes("copper")
  ) {
    return includesAny(text, directMetalTerms);
  }

  if (
    riskType.includes("freight") ||
    riskType.includes("logistics") ||
    riskType.includes("supplier") ||
    title.includes("freight") ||
    title.includes("shipping")
  ) {
    return includesAny(text, freightTerms);
  }

  if (
    riskType.includes("demand") ||
    riskType.includes("macro") ||
    title.includes("demand")
  ) {
    return includesAny(text, demandTerms);
  }

  if (
    riskType.includes("competitor") ||
    title.includes("competitor") ||
    title.includes("competitive")
  ) {
    return includesAny(text, competitorTerms);
  }

  return true;
}

function getCleanEvidenceIndexes(cluster: any, evidence: any[]) {
  const rawIndexes = uniqueNumbers(
    safeArray(cluster.evidence_indexes)
      .map((value) => Number(value))
      .filter((value) => value >= 1 && value <= evidence.length)
  );

  const cleanIndexes = rawIndexes.filter((index) =>
    evidenceSupportsCluster(cluster, evidence[index - 1])
  );

  // Allow a risk with 2 very direct articles rather than padding it with weak articles.
  return cleanIndexes.slice(0, 8);
}
function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  const n = Number(value);

  if (!Number.isFinite(n)) return fallback;

  return Math.max(min, Math.min(max, n));
}

function parseJsonFromGemini(text: string) {
  const raw = String(text || "").trim();

  const cleaned = raw
    .replace(/^```json/i, "")
    .replace(/^```/i, "")
    .replace(/```$/i, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    const objectMatch = cleaned.match(/\{[\s\S]*\}/);

    if (objectMatch) {
      try {
        return JSON.parse(objectMatch[0]);
      } catch {
        // fall through
      }
    }

    throw new Error(
      `Gemini response did not contain valid JSON. Raw response: ${cleaned.slice(
        0,
        1500
      )}`
    );
  }
}

async function callGemini(prompt: string) {
  const apiKey = Deno.env.get("GEMINI_API_KEY");

  if (!apiKey) {
    throw new Error("Missing GEMINI_API_KEY secret.");
  }

  const model = Deno.env.get("GEMINI_MODEL") || "gemini-2.5-flash-lite";

  async function generate(textPrompt: string) {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          generationConfig: {
            temperature: 0.05,
            topP: 0.8,
            maxOutputTokens: 12000,
            responseMimeType: "application/json",
          },
          contents: [
            {
              role: "user",
              parts: [{ text: textPrompt }],
            },
          ],
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();

      throw new Error(
        `Gemini error ${response.status}: ${errorText.slice(0, 1200)}`
      );
    }

    const data = await response.json();

    const text =
      data?.candidates?.[0]?.content?.parts
        ?.map((part: any) => part.text || "")
        .join("\n") || "";

    return text;
  }

  const firstText = await generate(prompt);

  try {
    return parseJsonFromGemini(firstText);
  } catch {
    const repairPrompt = `
You returned invalid or truncated JSON.

Repair the following text into valid compact JSON.
Return ONLY valid JSON.
Do not add markdown.
Do not add explanation.

Required top-level schema:
{
  "risk_clusters": []
}

Broken JSON:
${firstText.slice(0, 9000)}
`;

    const repairedText = await generate(repairPrompt);

    return parseJsonFromGemini(repairedText);
  }
}

function formatMoneyForPath(value: number) {
  if (value >= 1_000_000_000) {
    return `$${(value / 1_000_000_000).toFixed(1)}B`;
  }

  if (value >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(1)}M`;
  }

  if (value >= 1_000) {
    return `$${(value / 1_000).toFixed(0)}K`;
  }

  return `$${value.toFixed(0)}`;
}

function evidenceMultiplier(count: number) {
  return Math.min(1.18, 1 + Math.log10(count + 1) * 0.08);
}

function qualityMultiplier(score: number) {
  return Math.max(0.75, Math.min(1.15, score / 80));
}

function numberOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") return null;

  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function positiveNumberOrNull(value: unknown) {
  const n = numberOrNull(value);
  return n !== null && n > 0 ? n : null;
}

function pctDecimalOrNull(value: unknown) {
  const n = numberOrNull(value);
  if (n === null) return null;

  return Math.max(0, Math.min(1, n / 100));
}

function sumNumbers(values: Array<number | null>) {
  return values.reduce((sum, value) => sum + Number(value || 0), 0);
}

function weightedPct(rows: any[], field: string, weightField: string) {
  let weightedTotal = 0;
  let totalWeight = 0;

  for (const row of rows) {
    const value = pctDecimalOrNull(row?.[field]);
    const weight = positiveNumberOrNull(row?.[weightField]) || 1;

    if (value === null) continue;

    weightedTotal += value * weight;
    totalWeight += weight;
  }

  if (totalWeight <= 0) return null;

  return weightedTotal / totalWeight;
}

function weightedNumber(rows: any[], field: string, weightField: string) {
  let weightedTotal = 0;
  let totalWeight = 0;

  for (const row of rows) {
    const value = numberOrNull(row?.[field]);
    const weight = positiveNumberOrNull(row?.[weightField]) || 1;

    if (value === null) continue;

    weightedTotal += value * weight;
    totalWeight += weight;
  }

  if (totalWeight <= 0) return null;

  return weightedTotal / totalWeight;
}

function money(value: number) {
  return formatMoneyForPath(value);
}

function riskCalculationText(cluster: any, evidenceItems: any[]) {
  return norm(
    [
      cluster.risk_title,
      cluster.risk_type,
      cluster.what_happened,
      cluster.business_impact,
      cluster.decision_required,
      ...(safeArray(cluster.affected_commodities) || []),
      ...(safeArray(cluster.affected_customers) || []),
      ...(safeArray(cluster.affected_suppliers) || []),
      ...evidenceItems.map((item: any) => item.title),
      ...evidenceItems.map((item: any) => item.why_it_matters),
    ].join(" ")
  );
}

function scenarioShockRangeForRiskFamily(riskFamily: string) {
  if (riskFamily === "logistics") {
    return {
      low: 0.03,
      mid: 0.075,
      high: 0.12,
      source: "scenario_fallback_no_new_explicit_shock",
      label: "Freight-rate scenario",
      basis:
        "No new incremental freight-rate percentage was verified in stored source text. GroundSense shows scenario assumptions instead.",
      scenario_assumptions: {
        low: 0.03,
        mid: 0.075,
        high: 0.12,
      },
      explicit_shocks: [],
      rejected_explicit_shocks: [],
    };
  }

  if (riskFamily === "commodity") {
    return {
      low: 0.03,
      mid: 0.055,
      high: 0.08,
      source: "scenario_fallback_no_new_explicit_shock",
      label: "Commodity/tariff scenario",
      basis:
        "No new incremental commodity price, tariff, duty, or levy percentage was verified in stored source text. GroundSense shows scenario assumptions instead.",
      scenario_assumptions: {
        low: 0.03,
        mid: 0.055,
        high: 0.08,
      },
      explicit_shocks: [],
      rejected_explicit_shocks: [],
    };
  }

  if (riskFamily === "demand") {
    return {
      low: 0.005,
      mid: 0.01,
      high: 0.015,
      source: "scenario_fallback_no_new_explicit_shock",
      label: "Demand scenario",
      basis:
        "No new incremental demand percentage was verified in stored source text. GroundSense shows scenario assumptions instead.",
      scenario_assumptions: {
        low: 0.005,
        mid: 0.01,
        high: 0.015,
      },
      explicit_shocks: [],
      rejected_explicit_shocks: [],
    };
  }

  if (riskFamily === "competitor") {
    return {
      low: 0.0025,
      mid: 0.00625,
      high: 0.01,
      source: "scenario_fallback_no_new_explicit_shock",
      label: "Competitive leakage scenario",
      basis:
        "No new incremental competitive share, quote, churn, or pricing percentage was verified in stored source text. GroundSense shows scenario assumptions instead.",
      scenario_assumptions: {
        low: 0.0025,
        mid: 0.00625,
        high: 0.01,
      },
      explicit_shocks: [],
      rejected_explicit_shocks: [],
    };
  }

  return {
    low: 0.005,
    mid: 0.01,
    high: 0.015,
    source: "scenario_fallback_no_new_explicit_shock",
    label: "Generic operating scenario",
    basis:
      "No new incremental percentage was verified in stored source text. GroundSense shows scenario assumptions instead.",
    scenario_assumptions: {
      low: 0.005,
      mid: 0.01,
      high: 0.015,
    },
    explicit_shocks: [],
    rejected_explicit_shocks: [],
  };
}

function collectQuantifiedShocksFromEvidence(input: {
  riskFamily: string;
  evidenceItems: any[];
}) {
  const allShocks = input.evidenceItems.flatMap((item: any) => {
    const direct = Array.isArray(item.quantified_shocks)
      ? item.quantified_shocks
      : [];

    const fromMetadata = Array.isArray(item.metadata?.quantified_shocks)
      ? item.metadata.quantified_shocks
      : [];

    return [...direct, ...fromMetadata].map((shock: any) => ({
      ...shock,
      _evidence_title: item.title || "",
      _evidence_source: item.source || item.source_name || "",
      _evidence_url: item.url || item.source_url || "",
    }));
  });

  return allShocks.filter((shock: any) => {
    const value = Number(shock.value_pct);

    if (!Number.isFinite(value)) return false;
if (value <= 0) return false;
if (shock.validated_source_text !== true) return false;

    const type = String(shock.shock_type || "");
    const metric = String(shock.metric || "");

    if (input.riskFamily === "logistics") {
      if (!(type === "freight_rate" || metric.includes("freight"))) {
        return false;
      }

      return value <= 300;
    }

    if (input.riskFamily === "commodity") {
      if (
        !(
          type === "tariff_rate" ||
          type === "commodity_price" ||
          metric.includes("tariff") ||
          metric.includes("commodity")
        )
      ) {
        return false;
      }

      if (type === "tariff_rate" || metric.includes("tariff")) {
        return value <= 100;
      }

      return value <= 200;
    }

    if (input.riskFamily === "demand") {
      if (!(type === "demand_metric" || metric.includes("demand"))) {
        return false;
      }

      return value <= 50;
    }

    if (input.riskFamily === "competitor") {
      if (!(type === "competitor_metric" || metric.includes("competitor"))) {
        return false;
      }

      return value <= 50;
    }

    return value <= 100;
  });
}

function cleanBasisText(value: unknown) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/^[a-z]{1,12}\s/i, "")
    .trim();
}

function friendlyShockMetric(metric: string) {
  if (metric.includes("ending_tariff_rate_level")) return "current tariff rate";
  if (metric.includes("starting_tariff_rate_level")) return "prior tariff rate";
  if (metric.includes("tariff_percentage_point_change")) return "tariff rate change";
  if (metric.includes("tariff_rate_level")) return "tariff rate";
  if (metric.includes("freight")) return "freight rate";
  if (metric.includes("commodity")) return "commodity price move";
  if (metric.includes("demand")) return "demand move";
  if (metric.includes("competitor")) return "competitive impact";
  return "verified source percentage";
}

function shockSearchText(shock: any) {
  return norm(
    [
      shock.basis,
      shock.metric,
      shock.shock_type,
      shock.direction,
      shock._evidence_title,
      shock._evidence_source,
      shock._evidence_url,
    ].join(" ")
  );
}

function clusterSearchText(cluster: any) {
  return norm(
    [
      cluster.risk_title,
      cluster.risk_type,
      cluster.what_happened,
      cluster.why_now,
      cluster.business_impact,
      cluster.decision_required,
      ...(safeArray(cluster.affected_commodities) || []),
      ...(safeArray(cluster.affected_customers) || []),
      ...(safeArray(cluster.affected_suppliers) || []),
    ].join(" ")
  );
}

function isPriorTariffContext(shock: any) {
  const metric = String(shock.metric || "");
  const basis = shockSearchText(shock);

  if (metric.includes("starting_tariff_rate_level")) return true;

  return includesAny(basis, [
    "down from",
    "reduced from",
    "lowered from",
    "cut from",
    "previously",
    "prior rate",
    "old rate",
  ]);
}

function isOldBaselineOrCumulativeShock(shock: any) {
  const text = shockSearchText(shock);

  const oldBaseline = includesAny(text, [
    "since the start",
    "since start",
    "since the beginning",
    "since beginning",
    "since the iran war",
    "since iran war",
    "since the war started",
    "since war started",
    "year to date",
    "ytd",
    "since 2024",
    "since 2025",
    "since last year",
    "over the past year",
    "over the last year",
    "since the pandemic",
    "since pandemic",
  ]);

  if (!oldBaseline) return false;

 const clearlyNewIncremental = includesAny(text, [
  "new surcharge",
  "new surcharges",
  "new gri",
  "new general rate increase",
  "general rate increase effective",
  "effective this week",
  "effective this month",
  "effective june",
  "effective july",
  "effective august",
  "announced this week",
  "announced this month",
  "new tariff",
  "new duty",
  "new levy",
  "raised from",
  "increased from",
  "hiked from",
  "reduced from",
  "lowered from",
  "cut from",
]);

  return !clearlyNewIncremental;
}

function filterFreshOrIncrementalShocks(shocks: any[]) {
  return shocks.filter((shock) => !isOldBaselineOrCumulativeShock(shock));
}

function filterShocksToClusterContext(cluster: any, shocks: any[]) {
  const clusterText = clusterSearchText(cluster);

  const isUsTariffCluster = includesAny(clusterText, [
    "us ",
    "u s ",
    "united states",
    "white house",
    "trump",
    "section 232",
    "proclamation",
  ]);

  const mentionsForeignTariffNoise = (shock: any) => {
    const text = shockSearchText(shock);

    return includesAny(text, [
      "india",
      "australia",
      "south africa",
      "south african",
      "solar project",
      "solar projects",
      "rails",
      "steel tubing",
      "steel inflows from china",
    ]);
  };

  if (isUsTariffCluster) {
    const usShocks = shocks.filter(
      (shock) => !mentionsForeignTariffNoise(shock)
    );

    if (usShocks.length > 0) {
      return usShocks;
    }
  }

  return shocks;
}

function findTariffRateTransition(shocks: any[]) {
  const startingRates = shocks.filter((shock: any) =>
    String(shock.metric || "").includes("starting_tariff_rate_level")
  );

  const endingRates = shocks.filter((shock: any) =>
    String(shock.metric || "").includes("ending_tariff_rate_level")
  );

  if (startingRates.length === 0 || endingRates.length === 0) {
    return null;
  }

  const prior = Math.max(
    ...startingRates
      .map((shock: any) => Number(shock.value_pct))
      .filter((value: number) => Number.isFinite(value))
  );

  const current = Math.min(
    ...endingRates
      .map((shock: any) => Number(shock.value_pct))
      .filter((value: number) => Number.isFinite(value))
  );

  if (!Number.isFinite(prior) || !Number.isFinite(current)) {
    return null;
  }

  return {
    priorPct: prior,
    currentPct: current,
    changePctPoints: current - prior,
    direction: current > prior ? "up" : current < prior ? "down" : "flat",
  };
}

function hasAdverseShock(shocks: any[]) {
  return shocks.some((shock: any) => {
    const text = shockSearchText(shock);
    const direction = String(shock.direction || "").toLowerCase();
    const metric = String(shock.metric || "").toLowerCase();

    if (direction === "up") {
      if (
        includesAny(text, [
          "tariff",
          "duty",
          "levy",
          "freight",
          "cost",
          "price",
          "commodity",
          "surcharge",
        ])
      ) {
        return true;
      }
    }

    if (
      includesAny(text, [
        "increased",
        "raised",
        "hiked",
        "spiked",
        "surged",
        "doubled",
        "higher",
        "new tariff",
        "new duty",
        "new levy",
        "new surcharge",
        "general rate increase",
      ])
    ) {
      return true;
    }

    if (metric.includes("freight") || metric.includes("commodity_price")) {
      return direction === "up" || text.includes("increase");
    }

    return false;
  });
}

function hasFavorableShock(shocks: any[]) {
  return shocks.some((shock: any) => {
    const text = shockSearchText(shock);
    const direction = String(shock.direction || "").toLowerCase();

    if (direction === "down") {
      if (
        includesAny(text, [
          "tariff",
          "duty",
          "levy",
          "freight",
          "cost",
          "price",
          "commodity",
        ])
      ) {
        return true;
      }
    }

    return includesAny(text, [
      "reduced",
      "lowered",
      "cut",
      "down from",
      "decreased",
      "declined",
      "relief",
    ]);
  });
}

function hasResidualBurden(shocks: any[]) {
  return shocks.some((shock: any) => {
    const value = Number(shock.value_pct);
    const text = shockSearchText(shock);

    if (!Number.isFinite(value) || value <= 0) return false;

    return includesAny(text, [
      "tariff",
      "duty",
      "levy",
      "current tariff rate",
      "ending tariff rate",
      "tariff rate level",
    ]);
  });
}

function makeShockAuditBasis(usable: any[]) {
  const rows = new Map<string, string>();

  for (const shock of usable) {
    const value = Number(shock.value_pct);
    if (!Number.isFinite(value)) continue;

    const metric = String(shock.metric || shock.shock_type || "source text");
    const basis = cleanBasisText(shock.basis).slice(0, 220);
    const key = `${value}:${metric}`;

    if (!rows.has(key)) {
      rows.set(
        key,
        `${value.toFixed(1)}% ${friendlyShockMetric(metric)} — "${basis}"`
      );
    }
  }

  return [...rows.values()].slice(0, 4).join(" | ");
}

function pickRepresentativeShockPct(input: {
  riskFamily: string;
  shocks: any[];
  transition: ReturnType<typeof findTariffRateTransition>;
}) {
  if (input.transition) {
    return input.transition.currentPct;
  }

  const values = input.shocks
    .map((shock: any) => Number(shock.value_pct))
    .filter((value: number) => Number.isFinite(value) && value > 0);

  if (values.length === 0) return null;

  if (input.riskFamily === "logistics") {
    return Math.max(...values);
  }

  if (input.riskFamily === "commodity") {
    return Math.max(...values);
  }

  return Math.max(...values);
}

function inferShockInterpretation(input: {
  riskFamily: string;
  allShocks: any[];
  usable: any[];
  representativePct: number;
}) {
  const transition = findTariffRateTransition(input.allShocks);

  if (input.riskFamily === "commodity" && transition) {
    if (transition.direction === "down") {
      return {
        kind: "residual_tariff_burden_after_reduction",
        issue_category: "operating_change",
        issue_direction: "favorable_with_residual_exposure",
        label: "Verified current tariff rate",
        display_basis: `Current tariff rate: ${transition.currentPct.toFixed(
          1
        )}%; rate decreased from prior ${transition.priorPct.toFixed(1)}%.`,
        display:
          "Tariff rate decreased. This is favorable versus the prior rate, but a residual tariff burden remains. The modeled dollar amount is remaining exposure, not new downside.",
        tariff_transition: transition,
      };
    }

    if (transition.direction === "up") {
      return {
        kind: "adverse_tariff_increase",
        issue_category: "risk",
        issue_direction: "downside",
        label: "Verified tariff increase",
        display_basis: `Tariff rate increased from ${transition.priorPct.toFixed(
          1
        )}% to ${transition.currentPct.toFixed(1)}%.`,
        display:
          "Tariff rate increased. This is treated as downside cost pressure.",
        tariff_transition: transition,
      };
    }
  }

  const adverse = hasAdverseShock(input.allShocks);
  const favorable = hasFavorableShock(input.allShocks);
  const residual = hasResidualBurden(input.allShocks);

  if (adverse) {
    return {
      kind: "adverse_verified_shock",
      issue_category: "risk",
      issue_direction: "downside",
      label:
        input.riskFamily === "logistics"
          ? "Verified new freight-rate shock"
          : input.riskFamily === "commodity"
          ? "Verified new commodity/tariff shock"
          : "Verified new operating shock",
      display_basis: `~${input.representativePct.toFixed(
        1
      )}% verified as a new incremental value in stored source text.`,
      display:
        "The evidence contains a new verified cost, rate, freight, tariff, or commodity movement. GroundSense treats this as downside exposure.",
      tariff_transition: null,
    };
  }

  if (favorable && residual) {
    return {
      kind: "favorable_with_residual_burden",
      issue_category: "operating_change",
      issue_direction: "favorable_with_residual_exposure",
      label: "Verified residual burden",
      display_basis: `~${input.representativePct.toFixed(
        1
      )}% residual rate/burden verified in stored source text.`,
      display:
        "The evidence indicates a favorable movement, but a residual cost or tariff burden remains. This belongs in Operating Changes, not the downside Risk Register.",
      tariff_transition: null,
    };
  }

  if (favorable && !residual) {
    return {
      kind: "favorable_cost_relief",
      issue_category: "operating_change",
      issue_direction: "favorable",
      label: "Verified favorable movement",
      display_basis: `~${input.representativePct.toFixed(
        1
      )}% favorable movement verified in stored source text.`,
      display:
        "The evidence indicates favorable cost relief or upside. This should not be forced into the downside Risk Register.",
      tariff_transition: null,
    };
  }

  return {
    kind: "verified_but_direction_uncertain",
    issue_category: "watchlist",
    issue_direction: "mixed_or_uncertain",
    label:
      input.riskFamily === "logistics"
        ? "Verified freight-rate value"
        : input.riskFamily === "commodity"
        ? "Verified tariff/commodity value"
        : "Verified operating value",
    display_basis: `~${input.representativePct.toFixed(
      1
    )}% verified in stored source text, but direction/newness is uncertain.`,
    display:
      "The evidence contains a verified number, but direction or incremental newness is mixed or uncertain. This belongs in Watchlist unless additional evidence confirms downside.",
    tariff_transition: null,
  };
}

function resolveShockRange(input: {
  riskFamily: string;
  evidenceItems: any[];
  cluster?: any;
}) {
  const collectedShocks = collectQuantifiedShocksFromEvidence(input);

  const contextFilteredShocks = input.cluster
    ? filterShocksToClusterContext(input.cluster, collectedShocks)
    : collectedShocks;

  const usableFreshShocks = filterFreshOrIncrementalShocks(
    contextFilteredShocks
  );

  const rejectedExplicitShocks = contextFilteredShocks.filter((shock: any) =>
    isOldBaselineOrCumulativeShock(shock)
  );

  if (usableFreshShocks.length === 0) {
    const scenario = scenarioShockRangeForRiskFamily(input.riskFamily);

    return {
      ...scenario,
      display_basis: scenario.basis,
      audit_basis: scenario.basis,
      shock_interpretation: "scenario_fallback_no_new_explicit_shock",
      shock_interpretation_display: scenario.basis,
      issue_category_hint: "watchlist",
      issue_direction_hint: "uncertain",
      rejected_explicit_shocks: rejectedExplicitShocks,
    };
  }

  let usable = usableFreshShocks;

  if (input.riskFamily === "commodity") {
    const currentEndingTariffLevels = usableFreshShocks.filter((shock: any) => {
      const metric = String(shock.metric || "");

      return (
        shock.shock_type === "tariff_rate" &&
        metric.includes("ending_tariff_rate_level")
      );
    });

    const genericCurrentTariffLevels = usableFreshShocks.filter((shock: any) => {
      const metric = String(shock.metric || "");

      return (
        shock.shock_type === "tariff_rate" &&
        metric.includes("tariff_rate_level") &&
        !metric.includes("starting_tariff_rate_level") &&
        !isPriorTariffContext(shock)
      );
    });

    const commodityPrices = usableFreshShocks.filter(
      (shock: any) => shock.shock_type === "commodity_price"
    );

    if (currentEndingTariffLevels.length > 0) {
      usable = currentEndingTariffLevels;
    } else if (genericCurrentTariffLevels.length > 0) {
      usable = genericCurrentTariffLevels;
    } else if (commodityPrices.length > 0) {
      usable = commodityPrices;
    } else {
      usable = usableFreshShocks.filter(
        (shock: any) => !isPriorTariffContext(shock)
      );
    }

    if (usable.length === 0) {
      usable = usableFreshShocks;
    }
  }

  if (input.riskFamily === "logistics") {
    const freightRates = usableFreshShocks.filter(
      (shock: any) => shock.shock_type === "freight_rate"
    );

    usable = freightRates.length > 0 ? freightRates : usableFreshShocks;
  }

  const transition = findTariffRateTransition(usableFreshShocks);

  const representativePct = pickRepresentativeShockPct({
    riskFamily: input.riskFamily,
    shocks: usable,
    transition,
  });

  if (!representativePct || !Number.isFinite(representativePct)) {
    const scenario = scenarioShockRangeForRiskFamily(input.riskFamily);

    return {
      ...scenario,
      display_basis: scenario.basis,
      audit_basis: scenario.basis,
      shock_interpretation: "scenario_fallback_no_new_explicit_shock",
      shock_interpretation_display: scenario.basis,
      issue_category_hint: "watchlist",
      issue_direction_hint: "uncertain",
      rejected_explicit_shocks: rejectedExplicitShocks,
    };
  }

  const interpretation = inferShockInterpretation({
    riskFamily: input.riskFamily,
    allShocks: usableFreshShocks,
    usable,
    representativePct,
  });

  const auditBasis = makeShockAuditBasis(usable);

  return {
    low: representativePct / 100,
    mid: representativePct / 100,
    high: representativePct / 100,
    source: "explicit_new_source_number",
    label: interpretation.label,
    basis: interpretation.display_basis,
    display_basis: interpretation.display_basis,
    audit_basis: auditBasis,
    shock_interpretation: interpretation.kind,
    shock_interpretation_display: interpretation.display,
    issue_category_hint: interpretation.issue_category,
    issue_direction_hint: interpretation.issue_direction,
    explicit_shocks: usable,
    all_cluster_shocks: usableFreshShocks,
    rejected_explicit_shocks: rejectedExplicitShocks,
    tariff_transition: interpretation.tariff_transition,
  };
}

// Stable issue key for non-destructive merge. MUST match the SQL backfill in
// migration 20260613002000 so generated rows upsert onto existing rows by (company_id, issue_key).
function simpleStableHash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36).slice(0, 12);
}

// Canonical "why now" for known issue keys — enforced on every generation so a noisy news
// run can never overwrite these with article-style copy.
const CANONICAL_WHY_NOW: Record<string, string> = {
  tariff_trade_policy_relief:
    "A verified manual tariff metric changed from 25% to 15%, creating a procurement validation window before supplier landed-cost updates and open POs reflect the new rate.",
  freight_logistics_pressure:
    "Freight surcharges and spot-rate exposure are live operating decisions. Waiting to validate lane-level exposure increases risk of unbudgeted freight cost.",
};

function computeIssueKey(cluster: any): string {
  const title = norm(cluster.risk_title);
  const both = `${title} ${norm(cluster.risk_type)}`;
  if (/freight|logistic|shipping|container/.test(both)) return "freight_logistics_pressure";
  if (/tariff|duty|trade/.test(both)) return "tariff_trade_policy_relief";
  if (/copper/.test(title)) return "copper_macro_watch";
  if (/aluminum|aluminium/.test(title)) return "aluminum_macro_watch";
  if (/steel/.test(title)) return "steel_metal_watch";
  if (/demand|pmi|manufacturing|construction/.test(both)) return "demand_macro_watch";
  if (/compet|grainger|msc|applied/.test(both)) return "competitor_watch";
  return "issue_" + simpleStableHash(title);
}

function classifyExecutiveIssue(input: {
  cluster: any;
  exposureCalc: any;
  evidenceItems: any[];
}) {
  const methodology = input.exposureCalc?.methodology || {};
  const calculationInputs = methodology.calculation_inputs || {};
  const riskFamily = detectRiskFamily(input.cluster, input.evidenceItems);

  const shocks = filterFreshOrIncrementalShocks(
    filterShocksToClusterContext(
      input.cluster,
      collectQuantifiedShocksFromEvidence({
        riskFamily,
        evidenceItems: input.evidenceItems,
      })
    )
  );

  const transition = findTariffRateTransition(shocks);

  const interpretation =
    calculationInputs.shock_interpretation ||
    methodology.shock_interpretation ||
    "";

  const interpretationDisplay =
    calculationInputs.shock_interpretation_display ||
    methodology.shock_interpretation_display ||
    "";

  const needsCalibration =
    methodology.calibration_status === "needs_calibration" ||
    methodology.formula_status === "not_calculated";

  if (transition) {
    if (transition.direction === "down") {
      return {
        issue_category: "operating_change",
        issue_direction: "favorable_with_residual_exposure",
        display_section: "operating_changes",
        is_actionable_risk: false,
        exposure_interpretation: `Tariff rate decreased from ${transition.priorPct.toFixed(
          1
        )}% to ${transition.currentPct.toFixed(
          1
        )}%. This is favorable versus the prior rate, but a residual ${transition.currentPct.toFixed(
          1
        )}% tariff burden remains. The modeled dollar amount is remaining exposure, not new downside.`,
      };
    }

    if (transition.direction === "up") {
      return {
        issue_category: "risk",
        issue_direction: "downside",
        display_section: "risk_register",
        is_actionable_risk: true,
        exposure_interpretation: `Tariff rate increased from ${transition.priorPct.toFixed(
          1
        )}% to ${transition.currentPct.toFixed(
          1
        )}%. This is treated as downside cost pressure.`,
      };
    }
  }

  if (
    interpretation === "residual_tariff_burden_after_reduction" ||
    interpretation === "favorable_with_residual_burden"
  ) {
    return {
      issue_category: "operating_change",
      issue_direction: "favorable_with_residual_exposure",
      display_section: "operating_changes",
      is_actionable_risk: false,
      exposure_interpretation:
        interpretationDisplay ||
        "The evidence indicates a favorable movement, but residual exposure remains. This belongs in Operating Changes, not the downside Risk Register.",
    };
  }

  if (
    interpretation === "favorable_cost_relief" ||
    hasFavorableShock(shocks)
  ) {
    return {
      issue_category: "operating_change",
      issue_direction: "favorable",
      display_section: "operating_changes",
      is_actionable_risk: false,
      exposure_interpretation:
        interpretationDisplay ||
        "The evidence indicates favorable cost relief or upside. This should not be treated as a downside risk.",
    };
  }

  if (
    interpretation === "adverse_tariff_increase" ||
    interpretation === "adverse_verified_shock" ||
    hasAdverseShock(shocks)
  ) {
    return {
      issue_category: "risk",
      issue_direction: "downside",
      display_section: "risk_register",
      is_actionable_risk: true,
      exposure_interpretation:
        interpretationDisplay ||
        "The evidence contains a new adverse verified movement. GroundSense treats this as downside exposure.",
    };
  }

  if (needsCalibration) {
    return {
      issue_category: "watchlist",
      issue_direction: "uncertain",
      display_section: "watchlist",
      is_actionable_risk: false,
      exposure_interpretation:
        "This item is relevant, but GroundSense lacks enough calibrated inputs or directional certainty to treat it as a modeled downside risk.",
    };
  }

  const text = clusterSearchText(input.cluster);

  if (
    includesAny(text, [
      "shortage",
      "disruption",
      "delay",
      "congestion",
      "pressure",
      "risk",
      "higher cost",
      "margin pressure",
      "cost pressure",
      "price increase",
      "freight increase",
      "new surcharge",
      "general rate increase",
    ])
  ) {
    return {
      issue_category: "risk",
      issue_direction: "downside",
      display_section: "risk_register",
      is_actionable_risk: true,
      exposure_interpretation:
        "The evidence describes likely downside operating pressure.",
    };
  }

  return {
    issue_category: "watchlist",
    issue_direction: "mixed_or_uncertain",
    display_section: "watchlist",
    is_actionable_risk: false,
    exposure_interpretation:
      "The item is relevant but directionally mixed or uncertain. It should be reviewed as a watchlist item, not forced into the downside Risk Register.",
  };
}
function detectRiskFamily(cluster: any, evidenceItems: any[]) {
  const riskType = norm(cluster.risk_type);
  const title = norm(cluster.risk_title);
  const text = riskCalculationText(cluster, evidenceItems);

  // Trust the cluster type/title first. Do not let random evidence terms override it.
  if (
    riskType.includes("freight") ||
    riskType.includes("logistics") ||
    riskType.includes("supplier_disruption") ||
    title.includes("freight") ||
    title.includes("shipping") ||
    title.includes("container") ||
    title.includes("logistics")
  ) {
    return "logistics";
  }

  if (
    riskType.includes("customer_demand") ||
    riskType.includes("demand") ||
    riskType.includes("macro") ||
    title.includes("demand") ||
    title.includes("pmi") ||
    title.includes("manufacturing demand") ||
    title.includes("construction demand")
  ) {
    return "demand";
  }

  if (
    riskType.includes("competitor") ||
    riskType.includes("competitive") ||
    title.includes("competitor") ||
    title.includes("competitive") ||
    title.includes("grainger") ||
    title.includes("msc industrial") ||
    title.includes("applied industrial")
  ) {
    return "competitor";
  }

  if (
    riskType.includes("commodity") ||
    riskType.includes("tariff") ||
    riskType.includes("trade") ||
    title.includes("tariff") ||
    title.includes("tariffs") ||
    title.includes("steel") ||
    title.includes("aluminum") ||
    title.includes("aluminium") ||
    title.includes("copper") ||
    title.includes("commodity") ||
    title.includes("commodities")
  ) {
    return "commodity";
  }

  // Fallback on evidence text only after cluster type/title fail.
  if (
    includesAny(text, [
      "freight",
      "shipping",
      "container",
      "port",
      "logistics",
      "transportation",
      "truck",
      "trucking",
      "ocean",
      "air freight",
    ])
  ) {
    return "logistics";
  }

  if (
    includesAny(text, [
      "demand",
      "manufacturing",
      "construction",
      "pmi",
      "orders",
      "industrial production",
      "customer activity",
      "capex",
      "factory",
      "infrastructure",
    ])
  ) {
    return "demand";
  }

  if (
    includesAny(text, [
      "competitor",
      "competition",
      "grainger",
      "msc industrial",
      "applied industrial",
      "market share",
      "pricing pressure",
      "quote loss",
      "churn",
    ])
  ) {
    return "competitor";
  }

  if (
    includesAny(text, [
      "tariff",
      "tariffs",
      "duty",
      "duties",
      "import",
      "imports",
      "steel",
      "aluminum",
      "aluminium",
      "copper",
      "metals",
      "commodity",
      "commodities",
    ])
  ) {
    return "commodity";
  }

  return "unknown";
}

function detectCommodityNames(cluster: any, evidenceItems: any[]) {
  const names: string[] = [];

  const affected = safeArray(cluster.affected_commodities)
    .map((value) => norm(value))
    .filter(Boolean);

  const clusterTitle = norm(cluster.risk_title);
  const clusterType = norm(cluster.risk_type);
  const clusterText = norm(
    [
      cluster.risk_title,
      cluster.risk_type,
      cluster.what_happened,
      cluster.business_impact,
      cluster.decision_required,
      ...safeArray(cluster.affected_commodities),
    ].join(" ")
  );

  function addFromText(text: string) {
    if (text.includes("steel")) names.push("Steel");
    if (text.includes("copper")) names.push("Copper");
    if (text.includes("aluminum") || text.includes("aluminium")) {
      names.push("Aluminum");
    }
  }

  // 1. Prefer Gemini's explicit affected commodities.
  for (const item of affected) {
    addFromText(item);
  }

  if (names.length > 0) {
    return [...new Set(names)];
  }

  // 2. Then trust the cluster title/body, not the whole mixed evidence bag.
  addFromText(clusterText);

  if (names.length > 0) {
    return [...new Set(names)];
  }

  // 3. Only use evidence titles as fallback.
  const evidenceTitleText = norm(
    evidenceItems.map((item: any) => item.title).join(" ")
  );

  addFromText(evidenceTitleText);

  if (names.length > 0) {
    return [...new Set(names)];
  }

  // 4. Do NOT default generic metals to Steel/Copper/Aluminum.
  // That caused copper risks to use steel calibration.
  if (
    clusterTitle.includes("metals") ||
    clusterType.includes("commodity") ||
    clusterText.includes("metals") ||
    clusterText.includes("commodities")
  ) {
    return [];
  }

  return [];
}

function detectSegmentNames(cluster: any, evidenceItems: any[]) {
  const text = riskCalculationText(cluster, evidenceItems);
  const names: string[] = [];

  if (text.includes("manufacturing")) {
    names.push("Manufacturing Customers");
  }

  if (text.includes("construction")) {
    names.push("Construction Customers");
  }

  if (text.includes("utilities") || text.includes("utility")) {
    names.push("Utilities Customers");
  }

  if (text.includes("industrial maintenance")) {
    names.push("Industrial Maintenance Customers");
  }

  return [...new Set(names)];
}

function needsCalibrationResult(input: {
  riskFamily: string;
  missingInputs: string[];
  cluster: any;
}) {
  return {
    impactLow: 0,
    impactHigh: 0,
    exposurePath: [
      "External event classified",
      "Company exposure input missing",
      "Needs calibration",
      "No dollar estimate shown",
    ],
    methodology: {
      formula_status: "not_calculated",
      calibration_status: "needs_calibration",
      base_exposure_type: "not_calculated",
      base_exposure_value: 0,
      risk_rate_low: 0,
      risk_rate_high: 0,
      missing_inputs: input.missingInputs,
      formula:
        "No dollar exposure calculated because required company-specific inputs are missing.",
      calculation_steps: [
        "GroundSense intentionally does not invent exposure dollars without calibrated company inputs.",
        `Risk family detected: ${input.riskFamily}`,
      ],
      final_low: 0,
      final_high: 0,
      honesty_note:
        "Missing calibration blocked the financial model. Add the missing fields in Calibration, then regenerate risks.",
    },
  };
}

function getCalibratedExposureForRisk(input: {
  cluster: any;
  company: any;
  calibration: any;
  commodityExposures: any[];
  logisticsExposures: any[];
  segmentExposures: any[];
  evidenceItems: any[];
}) {
  const riskFamily = detectRiskFamily(input.cluster, input.evidenceItems);
  const text = riskCalculationText(input.cluster, input.evidenceItems);

  if (riskFamily === "commodity") {
    const detectedCommodities = detectCommodityNames(
      input.cluster,
      input.evidenceItems
    );

    const commodityRows = input.commodityExposures.filter((row) => {
      if (detectedCommodities.length === 0) return true;

      return detectedCommodities.some(
        (name) => norm(row.commodity) === norm(name)
      );
    });

    const missingInputs: string[] = [];

    if (commodityRows.length === 0) {
      missingInputs.push(
        `company_commodity_exposure rows for ${detectedCommodities.join(", ") || "the affected commodity"}`
      );
    }

    const spend = sumNumbers(
      commodityRows.map((row) => positiveNumberOrNull(row.annual_spend))
    );

    if (spend <= 0) {
      missingInputs.push("company_commodity_exposure.annual_spend");
    }

    const isTariffRisk = includesAny(text, [
      "tariff",
      "tariffs",
      "duty",
      "duties",
      "import",
      "imports",
      "section 232",
      "trade policy",
    ]);

    let importExposurePct: number | null = 1;

    if (isTariffRisk) {
      importExposurePct = weightedPct(
        commodityRows,
        "import_exposure_pct",
        "annual_spend"
      );

      if (importExposurePct === null) {
        missingInputs.push("company_commodity_exposure.import_exposure_pct");
      }
    }

    const passThroughPct =
      weightedPct(commodityRows, "pass_through_pct", "annual_spend") ??
      pctDecimalOrNull(input.calibration.pass_through_coverage_pct);

    if (passThroughPct === null) {
      missingInputs.push(
        "company_commodity_exposure.pass_through_pct or company_calibration.pass_through_coverage_pct"
      );
    }

    const repricingLagDays =
      weightedNumber(commodityRows, "repricing_lag_days", "annual_spend") ??
      numberOrNull(input.calibration.average_repricing_lag_days);

    if (repricingLagDays === null) {
      missingInputs.push(
        "company_commodity_exposure.repricing_lag_days or company_calibration.average_repricing_lag_days"
      );
    }

    if (missingInputs.length > 0) {
      return needsCalibrationResult({
        riskFamily,
        missingInputs,
        cluster: input.cluster,
      });
    }

    const affectedSpend = spend * Number(importExposurePct ?? 1);
    const unpassedCostPct = 1 - Number(passThroughPct);
    const lagFactor = Math.max(0, Math.min(1, Number(repricingLagDays) / 90));

    const shock = resolveShockRange({
  riskFamily: "commodity",
  evidenceItems: input.evidenceItems,
  cluster: input.cluster,
});

const shockLow = shock.low;
const shockMid = shock.mid || (shock.low + shock.high) / 2;
const shockHigh = shock.high;

const impactLow = affectedSpend * shockLow * unpassedCostPct * lagFactor;
const impactMid = affectedSpend * shockMid * unpassedCostPct * lagFactor;
const impactHigh = affectedSpend * shockHigh * unpassedCostPct * lagFactor;

const tariffTransition = shock.tariff_transition || null;

const modeledPriorBurden =
  tariffTransition?.direction === "down"
    ? affectedSpend *
      (Number(tariffTransition.priorPct) / 100) *
      unpassedCostPct *
      lagFactor
    : null;

const modeledCurrentBurden =
  tariffTransition?.direction === "down" ? impactHigh : null;

const modeledRelief =
  modeledPriorBurden !== null && modeledCurrentBurden !== null
    ? Math.max(0, modeledPriorBurden - modeledCurrentBurden)
    : null;

    const commodityNames =
      detectedCommodities.length > 0
        ? detectedCommodities
        : commodityRows.map((row) => row.commodity);

    return {
      impactLow,
      impactHigh,
      exposurePath: [
        `${commodityNames.join(" / ")} external shock`,
        isTariffRisk
          ? `${(Number(importExposurePct) * 100).toFixed(1)}% import-exposed spend`
          : "Commodity spend base",
        `${(unpassedCostPct * 100).toFixed(1)}% unpassed cost after pass-through`,
        `${Number(repricingLagDays).toFixed(0)}-day repricing lag`,
        `${money(impactHigh)} modeled margin exposure`,
      ],
      methodology: {
        formula_status: "calculated",
        calibration_status: "calculated",
        base_exposure_type: isTariffRisk
          ? "import_exposed_commodity_spend"
          : "commodity_spend",
        base_exposure_value: Math.round(affectedSpend),
        risk_rate_low: shockLow,
        risk_rate_high: shockHigh,
        formula:
          "Exposure = affected_commodity_spend × external_shock_% × unpassed_cost_% × repricing_lag_factor",
        calculation_inputs: {
  commodity_names: commodityNames,
  total_commodity_spend: Math.round(spend),
  import_exposure_pct: Number(importExposurePct),
  affected_spend: Math.round(affectedSpend),

  pass_through_pct: Number(passThroughPct),
  unpassed_cost_pct: unpassedCostPct,
  repricing_lag_days: Number(repricingLagDays),
  repricing_lag_factor: lagFactor,

  external_shock_low: shockLow,
  external_shock_mid: shockMid,
  external_shock_high: shockHigh,

  shock_source: shock.source,
  shock_label: shock.label,
  shock_basis: shock.display_basis || shock.basis,
  shock_audit_basis: shock.audit_basis || shock.basis,
  shock_interpretation: shock.shock_interpretation,
  shock_interpretation_display: shock.shock_interpretation_display,
  issue_category_hint: shock.issue_category_hint,
  issue_direction_hint: shock.issue_direction_hint,

  scenario_assumptions: shock.scenario_assumptions || null,
  explicit_shocks: shock.explicit_shocks || [],
  all_cluster_shocks: shock.all_cluster_shocks || [],
  rejected_explicit_shocks: shock.rejected_explicit_shocks || [],

  tariff_transition: tariffTransition,
  prior_tariff_rate_pct: tariffTransition?.priorPct ?? null,
  current_tariff_rate_pct: tariffTransition?.currentPct ?? null,
  tariff_change_pct_points: tariffTransition?.changePctPoints ?? null,

  modeled_prior_burden:
    modeledPriorBurden === null ? null : Math.round(modeledPriorBurden),
  modeled_current_burden:
    modeledCurrentBurden === null ? null : Math.round(modeledCurrentBurden),
  modeled_relief:
    modeledRelief === null ? null : Math.round(modeledRelief),
},
        calculation_steps: [
          `Total commodity spend = ${money(spend)}`,
          isTariffRisk
            ? `Import-exposed spend = ${money(spend)} × ${(
                Number(importExposurePct) * 100
              ).toFixed(1)}% = ${money(affectedSpend)}`
            : `Affected commodity spend = ${money(affectedSpend)}`,
          `Unpassed cost share = 1 - ${(Number(passThroughPct) * 100).toFixed(
            1
          )}% = ${(unpassedCostPct * 100).toFixed(1)}%`,
          `Repricing lag factor = ${Number(repricingLagDays).toFixed(
            0
          )} / 90 = ${lagFactor.toFixed(2)}`,

          shock.source === "explicit_new_source_number"
  ? `${shock.label} = ~${(shockHigh * 100).toFixed(1)}% (${shock.source})`
  : `${shock.label} assumptions = low ${(shockLow * 100).toFixed(
      1
    )}%, mid ${(shockMid * 100).toFixed(1)}%, high ${(
      shockHigh * 100
    ).toFixed(1)}% (${shock.source})`,
          `Low exposure = ${money(affectedSpend)} × ${(
            shockLow * 100
          ).toFixed(1)}% × ${(unpassedCostPct * 100).toFixed(
            1
          )}% × ${lagFactor.toFixed(2)} = ${money(impactLow)}`,
          `High exposure = ${money(affectedSpend)} × ${(
            shockHigh * 100
          ).toFixed(1)}% × ${(unpassedCostPct * 100).toFixed(
            1
          )}% × ${lagFactor.toFixed(2)} = ${money(impactHigh)}`,
        ],
        final_low: Math.round(impactLow),
        final_high: Math.round(impactHigh),
        honesty_note:
  shock.source === "explicit_new_source_number"   
    ? "Dollar exposure is calculated from company_commodity_exposure and company_calibration. The shock percentage came from explicit numbers found in the evidence."
    : "Dollar exposure is calculated from company_commodity_exposure and company_calibration. No explicit commodity price or tariff percentage was found in the evidence, so GroundSense shows a clearly labeled scenario range instead of pretending the number came from the news.",
      },
    };
  }

  if (riskFamily === "logistics") {
    const rows = input.logisticsExposures;
    const missingInputs: string[] = [];

    if (rows.length === 0) {
      missingInputs.push("company_logistics_exposure");
    }

    const freightSpend = sumNumbers(
      rows.map((row) => positiveNumberOrNull(row.annual_freight_spend))
    );

    if (freightSpend <= 0) {
      missingInputs.push("company_logistics_exposure.annual_freight_spend");
    }

    const contractCoveragePct =
      weightedPct(rows, "contract_coverage_pct", "annual_freight_spend") ??
      pctDecimalOrNull(input.calibration.freight_contract_coverage_pct);

    let spotRateExposurePct =
      weightedPct(rows, "spot_rate_exposure_pct", "annual_freight_spend") ??
      pctDecimalOrNull(input.calibration.freight_spot_rate_exposure_pct);

    if (spotRateExposurePct === null && contractCoveragePct !== null) {
      spotRateExposurePct = 1 - contractCoveragePct;
    }

    if (spotRateExposurePct === null) {
      missingInputs.push(
        "company_logistics_exposure.spot_rate_exposure_pct or freight_contract_coverage_pct"
      );
    }

    if (missingInputs.length > 0) {
      return needsCalibrationResult({
        riskFamily,
        missingInputs,
        cluster: input.cluster,
      });
    }

    const exposedFreightSpend = freightSpend * Number(spotRateExposurePct);
 const shock = resolveShockRange({
  riskFamily: "logistics",
  evidenceItems: input.evidenceItems,
  cluster: input.cluster,
});
const shockLow = shock.low;
const shockMid = shock.mid || (shock.low + shock.high) / 2;
const shockHigh = shock.high;

const impactLow = exposedFreightSpend * shockLow;
const impactMid = exposedFreightSpend * shockMid;
const impactHigh = exposedFreightSpend * shockHigh;

    return {
      impactLow,
      impactHigh,
      exposurePath: [
        "Freight / logistics shock",
        `${money(freightSpend)} annual freight spend`,
        `${(Number(spotRateExposurePct) * 100).toFixed(1)}% spot-rate exposure`,
        "Transportation cost pressure",
        `${money(impactHigh)} modeled freight exposure`,
      ],
      methodology: {
        formula_status: "calculated",
        calibration_status: "calculated",
        base_exposure_type: "spot_exposed_freight_spend",
        base_exposure_value: Math.round(exposedFreightSpend),
        risk_rate_low: shockLow,
        risk_rate_high: shockHigh,
        formula:
          "Freight exposure = annual_freight_spend × spot_rate_exposure_% × freight_rate_shock_%",
        calculation_inputs: {
  annual_freight_spend: Math.round(freightSpend),
  spot_rate_exposure_pct: Number(spotRateExposurePct),
  contract_coverage_pct: contractCoveragePct,
  exposed_freight_spend: Math.round(exposedFreightSpend),

  freight_rate_shock_low: shockLow,
  freight_rate_shock_mid: shockMid,
  freight_rate_shock_high: shockHigh,

  shock_source: shock.source,
  shock_label: shock.label,
  shock_basis: shock.display_basis || shock.basis,
  shock_audit_basis: shock.audit_basis || shock.basis,
  shock_interpretation: shock.shock_interpretation,
  shock_interpretation_display: shock.shock_interpretation_display,
  issue_category_hint: shock.issue_category_hint,
  issue_direction_hint: shock.issue_direction_hint,

  scenario_assumptions: shock.scenario_assumptions || null,
  explicit_shocks: shock.explicit_shocks || [],
  all_cluster_shocks: shock.all_cluster_shocks || [],
  rejected_explicit_shocks: shock.rejected_explicit_shocks || [],
},
        calculation_steps: [
          `Annual freight spend = ${money(freightSpend)}`,
          `Spot-rate exposed freight spend = ${money(freightSpend)} × ${(
            Number(spotRateExposurePct) * 100
          ).toFixed(1)}% = ${money(exposedFreightSpend)}`,
          shock.source === "explicit_new_source_number"
  ? `${shock.label} = ~${(shockHigh * 100).toFixed(1)}% (${shock.source})`
  : `${shock.label} assumptions = low ${(shockLow * 100).toFixed(
      1
    )}%, mid ${(shockMid * 100).toFixed(1)}%, high ${(
      shockHigh * 100
    ).toFixed(1)}% (${shock.source})`,
          `Low exposure = ${money(exposedFreightSpend)} × ${(
            shockLow * 100
          ).toFixed(1)}% = ${money(impactLow)}`,
          `High exposure = ${money(exposedFreightSpend)} × ${(
            shockHigh * 100
          ).toFixed(1)}% = ${money(impactHigh)}`,
        ],
        final_low: Math.round(impactLow),
        final_high: Math.round(impactHigh),
        honesty_note:
  shock.source === "explicit_new_source_number"
    ? "Dollar exposure is calculated from company_logistics_exposure. The freight-rate shock percentage came from explicit numbers found in the evidence."
    : "Dollar exposure is calculated from company_logistics_exposure. No explicit freight-rate percentage was found in the evidence, so GroundSense shows a clearly labeled scenario range instead of pretending the number came from the news.",
      },
    };
  }

  if (riskFamily === "demand" || riskFamily === "competitor") {
    const detectedSegments = detectSegmentNames(
      input.cluster,
      input.evidenceItems
    );

    const rows = input.segmentExposures.filter((row) => {
      if (detectedSegments.length === 0) return true;

      return detectedSegments.some(
        (name) => norm(row.segment_name) === norm(name)
      );
    });

    const missingInputs: string[] = [];

    if (rows.length === 0) {
      missingInputs.push(
        `company_segment_exposure rows for ${detectedSegments.join(", ") || "affected customer segments"}`
      );
    }

    const segmentRevenue = sumNumbers(
      rows.map((row) => positiveNumberOrNull(row.annual_revenue))
    );

    if (segmentRevenue <= 0) {
      missingInputs.push("company_segment_exposure.annual_revenue");
    }

    const grossMarginPct =
      weightedPct(rows, "gross_margin_pct", "annual_revenue") ??
      pctDecimalOrNull(input.calibration.gross_margin_pct);

    if (grossMarginPct === null) {
      missingInputs.push(
        "company_segment_exposure.gross_margin_pct or company_calibration.gross_margin_pct"
      );
    }

    const demandBeta =
      weightedNumber(rows, "demand_beta", "annual_revenue") ?? 1;

    if (missingInputs.length > 0) {
      return needsCalibrationResult({
        riskFamily,
        missingInputs,
        cluster: input.cluster,
      });
    }

    const grossProfitBase = segmentRevenue * Number(grossMarginPct);

const shock = resolveShockRange({
  riskFamily,
  evidenceItems: input.evidenceItems,
  cluster: input.cluster,
});

const shockLow = shock.low;
const shockMid = shock.mid || (shock.low + shock.high) / 2;
const shockHigh = shock.high;

const impactLow = grossProfitBase * shockLow * demandBeta;
const impactMid = grossProfitBase * shockMid * demandBeta;
const impactHigh = grossProfitBase * shockHigh * demandBeta;

    const segmentNames =
      detectedSegments.length > 0
        ? detectedSegments
        : rows.map((row) => row.segment_name);

    return {
      impactLow,
      impactHigh,
      exposurePath: [
        riskFamily === "competitor"
          ? "Competitive pressure"
          : "Customer demand signal",
        segmentNames.join(" / "),
        `${money(segmentRevenue)} segment revenue`,
        `${(Number(grossMarginPct) * 100).toFixed(1)}% gross margin`,
        `${money(impactHigh)} modeled gross profit exposure`,
      ],
      methodology: {
        formula_status: "calculated",
        calibration_status: "calculated",
        base_exposure_type:
          riskFamily === "competitor"
            ? "segment_gross_profit_competitive_exposure"
            : "segment_gross_profit_demand_exposure",
        base_exposure_value: Math.round(grossProfitBase),
        risk_rate_low: shockLow,
risk_rate_high: shockHigh,
shock_source: shock.source,
shock_label: shock.label,
shock_basis: shock.display_basis || shock.basis,
shock_audit_basis: shock.audit_basis || shock.basis,
shock_interpretation: shock.shock_interpretation,
shock_interpretation_display: shock.shock_interpretation_display,
issue_category_hint: shock.issue_category_hint,
issue_direction_hint: shock.issue_direction_hint,
scenario_assumptions: shock.scenario_assumptions || null,
explicit_shocks: shock.explicit_shocks || [],
all_cluster_shocks: shock.all_cluster_shocks || [],
rejected_explicit_shocks: shock.rejected_explicit_shocks || [],
        formula:
          "Exposure = affected_segment_revenue × gross_margin_% × demand_or_competitive_shock_% × demand_beta",
        calculation_inputs: {
          segment_names: segmentNames,
          segment_revenue: Math.round(segmentRevenue),
          gross_margin_pct: Number(grossMarginPct),
          gross_profit_base: Math.round(grossProfitBase),
          demand_beta: demandBeta,
          shock_low: shockLow,
shock_high: shockHigh,
 shock_mid: shockMid,
shock_source: shock.source,
shock_label: shock.label,
shock_basis: shock.display_basis || shock.basis,
shock_audit_basis: shock.audit_basis || shock.basis,
shock_interpretation: shock.shock_interpretation,
shock_interpretation_display: shock.shock_interpretation_display,
issue_category_hint: shock.issue_category_hint,
issue_direction_hint: shock.issue_direction_hint,
scenario_assumptions: shock.scenario_assumptions || null,
explicit_shocks: shock.explicit_shocks || [],
all_cluster_shocks: shock.all_cluster_shocks || [],
rejected_explicit_shocks: shock.rejected_explicit_shocks || [],
        },
        calculation_steps: [
          `Affected segment revenue = ${money(segmentRevenue)}`,
          `Gross profit base = ${money(segmentRevenue)} × ${(
            Number(grossMarginPct) * 100
          ).toFixed(1)}% = ${money(grossProfitBase)}`,
          
          `Demand beta = ${demandBeta.toFixed(2)}`,
         shock.source === "explicit_new_source_number"
  ? `${shock.label} = ~${(shockHigh * 100).toFixed(1)}% (${shock.source})`
  : `${shock.label} assumptions = low ${(shockLow * 100).toFixed(
      1
    )}%, mid ${(shockMid * 100).toFixed(1)}%, high ${(
      shockHigh * 100
    ).toFixed(1)}% (${shock.source})`,
          `Low exposure = ${money(grossProfitBase)} × ${(
            shockLow * 100
          ).toFixed(2)}% × ${demandBeta.toFixed(2)} = ${money(impactLow)}`,
          `High exposure = ${money(grossProfitBase)} × ${(
            shockHigh * 100
          ).toFixed(2)}% × ${demandBeta.toFixed(2)} = ${money(impactHigh)}`,
        ],
        final_low: Math.round(impactLow),
        final_high: Math.round(impactHigh),
       honesty_note:
  shock.source === "explicit_new_source_number"
    ? "Dollar exposure is calculated from company_segment_exposure and gross margin calibration. The demand or competitive shock percentage came from explicit numbers found in the evidence."
    : "Dollar exposure is calculated from company_segment_exposure and gross margin calibration. No explicit demand or competitive percentage was found in the evidence, so GroundSense shows a clearly labeled scenario range instead of pretending the number came from the news.",
      },
    };
  }

  return needsCalibrationResult({
    riskFamily,
    missingInputs: [
      "risk_type could not be matched to commodity, logistics, demand, or competitor exposure model",
    ],
    cluster: input.cluster,
  });
}

function buildExposurePath(cluster: any, impactHigh: number) {
  const riskType = String(cluster.risk_type || "").toLowerCase();

  if (
    riskType.includes("freight") ||
    riskType.includes("logistics") ||
    riskType.includes("shipping")
  ) {
    return [
      "Freight / logistics evidence cluster",
      "Transportation cost or capacity pressure",
      "Supplier lead time or landed cost exposure",
      "Customer service or margin pressure",
      `${formatMoneyForPath(impactHigh)} modeled exposure`,
    ];
  }

  if (
    riskType.includes("commodity") ||
    riskType.includes("tariff") ||
    riskType.includes("trade") ||
    riskType.includes("metals")
  ) {
    return [
      "Commodity / trade evidence cluster",
      "Input cost or tariff pressure",
      "Supplier landed cost pressure",
      "Customer pass-through or margin exposure",
      `${formatMoneyForPath(impactHigh)} modeled exposure`,
    ];
  }

  if (riskType.includes("demand") || riskType.includes("macro")) {
    return [
      "Demand evidence cluster",
      "Manufacturing / construction activity signal",
      "Customer order or sales planning sensitivity",
      "Revenue and inventory planning exposure",
      `${formatMoneyForPath(impactHigh)} modeled exposure`,
    ];
  }

  if (riskType.includes("competitor")) {
    return [
      "Competitor evidence cluster",
      "Pricing or service-level pressure",
      "Customer retention / quote-loss exposure",
      "Revenue at risk",
      `${formatMoneyForPath(impactHigh)} modeled exposure`,
    ];
  }

  return [
    "Evidence cluster",
    "Business driver identified",
    "Operating exposure pathway",
    "Executive decision required",
    `${formatMoneyForPath(impactHigh)} modeled exposure`,
  ];
}

function makePriorityScore(input: {
  probability: number;
  confidence: number;
  evidenceQuality: number;
  impactHigh: number;
}) {
  const impactScore = Math.min(25, Math.round(input.impactHigh / 1_000_000));

  return Math.max(
    35,
    Math.min(
      95,
      Math.round(
        input.probability * 0.35 +
          input.confidence * 0.25 +
          input.evidenceQuality * 0.25 +
          impactScore * 0.15
      )
    )
  );
}

function makeEvidenceItems(cluster: any, evidence: any[]) {
  const indexes = getCleanEvidenceIndexes(cluster, evidence);

  return indexes
    .map((idx) => evidence[idx - 1])
    .filter(Boolean)
    .map((item) => ({
      title: item.title,
      source: item.source_name,
      url: item.source_url,
      source_quality: item.source_quality || 50,
      source_tier: item.source_tier || "unknown",
      published_at: item.published_at,
      age_days: item.event_age_days ?? null,
      age_label:
        item.event_age_days === null || item.event_age_days === undefined
          ? "Unknown date"
          : `Age ${item.event_age_days} days`,

      strategic_score: Number(item.strategic_score || 0),
      confidence: Number(item.confidence || 0),
      impact_level: item.impact_level || null,
      impact_type: item.impact_type || null,
      why_it_matters: item.why_it_matters || null,

metadata: item.metadata || {},
quantified_shocks: Array.isArray(item.quantified_shocks)
  ? item.quantified_shocks
  : Array.isArray(item.metadata?.quantified_shocks)
  ? item.metadata.quantified_shocks
  : [],
has_quantified_shock: Boolean(
  item.has_quantified_shock || item.metadata?.has_quantified_shock
),

evidence_score: Math.round(
        Math.max(
          Number(item.strategic_score || 0),
          Number(item.confidence || 0),
          Number(item.source_quality || 0)
        )
      ),
    }))
    .sort((a, b) => Number(b.evidence_score || 0) - Number(a.evidence_score || 0));
}

function makeSourceEventIds(cluster: any, evidence: any[]) {
  const indexes = getCleanEvidenceIndexes(cluster, evidence);

  return indexes.map((idx) => evidence[idx - 1]?.raw_event_id).filter(Boolean);
}

function buildEvidenceClusteringPrompt(input: {
  company: any;
  entities: any[];
  evidence: any[];
}) {
  const companyFacts = {
    company_name: input.company.name,
    industry: input.company.industry,
    revenue_range: input.company.revenue_range,
    suppliers: input.entities
      .filter((e) => e.entity_type === "supplier")
      .map((e) => e.entity_value),
    competitors: input.entities
      .filter((e) => e.entity_type === "competitor")
      .map((e) => e.entity_value),
    customer_segments: input.entities
      .filter((e) => e.entity_type === "customer_segment")
      .map((e) => e.entity_value),
    commodities: input.entities
      .filter((e) => e.entity_type === "commodity")
      .map((e) => e.entity_value),
  };

  return `
You are building an executive risk register for this company.

COMPANY:
${JSON.stringify(companyFacts, null, 2)}

TASK:
Group today's relevant evidence articles into 2 to 3 executive issue clusters.
Each cluster should use 2 to 8 directly relevant articles.
A clean 2-article cluster is better than a padded mixed cluster.
Do not include more than 8 evidence_indexes per cluster.

CRITICAL RULES:
- Do NOT use preset risk titles.
- Risk titles must be created from the actual article cluster.
- Each cluster must contain articles that truly belong together.
- Do NOT force copper, aluminum, freight, stock-market, and demand articles into the same generic demand risk.
- Do NOT create "Industrial Demand Sensitivity" unless the articles directly mention industrial demand, manufacturing activity, PMI, construction activity, orders, sales outlook, inventory destocking/restocking, or customer demand.
- Company profiles, stock movement articles, market-index articles, analyst rating articles, and market-cap articles are weak evidence unless they directly describe operating cost, demand, supply disruption, customer activity, prices, tariffs, freight, or lead times.
- If evidence is weak or indirect, either exclude it or create a lower-confidence cluster with a title that admits it is a watch item.
- Use article titles and source names directly in the explanations.
- Titles should be board-readable and specific.
- evidence_indexes must contain ONLY articles that directly support the exact risk_title.
- Do not include trade-adjacent articles unless they involve the same commodity, country, customer segment, or operating driver.
- For metals tariff risk, include steel/aluminum/copper/tariff/import/duty articles only. Exclude whisky, watches, broad stock-market, market-index, and unrelated trade articles.
- For freight risk, include freight/shipping/logistics/port/container/lead-time articles only.
- For demand risk, include manufacturing/construction/PMI/orders/customer-demand articles only.
- Each cluster should use 2 to 8 directly relevant articles. Never pad with weak articles.
- For steel/aluminum/copper tariff risks, evidence_indexes must include only articles that mention tariff/import/duty/proclamation/Section 232 AND steel/aluminum/copper.
- Exclude whisky, watches, apparel, broad market-index, stock-performance, and unrelated trade articles even if they mention tariffs.
- Exclude iron ore articles unless the article directly connects iron ore to steel tariffs, steel import costs, or Fastenal-relevant steel cost pressure.
- It is acceptable for a high-quality cluster to have only 2 direct evidence articles. Do not pad clusters with weak articles just to reach 3.
- Do not force every issue to be a downside risk. Some evidence describes operating changes, residual burdens, cost relief, or watchlist items.
- Do not mix different tariff regimes into one issue. US Section 232 / White House / Trump tariff actions, India steel tariffs, Australia solar steel tubing tariffs, and South Africa rail duties are separate issues.
- If a cluster is about US steel/aluminum/copper tariffs, evidence_indexes must not include India, Australia, South Africa, rail-duty, solar-tubing, or foreign-only tariff articles.
- Do not combine tariff reductions with tariff increases unless the title explicitly says mixed tariff adjustments and the business impact explains both relief and cost pressure.
- If the only explicit percentage is a prior rate in "from X% to Y%", use Y% as the current rate. Do not use X% as current downside exposure.
- A tariff reduction should be described as an operating change or cost relief with residual burden, not as a new downside risk.
- If an article reports a percentage using language like "since the start", "year to date", "over the past year", or "since last year", describe it as cumulative context, not as a new incremental shock.
- If the percentage is cumulative/baseline/stale, the cluster may still be relevant, but the business impact must not imply that this exact percentage is the modeled current shock.
- For scenario-modeled issues, explain the operating pressure qualitatively and let deterministic code handle scenario assumptions.
GOOD TITLE EXAMPLES:
- Steel, Aluminum, and Copper Tariff Cost Pressure
- Container Freight Rate Spike and Logistics Cost Pressure
- Copper and Aluminum Supply Tightness Watch
- Middle East Shipping Disruption Risk
- Manufacturing Demand Slowdown Watch

BAD TITLE EXAMPLES:
- Industrial Demand Sensitivity
- Risk Exposure
- Supply Chain Risk
- Market Risk
- Business Risk

EVIDENCE ARTICLES:
${JSON.stringify(input.evidence, null, 2)}
IMPORTANT OUTPUT LIMITS:
- Return at most 3 risk clusters.
- Each string field must be under 280 characters.
- what_happened must be 1-2 sentences only.
- why_now must be 1 sentence only.
- business_impact must be 1-2 sentences only.
- why_this_cluster_exists must be 1 sentence only.
- Do not quote full article titles inside long paragraphs; use short references.
- Keep JSON compact.
Return ONLY valid JSON:
{
  "risk_clusters": [
    {
      "risk_title": "specific title based on the article cluster",
      "risk_type": "commodity_cost | freight_logistics | supplier_disruption | customer_demand | competitor_pressure | tariff_trade | macro_market | other",
      "severity": "low | medium | high | critical",
      "probability": 0,
      "confidence": 0,
      "why_this_cluster_exists": "specific explanation of why these articles belong together",
      "what_happened": "specific explanation of what happened, naming article-backed developments",
      "why_now": "specific explanation of what is recent or changing",
      "business_impact": "specific explanation of how this could affect the company",
      "decision_required": "specific executive decision needed",
      "owner": "recommended owner title",
      "expected_benefit": "specific expected benefit of acting",
      "affected_suppliers": [],
      "affected_customers": [],
      "affected_products": [],
      "affected_commodities": [],
      "affected_facilities": [],
      "evidence_indexes": [1, 2, 3],
      "evidence_quality_score": 0
    }
  ]
}

SCORING:
- probability: modeled likelihood from article evidence, 0-100.
- confidence: confidence that the evidence actually supports this exact risk, 0-100.
- evidence_quality_score: source quality + relevance quality, 0-100.
- If evidence is indirect, confidence must be below 65.
- If evidence is mismatched, do not create a cluster.
`;
}

Deno.serve(async (req: Request) => {
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
          ok: false,
          error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.",
        },
        500
      );
    }

    const { createClient } = await import(
      "https://esm.sh/@supabase/supabase-js@2.45.4"
    );

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const body = await req.json().catch(() => ({}));
    const companyId = cleanText(body.companyId, 80);
    const maxEvidence = clampNumber(body.maxEvidence, 20, 120, 70);

    if (!companyId) {
      return jsonResponse({ ok: false, error: "Missing companyId." }, 400);
    }

    const { data: company, error: companyError } = await supabase
      .from("companies")
      .select("*")
      .eq("id", companyId)
      .single();

    if (companyError) throw companyError;

    const { data: entities, error: entityError } = await supabase
      .from("company_entities")
      .select("*")
      .eq("company_id", companyId);

    if (entityError) throw entityError;

        const [
      calibrationResult,
      commodityExposureResult,
      logisticsExposureResult,
      segmentExposureResult,
    ] = await Promise.all([
      supabase
        .from("company_calibration")
        .select("*")
        .eq("company_id", companyId)
        .maybeSingle(),

      supabase
        .from("company_commodity_exposure")
        .select("*")
        .eq("company_id", companyId),

      supabase
        .from("company_logistics_exposure")
        .select("*")
        .eq("company_id", companyId),

      supabase
        .from("company_segment_exposure")
        .select("*")
        .eq("company_id", companyId),
    ]);

    if (calibrationResult.error) throw calibrationResult.error;
    if (commodityExposureResult.error) throw commodityExposureResult.error;
    if (logisticsExposureResult.error) throw logisticsExposureResult.error;
    if (segmentExposureResult.error) throw segmentExposureResult.error;

    const calibration = calibrationResult.data || {};
    const commodityExposures = commodityExposureResult.data || [];
    const logisticsExposures = logisticsExposureResult.data || [];
    const segmentExposures = segmentExposureResult.data || [];

  const { data: assessments, error: assessmentError } = await supabase
  .from("event_assessments")
  .select(
    `
    id,
    raw_event_id,
    relevant,
    impact_level,
    impact_type,
    why_it_matters,
    affected_areas,
    confidence,
    strategic_score,
    metadata,
    raw_event:raw_events (
      id,
      title,
      description,
      content_text,
      source_name,
      source_url,
      published_at,
      query_text,
      source_quality,
      source_tier,
      event_age_days
    )
  `
  )
  .eq("company_id", companyId)
  .eq("relevant", true)
  .order("strategic_score", { ascending: false })
  .limit(maxEvidence);

    if (assessmentError) throw assessmentError;

    const evidence = (assessments || [])
      .map((assessment: any, index: number) => {
        const raw = Array.isArray(assessment.raw_event)
          ? assessment.raw_event[0]
          : assessment.raw_event;

        return {
  index: index + 1,
  assessment_id: assessment.id,
  raw_event_id: assessment.raw_event_id,
  title: cleanText(raw?.title, 280),
  description: cleanText(raw?.description, 800),
  content_text: cleanText(raw?.content_text, 1600),
  source_name: cleanText(raw?.source_name, 120),
  source_url: cleanText(raw?.source_url, 500),
  published_at: raw?.published_at,
  query_text: cleanText(raw?.query_text, 300),
  source_quality: raw?.source_quality || 50,
  source_tier: raw?.source_tier || "unknown",
  event_age_days: raw?.event_age_days ?? null,
  impact_level: assessment.impact_level,
  impact_type: assessment.impact_type,
  why_it_matters: cleanText(assessment.why_it_matters, 500),
  affected_areas: assessment.affected_areas || [],
  confidence: assessment.confidence || 0,
  strategic_score: assessment.strategic_score || 0,
  metadata: assessment.metadata || {},
  quantified_shocks: Array.isArray(assessment.metadata?.quantified_shocks)
    ? assessment.metadata.quantified_shocks
    : [],
  has_quantified_shock: Boolean(assessment.metadata?.has_quantified_shock),
};
      })
      .filter((item: any) => item.title);

    if (evidence.length === 0) {
      return jsonResponse({
        ok: true,
        message: "No relevant evidence found.",
        inserted: 0,
      });
    }

    const clustered = await callGemini(
      buildEvidenceClusteringPrompt({
        company,
        entities: entities || [],
        evidence,
      })
    );

    const clusters = safeArray(clustered.risk_clusters).slice(0, 3);

    // NON-DESTRUCTIVE MERGE. We never delete the company's existing risks/actions. Generated
    // issues are upserted by (company_id, issue_key); issues not regenerated this run are
    // preserved (e.g. a tariff operating change a noisy news run failed to re-cluster).
    const runId = crypto.randomUUID();
    const nowIso = new Date().toISOString();

    const riskRows = clusters
      .map((cluster: any, index: number) => {
        const sourceEventIds = makeSourceEventIds(cluster, evidence);
        const evidenceItems = makeEvidenceItems(cluster, evidence);

        if (sourceEventIds.length === 0 || evidenceItems.length === 0) {
          return null;
        }

        const probability = clampNumber(cluster.probability, 1, 95, 55);
        const confidence = clampNumber(cluster.confidence, 1, 100, 55);
        const evidenceQuality = clampNumber(
          cluster.evidence_quality_score,
          1,
          100,
          55
        );

                const exposureCalc = getCalibratedExposureForRisk({
          cluster,
          company,
          calibration,
          commodityExposures,
          logisticsExposures,
          segmentExposures,
          evidenceItems,
        });

        const issueClassification = classifyExecutiveIssue({
  cluster,
  exposureCalc,
  evidenceItems,
});

        const impactLow = exposureCalc.impactLow;
        const impactHigh = exposureCalc.impactHigh;

        const priorityScore = makePriorityScore({
          probability,
          confidence,
          evidenceQuality,
          impactHigh,
        });

        return {
          company_id: companyId,
          issue_key: computeIssueKey(cluster),
          last_seen_run_id: runId,
          last_seen_at: nowIso,
          risk_title: cleanText(cluster.risk_title, 180),
          risk_type: cleanText(cluster.risk_type, 80) || "evidence_cluster",
          issue_category: issueClassification.issue_category,
issue_direction: issueClassification.issue_direction,
display_section: issueClassification.display_section,
is_actionable_risk: issueClassification.is_actionable_risk,
exposure_interpretation: issueClassification.exposure_interpretation,
          probability: Math.round(probability),
          impact_low: Math.round(impactLow),
          impact_high: Math.round(impactHigh),
          confidence: Math.round(confidence),
          severity: cleanText(cluster.severity, 40) || "medium",
          owner: cleanText(cluster.owner, 120) || "Executive Owner",
          action_required:
            cleanText(cluster.decision_required, 1000) ||
            "Review the evidence cluster and decide whether mitigation is needed.",
          due_days: index === 0 ? 7 : 14,
          status: "open",

          affected_suppliers: safeArray(cluster.affected_suppliers),
          affected_customers: safeArray(cluster.affected_customers),
          affected_products: safeArray(cluster.affected_products),
          affected_commodities: safeArray(cluster.affected_commodities),
          affected_facilities: safeArray(cluster.affected_facilities),

          source_event_ids: sourceEventIds,
          supporting_event_count: sourceEventIds.length,

          executive_summary:
            cleanText(cluster.what_happened, 900) ||
            cleanText(cluster.why_this_cluster_exists, 900),
          business_impact: cleanText(cluster.business_impact, 1500),

          priority_score: priorityScore,
          risk_rank: index + 1,

          what_happened: cleanText(cluster.what_happened, 2000),
          why_now: CANONICAL_WHY_NOW[computeIssueKey(cluster)] ?? cleanText(cluster.why_now, 2000),
          risk_interaction: cleanText(cluster.business_impact, 2000),
          evidence_summary: cleanText(cluster.why_this_cluster_exists, 1000),
          explanation_confidence: Math.round(confidence),

          evidence_items: evidenceItems,
          evidence_quality_score: Math.round(evidenceQuality),
          evidence_titles: evidenceItems.map((item: any) => item.title),
          evidence_sources: evidenceItems.map((item: any) => item.source),
          evidence_urls: evidenceItems.map((item: any) => item.url),

          decision_required: cleanText(cluster.decision_required, 1000),
          expected_benefit: cleanText(cluster.expected_benefit, 1000),

                    methodology: {
            generator_version:
  "dynamic-evidence-cluster-risk-v3-explicit-shock-or-scenario",
            aggregation_method:
              "Gemini clusters evidence and classifies risk; deterministic code calculates exposure from company calibration tables.",
            ...exposureCalc.methodology,
            supporting_signal_count: sourceEventIds.length,
            average_source_quality: Math.round(evidenceQuality),
            evidence_multiplier: "not_used_for_dollars",
            quality_multiplier: "not_used_for_dollars",
            final_low: Math.round(impactLow),
            final_high: Math.round(impactHigh),
            cluster_reason: cleanText(cluster.why_this_cluster_exists, 1000),
          },

          exposure_path: exposureCalc.exposurePath,
        };
      })
      .filter(Boolean);

      // ── Publication gate (deterministic, downgrade-only) ───────────────────
      // Weak/news-like candidates must not publish as active risks. This only
      // DOWNGRADES (risk → watch) and rewrites article-like titles / generic
      // "monitor" actions into operating-exposure copy, and records a per-row
      // gate_reason in methodology. Established issues are preserved on UPDATE
      // (see merge below), so this affects new INSERTs only — demo-safe.
      const GATE_DRIVER_TITLES: Record<string, string> = {
        freight_logistics_pressure: "Spot-exposed freight lanes require surcharge validation",
        tariff_trade_policy_relief: "Tariff-linked supplier cost exposure requires country-of-origin validation",
        steel_metal_watch: "Steel-linked supplier landed-cost exposure requires validation",
        copper_macro_watch: "Copper-linked supplier cost exposure requires validation",
        aluminum_macro_watch: "Aluminum-linked supplier cost exposure requires validation",
        demand_macro_watch: "Customer demand shift requires segment-level quote validation",
        competitor_watch: "Competitive pricing pressure requires account-level validation",
      };
      const GATE_DRIVER_ACTIONS: Record<string, { owner: string; next: string }> = {
        freight_logistics_pressure: { owner: "Head of Logistics", next: "Pull top spot-exposed lanes, current surcharge terms, carrier contract coverage, and repricing dates." },
        tariff_trade_policy_relief: { owner: "Head of Procurement", next: "Pull top tariff-exposed supplier spend by SKU, country of origin, HTS code, supplier price update, and open PO value." },
        steel_metal_watch: { owner: "Head of Procurement", next: "Pull top steel-linked supplier spend by SKU, country of origin, HTS code, supplier price update, and pass-through status." },
        copper_macro_watch: { owner: "Head of Procurement", next: "Validate copper-linked supplier spend, country of origin, and pass-through exposure." },
        aluminum_macro_watch: { owner: "Head of Procurement", next: "Validate aluminum-linked supplier spend, country of origin, and pass-through exposure." },
        demand_macro_watch: { owner: "VP Sales", next: "Validate quote volume, win rate, pipeline conversion, and customer segment exposure." },
        competitor_watch: { owner: "Head of Commercial", next: "Validate account-level win/loss, price gaps, and at-risk revenue by segment." },
      };
      const ARTICLE_TITLE_RE = /(['’]s )|(\bpost-)|\(|acquisition|merger|to buy|to acquire/i;
      const GENERIC_ACTION_RE = /^(monitor|track|keep an eye|watch|stay informed|observe)\b/i;
      const gateDriverKey = (issueKey: string): string | null =>
        GATE_DRIVER_TITLES[issueKey] ? issueKey
          : issueKey.startsWith("steel") ? "steel_metal_watch"
          : issueKey.startsWith("copper") ? "copper_macro_watch"
          : issueKey.startsWith("aluminum") ? "aluminum_macro_watch"
          : issueKey.startsWith("tariff") ? "tariff_trade_policy_relief"
          : issueKey.startsWith("freight") ? "freight_logistics_pressure"
          : null;

      for (const row of riskRows as any[]) {
        const m = row.methodology || {};
        const ci = m.calculation_inputs || {};
        const calibratedInputs = Object.keys(ci).filter(
          (k) => ci[k] !== null && ci[k] !== undefined && ci[k] !== ""
        );
        const hasFormula = m.formula_status !== "not_calculated" && (!!m.formula || !!m.formula_text || calibratedInputs.length >= 2);
        const hasValue = Number(row.impact_high || 0) > 0;
        const hasEvidence = Array.isArray(row.evidence_items) && row.evidence_items.length > 0;
        const driverKey = gateDriverKey(row.issue_key);
        const isActive = row.display_section === "risk_register" || row.display_section === "operating_changes";

        // Operating-exposure title (article title preserved as external signal).
        if (isActive && driverKey && ARTICLE_TITLE_RE.test(String(row.risk_title || ""))) {
          m.external_signal_title = row.risk_title;
          row.risk_title = GATE_DRIVER_TITLES[driverKey];
        }
        // Operational action (replace generic "monitor X").
        const genericAction = GENERIC_ACTION_RE.test(String(row.action_required || "").trim());
        if (isActive && driverKey && (genericAction || !String(row.action_required || "").trim())) {
          row.action_required = GATE_DRIVER_ACTIONS[driverKey].next;
          if (!row.owner || row.owner === "Executive Owner") row.owner = GATE_DRIVER_ACTIONS[driverKey].owner;
        }

        const missing: string[] = [];
        if (!hasEvidence) missing.push("primary_evidence");
        if (calibratedInputs.length < 2) missing.push("calibrated_inputs");
        if (!hasFormula) missing.push("calculation_formula");
        if (!hasValue) missing.push("value_at_stake");
        if (!row.owner || row.owner === "Executive Owner") missing.push("owner");
        if (GENERIC_ACTION_RE.test(String(row.action_required || "").trim())) missing.push("operational_action");

        let gate_status = "published";
        let gate_reason =
          "Published as active risk: source-backed signal with company exposure basis, calibrated inputs, a calculation formula, and an operational owner action.";
        if (isActive && missing.length > 0) {
          row.display_section = "watchlist";
          row.issue_category = "watchlist";
          row.is_actionable_risk = false;
          gate_status = "watch";
          gate_reason = `Watch only — not published as active risk because it is missing: ${missing.join(", ")}. Provide these to promote.`;
        } else if (!isActive) {
          gate_status = "watch";
          gate_reason = row.exposure_interpretation || "Watch: relevant external signal without a sufficient, validated direct company exposure basis.";
        }

        const verified = m.calibration_status === "calibrated" && (m.has_verified_shock === true || m.shock_interpretation === "adverse_verified_shock");
        const scenario_status = gate_status === "watch" ? "watch_no_estimate"
          : verified ? "verified_metric"
          : calibratedInputs.length >= 2 ? "company_calibrated_scenario"
          : "pending_validation";

        row.methodology = {
          ...m,
          gate_status,
          gate_reason,
          missing_inputs: missing,
          scenario_status,
          calibration_inputs_used: calibratedInputs,
        };
      }

      riskRows.sort((a: any, b: any) => {
  const priorityDiff = Number(b.priority_score || 0) - Number(a.priority_score || 0);
  if (priorityDiff !== 0) return priorityDiff;

  const impactDiff = Number(b.impact_high || 0) - Number(a.impact_high || 0);
  if (impactDiff !== 0) return impactDiff;

  return Number(b.probability || 0) - Number(a.probability || 0);
});

riskRows.forEach((row: any, index: number) => {
  row.risk_rank = index + 1;
  row.due_days = index === 0 ? 7 : 14;
});

    if (riskRows.length === 0) {
      return jsonResponse({
        ok: true,
        inserted: 0,
        merged: 0,
        message: "No new material clusters this run. Existing published intelligence preserved.",
        clusters,
      });
    }

    // Dedupe within this run by issue_key (rows are pre-sorted by priority; keep the first)
    // so one upsert statement never writes the same (company_id, issue_key) twice.
    const seenKeys = new Set<string>();
    const dedupedRows = riskRows.filter((row: any) => {
      if (seenKeys.has(row.issue_key)) return false;
      seenKeys.add(row.issue_key);
      return true;
    });

    // NON-DESTRUCTIVE MERGE by (company_id, issue_key). Matched issues UPDATE in place
    // (id + created_at preserved → decision memory / outcomes survive). Issues NOT regenerated
    // this run are left untouched (preserved) — nothing is deleted. New issues INSERT.
    //
    // CRITICAL: an established issue's CLASSIFICATION is identity, not a per-run estimate. The
    // Gemini classifier is non-deterministic, so on UPDATE we PRESERVE issue_category /
    // display_section / issue_direction / is_actionable_risk / exposure_interpretation and only
    // refresh the volatile fields (estimate, title, evidence, methodology, last_seen). Type is
    // only set on INSERT (or by an explicit supersede/invalidate path, not implemented here).
    const SELECT_COLS =
      "id, issue_key, risk_title, owner, action_required, expected_benefit, due_days, display_section, is_actionable_risk";
    const { data: existingRisks } = await supabase
      .from("risk_register")
      .select("id, issue_key")
      .eq("company_id", companyId)
      .in("issue_key", dedupedRows.map((r: any) => r.issue_key));
    const existingRiskIdByKey = new Map<string, string>();
    for (const r of existingRisks || []) existingRiskIdByKey.set(r.issue_key, r.id);

    const upsertedRisks: any[] = [];
    let risksInserted = 0;
    let risksUpdated = 0;
    for (const row of dedupedRows) {
      const existingId = existingRiskIdByKey.get(row.issue_key);
      if (existingId) {
        // Strip identity + estimate-basis fields so a noisy re-run never flips an established
        // issue's type OR re-derives its stored estimate/methodology from article text. The
        // executive view model is the live source of truth for displayed dollars; the stored
        // methodology/impact/business_impact are only kept for the Model Audit and must stay
        // canonical once set (e.g. the tariff operating change must not regress to an
        // article-extracted "30% / $52.5M" basis).
        const {
          issue_category: _ic,
          display_section: _ds,
          issue_direction: _id,
          is_actionable_risk: _iar,
          exposure_interpretation: _ei,
          company_id: _cid,
          methodology: _m,
          business_impact: _bi,
          impact_low: _il,
          impact_high: _ih,
          ...updatable
        } = row;
        const { data, error } = await supabase
          .from("risk_register")
          .update(updatable)
          .eq("id", existingId)
          .select(SELECT_COLS)
          .single();
        if (error) throw error;
        upsertedRisks.push(data);
        risksUpdated++;
      } else {
        const { data, error } = await supabase
          .from("risk_register")
          .insert(row)
          .select(SELECT_COLS)
          .single();
        if (error) throw error;
        upsertedRisks.push(data);
        risksInserted++;
      }
    }

    // ── Action merge (idempotent, non-destructive) ──
    // Create/update a validation action for actionable risks AND the canonical tariff operating
    // change (which needs supplier landed-cost validation). Actions are never bulk-deleted.
    const actionableIssues = (upsertedRisks || []).filter(
      (risk: any) =>
        (risk.is_actionable_risk !== false && risk.display_section === "risk_register") ||
        risk.issue_key === "tariff_trade_policy_relief"
    );

    const { data: existingActions } = await supabase
      .from("risk_actions")
      .select("id, issue_key")
      .eq("company_id", companyId);
    const existingActionByKey = new Map<string, any>();
    for (const a of existingActions || []) {
      if (a.issue_key) existingActionByKey.set(a.issue_key, a);
    }

    let actionsCreated = 0;
    let actionsUpdated = 0;
    for (const risk of actionableIssues) {
      const deadline = new Date();
      deadline.setUTCDate(deadline.getUTCDate() + Number(risk.due_days || 14));
      const isTariffChange = risk.issue_key === "tariff_trade_policy_relief";
      const fields: Record<string, unknown> = {
        company_id: companyId,
        issue_key: risk.issue_key,
        risk_id: risk.id,
        title:
          risk.action_required ||
          (isTariffChange
            ? "Validate tariff relief — confirm supplier landed-cost updates and remaining exposure"
            : "Review the issue and decide whether mitigation is needed."),
        owner: risk.owner || (isTariffChange ? "Head of Procurement" : "Executive Owner"),
        deadline: deadline.toISOString().slice(0, 10),
        expected_benefit: risk.expected_benefit,
        source_type: isTariffChange ? "operating_change" : "risk",
      };
      const existing = existingActionByKey.get(risk.issue_key);
      if (existing) {
        // Preserve user-set status; refresh linkage/copy/deadline only.
        const { error } = await supabase.from("risk_actions").update(fields).eq("id", existing.id);
        if (error) throw error;
        actionsUpdated++;
      } else {
        const { error } = await supabase.from("risk_actions").insert({ ...fields, status: "open" });
        if (error) throw error;
        actionsCreated++;
      }
    }

    return jsonResponse({
      ok: true,
      generator_version: "dynamic-evidence-cluster-risk-v4-nondestructive-merge",
      evidence_loaded: evidence.length,
      clusters_returned: clusters.length,
      merged: dedupedRows.length,
      risks_inserted: risksInserted,
      risks_updated: risksUpdated,
      issue_keys: dedupedRows.map((r: any) => r.issue_key),
      actions_created: actionsCreated,
      actions_updated: actionsUpdated,
      risks: dedupedRows.map((row: any) => ({
        issue_key: row.issue_key,
        risk_title: row.risk_title,
        source_event_count: row.source_event_ids.length,
        evidence_titles: row.evidence_titles,
      })),
    });
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : null,
      },
      500
    );
  }
});