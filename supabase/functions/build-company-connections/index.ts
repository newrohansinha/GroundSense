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

function clean(value: unknown) {
  return String(value || "").trim();
}

function normalize(value: unknown) {
  return clean(value)
    .toLowerCase()
    .replace(/[^\w\s.-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function canonicalEntity(value: string) {
  const raw = clean(value);
  const n = normalize(raw);

  if (!raw) return raw;

  if (
    n === "manufacturing" ||
    n === "manufacturing customers" ||
    n.includes("manufacturing segment")
  ) {
    return "Manufacturing Customers";
  }

  if (
    n === "construction" ||
    n === "construction customers" ||
    n.includes("construction segment")
  ) {
    return "Construction Customers";
  }

  if (
    n === "utilities" ||
    n === "utility" ||
    n === "utilities customers" ||
    n === "utility customers" ||
    n.includes("utility segment")
  ) {
    return "Utilities Customers";
  }

  if (n === "industrial maintenance") {
    return "Industrial Maintenance Customers";
  }

  if (n.includes("w.w. grainger") || n === "grainger") {
    return "W.W. Grainger";
  }

  if (n.includes("msc industrial")) {
    return "MSC Industrial Direct";
  }

  if (n.includes("applied industrial")) {
    return "Applied Industrial Technologies";
  }

  if (n.includes("wurth") || n.includes("würth")) {
    return "Würth";
  }

  if (n.includes("white cap")) {
    return "White Cap";
  }

  if (n.includes("steel")) return "Steel";
  if (n.includes("aluminum")) return "Aluminum";
  if (n.includes("copper")) return "Copper";
  if (n.includes("freight") || n.includes("logistics")) return "Freight";

  return raw;
}

function num(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function pct(value: unknown) {
  const n = num(value);
  return n > 0 ? n / 100 : 0;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function unique(values: string[]) {
  return [...new Set(values.map((value) => canonicalEntity(value)).filter(Boolean))];
}

function formatMoney(value: number) {
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${Math.round(value / 1_000)}K`;
  return `$${Math.round(value)}`;
}

function parseRevenueRange(value: unknown) {
  const raw = clean(value);

  if (!raw) return 0;

  const multiplier =
    raw.toLowerCase().includes("b")
      ? 1_000_000_000
      : raw.toLowerCase().includes("m")
        ? 1_000_000
        : raw.toLowerCase().includes("k")
          ? 1_000
          : 1;

  const numbers = raw
    .replace(/,/g, "")
    .match(/\d+(\.\d+)?/g)
    ?.map((x) => Number(x) * multiplier)
    .filter((x) => Number.isFinite(x) && x > 0);

  if (!numbers || numbers.length === 0) return 0;

  return numbers.reduce((sum, x) => sum + x, 0) / numbers.length;
}

function numberField(row: any, keys: string[]) {
  for (const key of keys) {
    const value = num(row?.[key]);

    if (value > 0) return value;
  }

  return 0;
}

function getEntityValues(entities: any[], type: string) {
  return unique(
    entities
      .filter((entity) => entity.entity_type === type)
      .map((entity) => entity.entity_value)
  );
}

function getSupplierName(row: any) {
  return canonicalEntity(row.supplier_name || row.entity_value || row.name || "");
}

function getSupplierSpend(row: any) {
  return numberField(row, [
    "annual_spend_estimate",
    "spend_estimate",
    "estimated_spend",
    "annual_spend",
  ]);
}

function getConnectionKey(connection: any) {
  return [
    connection.company_id,
    connection.from_type,
    connection.from_name,
    connection.to_type,
    connection.to_name,
    connection.relationship_type,
  ].join("|");
}

function getPathKey(path: any) {
  return [
    path.company_id,
    path.trigger_type,
    path.trigger_name,
    path.affected_type,
    path.affected_name,
    path.impact_category,
  ].join("|");
}

function dedupeConnections(connections: any[]) {
  const map = new Map<string, any>();

  for (const connection of connections) {
    const key = getConnectionKey(connection);
    const existing = map.get(key);

    if (!existing) {
      map.set(key, connection);
      continue;
    }

    existing.exposure_value = Math.max(
      num(existing.exposure_value),
      num(connection.exposure_value)
    );

    existing.strength = Math.max(num(existing.strength), num(connection.strength));

    existing.metadata = {
      ...(existing.metadata || {}),
      ...(connection.metadata || {}),
      merged_duplicate: true,
    };

    map.set(key, existing);
  }

  return [...map.values()];
}

function dedupePaths(paths: any[]) {
  const map = new Map<string, any>();

  for (const path of paths) {
    const key = getPathKey(path);
    const existing = map.get(key);

    if (!existing) {
      map.set(key, path);
      continue;
    }

    existing.exposure_low = Math.max(num(existing.exposure_low), num(path.exposure_low));
    existing.exposure_high = Math.max(num(existing.exposure_high), num(path.exposure_high));
    existing.priority_score = Math.max(num(existing.priority_score), num(path.priority_score));
    existing.impact_weight = Math.max(num(existing.impact_weight), num(path.impact_weight));

    existing.metadata = {
      ...(existing.metadata || {}),
      ...(path.metadata || {}),
      merged_duplicate: true,
    };

    map.set(key, existing);
  }

  return [...map.values()];
}

function addConnection(
  connections: any[],
  input: {
    companyId: string;
    fromType: string;
    fromName: string;
    toType: string;
    toName: string;
    relationshipType: string;
    strength: number;
    exposureValue?: number;
    calibrationStatus: string;
    metadata: Record<string, unknown>;
  }
) {
  const fromName = canonicalEntity(input.fromName);
  const toName = canonicalEntity(input.toName);

  if (!fromName || !toName || fromName === toName) return;

  connections.push({
    company_id: input.companyId,
    from_type: input.fromType,
    from_name: fromName,
    to_type: input.toType,
    to_name: toName,
    relationship_type: input.relationshipType,
    strength: clamp(input.strength, 0.01, 1),
    exposure_value: Math.round(num(input.exposureValue)),
    source_table: input.metadata.source_table || "company_calibration",
    calibration_status: input.calibrationStatus,
    metadata: input.metadata,
  });
}

function addImpactPath(
  paths: any[],
  input: {
    companyId: string;
    triggerType: string;
    triggerName: string;
    affectedType: string;
    affectedName: string;
    impactCategory: string;
    impactWeight: number;
    exposureLow?: number;
    exposureHigh?: number;
    priorityScore: number;
    pathNodes: string[];
    actionHint: string;
    calibrationStatus: "calculated" | "needs_calibration" | "partially_calibrated";
    metadata: Record<string, unknown>;
  }
) {
  const triggerName = canonicalEntity(input.triggerName);
  const affectedName = canonicalEntity(input.affectedName);

  if (!triggerName || !affectedName) return;

  paths.push({
    company_id: input.companyId,
    trigger_type: input.triggerType,
    trigger_name: triggerName,
    affected_type: input.affectedType,
    affected_name: affectedName,
    impact_category: input.impactCategory,
    impact_weight: clamp(input.impactWeight, 0.01, 1),
    exposure_low: Math.round(num(input.exposureLow)),
    exposure_high: Math.round(num(input.exposureHigh)),
    priority_score: clamp(Math.round(input.priorityScore), 1, 100),
    path_nodes: input.pathNodes.map((node) => canonicalEntity(node)),
    action_hint: input.actionHint,
    calibration_status: input.calibrationStatus,
    metadata: input.metadata,
  });
}

function priorityScore({
  exposureHigh,
  annualRevenue,
  completeness,
}: {
  exposureHigh: number;
  annualRevenue: number;
  completeness: number;
}) {
  if (exposureHigh <= 0 || annualRevenue <= 0) {
    return completeness >= 0.75 ? 55 : 35;
  }

  const exposurePct = exposureHigh / annualRevenue;
  const exposureScore = clamp(exposurePct * 1200, 0, 45);
  const completenessScore = completeness * 30;

  return clamp(35 + exposureScore + completenessScore, 35, 95);
}

function createMissingPath(
  paths: any[],
  input: {
    companyId: string;
    triggerType: string;
    triggerName: string;
    affectedType: string;
    affectedName: string;
    impactCategory: string;
    missingInputs: string[];
    pathNodes: string[];
    actionHint: string;
  }
) {
  addImpactPath(paths, {
    companyId: input.companyId,
    triggerType: input.triggerType,
    triggerName: input.triggerName,
    affectedType: input.affectedType,
    affectedName: input.affectedName,
    impactCategory: input.impactCategory,
    impactWeight: 0.2,
    exposureLow: 0,
    exposureHigh: 0,
    priorityScore: 35,
    pathNodes: input.pathNodes,
    actionHint: input.actionHint,
    calibrationStatus: "needs_calibration",
    metadata: {
      formula_status: "not_calculated",
      display_unit: "needs_calibration",
      missing_inputs: input.missingInputs,
      calculation_steps: [
        "No dollar estimate shown because required real inputs are missing.",
      ],
      source: "company_calibration",
      honesty_note:
        "GroundSense does not invent a dollar estimate when required calibration inputs are missing.",
    },
  });
}

function segmentRows(calibration: any) {
  const rows = [
    {
      name: "Manufacturing Customers",
      revenue: num(calibration.manufacturing_revenue),
      sourceField: "manufacturing_revenue",
    },
    {
      name: "Construction Customers",
      revenue: num(calibration.construction_revenue),
      sourceField: "construction_revenue",
    },
    {
      name: "Utilities Customers",
      revenue: num(calibration.utilities_revenue),
      sourceField: "utilities_revenue",
    },
    {
      name: "Industrial Maintenance Customers",
      revenue: num(calibration.industrial_maintenance_revenue),
      sourceField: "industrial_maintenance_revenue",
    },
  ];

  return rows.filter((row) => row.revenue > 0);
}

function commodityRows(calibration: any) {
  const rows = [
    {
      name: "Steel",
      spend: num(calibration.steel_spend),
      sourceField: "steel_spend",
    },
    {
      name: "Copper",
      spend: num(calibration.copper_spend),
      sourceField: "copper_spend",
    },
    {
      name: "Aluminum",
      spend: num(calibration.aluminum_spend),
      sourceField: "aluminum_spend",
    },
    {
      name: "Freight",
      spend: num(calibration.freight_spend),
      sourceField: "freight_spend",
    },
  ];

  return rows.filter((row) => row.spend > 0);
}

function competitorDefaults(entities: any[]) {
  const competitors = getEntityValues(entities, "competitor");

  if (competitors.length > 0) return competitors;

  return [
    "W.W. Grainger",
    "MSC Industrial Direct",
    "Applied Industrial Technologies",
    "Würth",
    "White Cap",
  ];
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const { companyId } = await req.json();

    if (!companyId) {
      return jsonResponse({ error: "Missing companyId" }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse({ error: "Missing Supabase env vars" }, 500);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const [
      companyResult,
      calibrationResult,
      entitiesResult,
      supplierResult,
    ] = await Promise.all([
      supabase.from("companies").select("*").eq("id", companyId).maybeSingle(),

      supabase
        .from("company_calibration")
        .select("*")
        .eq("company_id", companyId)
        .maybeSingle(),

      supabase
        .from("company_entities")
        .select("*")
        .eq("company_id", companyId),

      supabase
        .from("supplier_exposure")
        .select("*")
        .eq("company_id", companyId),
    ]);

    const company = companyResult.data || {};
    const calibration = calibrationResult.data || {};
    const entities = entitiesResult.data || [];
    const suppliers = supplierResult.data || [];

    const companyName = canonicalEntity(company.name || "Company");

    const annualRevenue =
      num(calibration.annual_revenue) || parseRevenueRange(company.revenue_range);

    const segments = segmentRows(calibration);
    const commodities = commodityRows(calibration);
    const competitors = competitorDefaults(entities);

    const passThroughCoverage = pct(calibration.pass_through_coverage_pct);
const repricingLagDays = num(calibration.average_repricing_lag_days);

const quoteWinRate = pct(calibration.quote_win_rate_pct);
const explicitLostQuoteRate = pct(calibration.lost_quote_rate_pct);
const derivedLostQuoteRate =
  explicitLostQuoteRate > 0
    ? 0
    : quoteWinRate > 0 && quoteWinRate < 1
      ? 1 - quoteWinRate
      : 0;

const lostQuoteRate = explicitLostQuoteRate || derivedLostQuoteRate;
const lostQuoteRateSource =
  explicitLostQuoteRate > 0
    ? "lost_quote_rate_pct"
    : derivedLostQuoteRate > 0
      ? "derived from quote_win_rate_pct as 100% - quote_win_rate_pct"
      : "not provided";

const churnRate = pct(calibration.customer_churn_rate_pct);
const backorderRate = pct(calibration.backorder_rate_pct);
    const backorderCancellationRate = pct(calibration.backorder_cancellation_rate_pct);
    const expeditePremium = pct(calibration.expedite_premium_pct);

    const connections: any[] = [];
    const paths: any[] = [];

    for (const segment of segments) {
      addConnection(connections, {
        companyId,
        fromType: "company",
        fromName: companyName,
        toType: "customer_segment",
        toName: segment.name,
        relationshipType: "revenue_base",
        strength: annualRevenue > 0 ? clamp(segment.revenue / annualRevenue, 0.1, 1) : 0.5,
        exposureValue: segment.revenue,
        calibrationStatus: "calculated",
        metadata: {
          source_table: "company_calibration",
          source_field: segment.sourceField,
          formula: `${segment.sourceField}`,
          calculation_steps: [
            `${segment.name} revenue base = ${formatMoney(segment.revenue)}`,
          ],
        },
      });
    }

    for (const commodity of commodities) {
      addConnection(connections, {
        companyId,
        fromType: "company",
        fromName: companyName,
        toType: "commodity",
        toName: commodity.name,
        relationshipType: "spend_base",
        strength: annualRevenue > 0 ? clamp(commodity.spend / annualRevenue, 0.1, 1) : 0.5,
        exposureValue: commodity.spend,
        calibrationStatus: "calculated",
        metadata: {
          source_table: "company_calibration",
          source_field: commodity.sourceField,
          formula: `${commodity.sourceField}`,
          calculation_steps: [
            `${commodity.name} spend base = ${formatMoney(commodity.spend)}`,
          ],
        },
      });
    }

    for (const commodity of commodities) {
      const missingInputs = [];

      if (commodity.spend <= 0) missingInputs.push(commodity.sourceField);
      if (passThroughCoverage <= 0) missingInputs.push("pass_through_coverage_pct");
      if (repricingLagDays <= 0) missingInputs.push("average_repricing_lag_days");

      if (missingInputs.length > 0) {
        for (const segment of segments.slice(0, 2)) {
          createMissingPath(paths, {
            companyId,
            triggerType: "commodity",
            triggerName: commodity.name,
            affectedType: "customer_segment",
            affectedName: segment.name,
            impactCategory: "commodity_pass_through_sensitivity",
            missingInputs,
            pathNodes: [
              commodity.name,
              "Price move",
              "Unpassed cost",
              "Repricing lag",
              segment.name,
              "Margin exposure",
            ],
            actionHint:
              "Add commodity spend, pass-through coverage, and repricing lag to calculate this exposure.",
          });
        }

        continue;
      }

      const lagFactor = repricingLagDays / 90;
      const unpassedPct = 1 - passThroughCoverage;
      const exposurePerOnePctMove =
        commodity.spend * 0.01 * unpassedPct * lagFactor;

      for (const segment of segments.slice(0, 3)) {
        addImpactPath(paths, {
          companyId,
          triggerType: "commodity",
          triggerName: commodity.name,
          affectedType: "customer_segment",
          affectedName: segment.name,
          impactCategory: "commodity_pass_through_sensitivity",
          impactWeight: 0.8,
          exposureLow: exposurePerOnePctMove,
          exposureHigh: exposurePerOnePctMove,
          priorityScore: priorityScore({
            exposureHigh: exposurePerOnePctMove,
            annualRevenue,
            completeness: 1,
          }),
          pathNodes: [
            commodity.name,
            "1% price move",
            "Unpassed cost after pass-through",
            `${repricingLagDays}-day repricing lag`,
            segment.name,
            "Margin exposure",
          ],
          actionHint: `For each 1% move in ${commodity.name}, review pricing updates for ${segment.name}.`,
          calibrationStatus: "calculated",
          metadata: {
            display_unit: "dollars_per_1pct_price_move",
            formula:
              "Exposure per 1% price move = commodity_spend × 1% × (1 - pass_through_coverage_pct) × (repricing_lag_days / 90)",
            source_table: "company_calibration",
            source_fields: [
              commodity.sourceField,
              "pass_through_coverage_pct",
              "average_repricing_lag_days",
            ],
            calculation_steps: [
              `${commodity.name} spend = ${formatMoney(commodity.spend)}`,
              `Price move unit = 1%`,
              `Pass-through coverage = ${calibration.pass_through_coverage_pct}%`,
              `Unpassed cost share = 1 - ${calibration.pass_through_coverage_pct}% = ${(unpassedPct * 100).toFixed(1)}%`,
              `Repricing lag factor = ${repricingLagDays} / 90 = ${lagFactor.toFixed(2)}`,
              `${formatMoney(commodity.spend)} × 1% × ${(unpassedPct * 100).toFixed(1)}% × ${lagFactor.toFixed(2)} = ${formatMoney(exposurePerOnePctMove)} per 1% price move`,
            ],
            honesty_note:
              "This is not a guessed current loss. It is a calibrated sensitivity per 1% commodity price move.",
          },
        });
      }
    }

    for (const competitor of competitors) {
  for (const segment of segments) {
    const availableRates = [
      {
        name: lostQuoteRateSource,
        value: lostQuoteRate,
      },
      {
        name: "customer_churn_rate_pct",
        value: churnRate,
      },
    ].filter((rate) => rate.value > 0);

    if (availableRates.length === 0) {
      createMissingPath(paths, {
        companyId,
        triggerType: "competitor",
        triggerName: competitor,
        affectedType: "customer_segment",
        affectedName: segment.name,
        impactCategory: "competitor_revenue_risk",
        missingInputs: [
          "lost_quote_rate_pct, customer_churn_rate_pct, or quote_win_rate_pct",
        ],
        pathNodes: [
          competitor,
          "Competitive pressure",
          segment.name,
          "Quote loss or churn",
          "Revenue at risk",
        ],
        actionHint:
          "Add lost quote rate, customer churn rate, or quote win rate to calculate competitor revenue exposure.",
      });

      continue;
    }

    const sortedRates = [...availableRates].sort((a, b) => a.value - b.value);
    const lowRate = sortedRates[0];
    const highRate = sortedRates[sortedRates.length - 1];

    const low = segment.revenue * lowRate.value;
    const high = segment.revenue * highRate.value;

    addConnection(connections, {
      companyId,
      fromType: "competitor",
      fromName: competitor,
      toType: "customer_segment",
      toName: segment.name,
      relationshipType: "competitor_pressure",
      strength: 0.7,
      exposureValue: high,
      calibrationStatus: "calculated",
      metadata: {
        formula: "segment_revenue × historical loss rate",
        source_fields: [
          segment.sourceField,
          lowRate.name,
          highRate.name,
        ],
      },
    });

    addImpactPath(paths, {
      companyId,
      triggerType: "competitor",
      triggerName: competitor,
      affectedType: "customer_segment",
      affectedName: segment.name,
      impactCategory: "competitor_revenue_risk",
      impactWeight: 0.7,
      exposureLow: low,
      exposureHigh: high,
      priorityScore: priorityScore({
        exposureHigh: high,
        annualRevenue,
        completeness: 1,
      }),
      pathNodes: [
        competitor,
        "Competitive pressure",
        segment.name,
        "Historical quote loss or churn rate",
        "Revenue at risk",
      ],
      actionHint: `If ${competitor} becomes active in ${segment.name}, review lost quotes, churn, and win-back actions.`,
      calibrationStatus: "calculated",
      metadata: {
        display_unit: "absolute_dollars",
        formula:
          "Revenue at risk = segment_revenue × historical loss rate",
        source_table: "company_calibration",
        source_fields: [
          segment.sourceField,
          lowRate.name,
          highRate.name,
        ],
        calculation_steps: [
          `${segment.name} revenue = ${formatMoney(segment.revenue)}`,
          `Quote win rate = ${
            calibration.quote_win_rate_pct || "not provided"
          }%`,
          `Lost quote rate = ${
            calibration.lost_quote_rate_pct ||
            (derivedLostQuoteRate > 0
              ? `100% - ${calibration.quote_win_rate_pct}% = ${(derivedLostQuoteRate * 100).toFixed(2)}%`
              : "not provided")
          }`,
          `Customer churn rate = ${
            calibration.customer_churn_rate_pct || "not provided"
          }%`,
          `Low rate source = ${lowRate.name}`,
          `Low rate = ${(lowRate.value * 100).toFixed(2)}%`,
          `High rate source = ${highRate.name}`,
          `High rate = ${(highRate.value * 100).toFixed(2)}%`,
          `${formatMoney(segment.revenue)} × ${(lowRate.value * 100).toFixed(
            2
          )}% = ${formatMoney(low)}`,
          `${formatMoney(segment.revenue)} × ${(highRate.value * 100).toFixed(
            2
          )}% = ${formatMoney(high)}`,
        ],
        honesty_note:
          "This uses calibrated sales inputs. If lost quote rate is missing but quote win rate exists, lost quote rate is derived as 100% - quote win rate.",
      },
    });
  }
}

    for (const segment of segments) {
      const missingInputs = [];

      if (backorderRate <= 0) missingInputs.push("backorder_rate_pct");
      if (backorderCancellationRate <= 0) {
        missingInputs.push("backorder_cancellation_rate_pct");
      }

      if (missingInputs.length > 0) {
        createMissingPath(paths, {
          companyId,
          triggerType: "service_level",
          triggerName: "Fill rate / backorders",
          affectedType: "customer_segment",
          affectedName: segment.name,
          impactCategory: "service_level_revenue_leakage",
          missingInputs,
          pathNodes: [
            "Backorders",
            "Cancellation rate",
            segment.name,
            "Revenue leakage",
          ],
          actionHint:
            "Add backorder rate and backorder cancellation rate to calculate service leakage.",
        });

        continue;
      }

      const exposure = segment.revenue * backorderRate * backorderCancellationRate;

      addImpactPath(paths, {
        companyId,
        triggerType: "service_level",
        triggerName: "Fill rate / backorders",
        affectedType: "customer_segment",
        affectedName: segment.name,
        impactCategory: "service_level_revenue_leakage",
        impactWeight: 0.75,
        exposureLow: exposure,
        exposureHigh: exposure,
        priorityScore: priorityScore({
          exposureHigh: exposure,
          annualRevenue,
          completeness: 1,
        }),
        pathNodes: [
          "Backorders",
          "Backorder cancellation rate",
          segment.name,
          "Revenue leakage",
        ],
        actionHint: `Track backorder cancellation exposure for ${segment.name}.`,
        calibrationStatus: "calculated",
        metadata: {
          display_unit: "absolute_dollars",
          formula:
            "Service leakage = segment_revenue × backorder_rate_pct × backorder_cancellation_rate_pct",
          source_table: "company_calibration",
          source_fields: [
            segment.sourceField,
            "backorder_rate_pct",
            "backorder_cancellation_rate_pct",
          ],
          calculation_steps: [
            `${segment.name} revenue = ${formatMoney(segment.revenue)}`,
            `Backorder rate = ${calibration.backorder_rate_pct}%`,
            `Backorder cancellation rate = ${calibration.backorder_cancellation_rate_pct}%`,
            `${formatMoney(segment.revenue)} × ${calibration.backorder_rate_pct}% × ${calibration.backorder_cancellation_rate_pct}% = ${formatMoney(exposure)}`,
          ],
          honesty_note:
            "This is calculated from real operating metrics, not a generic scenario band.",
        },
      });
    }

    for (const supplier of suppliers) {
      const supplierName = getSupplierName(supplier);
      const supplierSpend = getSupplierSpend(supplier);

      if (!supplierName || supplierSpend <= 0) continue;

      addConnection(connections, {
        companyId,
        fromType: "company",
        fromName: companyName,
        toType: "supplier",
        toName: supplierName,
        relationshipType: "supplier_spend_base",
        strength: annualRevenue > 0 ? clamp(supplierSpend / annualRevenue, 0.1, 1) : 0.5,
        exposureValue: supplierSpend,
        calibrationStatus: "calculated",
        metadata: {
          source_table: "supplier_exposure",
          formula: "supplier annual spend",
          calculation_steps: [
            `${supplierName} annual spend = ${formatMoney(supplierSpend)}`,
          ],
        },
      });

      if (expeditePremium <= 0) {
        createMissingPath(paths, {
          companyId,
          triggerType: "supplier",
          triggerName: supplierName,
          affectedType: "financial_metric",
          affectedName: "Procurement cost",
          impactCategory: "supplier_expedite_cost",
          missingInputs: ["expedite_premium_pct"],
          pathNodes: [
            supplierName,
            "Supplier disruption",
            "Expedite premium",
            "Procurement cost exposure",
          ],
          actionHint:
            "Add historical expedite premium percentage to calculate supplier disruption exposure.",
        });

        continue;
      }

      const exposure = supplierSpend * expeditePremium;

      addImpactPath(paths, {
        companyId,
        triggerType: "supplier",
        triggerName: supplierName,
        affectedType: "financial_metric",
        affectedName: "Procurement cost",
        impactCategory: "supplier_expedite_cost",
        impactWeight: 0.8,
        exposureLow: exposure,
        exposureHigh: exposure,
        priorityScore: priorityScore({
          exposureHigh: exposure,
          annualRevenue,
          completeness: 1,
        }),
        pathNodes: [
          supplierName,
          "Supplier disruption",
          "Historical expedite premium",
          "Procurement cost exposure",
        ],
        actionHint: `If ${supplierName} is disrupted, estimate expedite exposure using historical premium.`,
        calibrationStatus: "calculated",
        metadata: {
          display_unit: "absolute_dollars",
          formula:
            "Supplier expedite exposure = supplier_annual_spend × expedite_premium_pct",
          source_table: "supplier_exposure + company_calibration",
          source_fields: ["supplier annual spend", "expedite_premium_pct"],
          calculation_steps: [
            `${supplierName} annual spend = ${formatMoney(supplierSpend)}`,
            `Expedite premium = ${calibration.expedite_premium_pct}%`,
            `${formatMoney(supplierSpend)} × ${calibration.expedite_premium_pct}% = ${formatMoney(exposure)}`,
          ],
          honesty_note:
            "This uses supplier spend and historical expedite premium. It does not invent a disruption percentage.",
        },
      });
    }

    const finalConnections = dedupeConnections(connections)
      .sort((a, b) => num(b.exposure_value) - num(a.exposure_value))
      .slice(0, 80);

    const finalPaths = dedupePaths(paths)
      .sort((a, b) => num(b.priority_score) - num(a.priority_score))
      .slice(0, 80);

    const [{ count: deletedConnections }, { count: deletedPaths }] =
      await Promise.all([
        supabase
          .from("company_connections")
          .delete({ count: "exact" })
          .eq("company_id", companyId),

        supabase
          .from("impact_paths")
          .delete({ count: "exact" })
          .eq("company_id", companyId),
      ]);

    let connectionInsertError: string | null = null;
    let pathInsertError: string | null = null;

    if (finalConnections.length > 0) {
      const { error } = await supabase
        .from("company_connections")
        .insert(finalConnections);

      if (error) connectionInsertError = error.message;
    }

    if (finalPaths.length > 0) {
      const { error } = await supabase.from("impact_paths").insert(finalPaths);

      if (error) pathInsertError = error.message;
    }

    if (connectionInsertError || pathInsertError) {
      return jsonResponse(
        {
          generated: false,
          connectionInsertError,
          pathInsertError,
        },
        500
      );
    }

    return jsonResponse({
      generated: true,
      version: "connections-v4-real-input-calibration",
      annual_revenue_used: annualRevenue,
      calibration_found: Boolean(calibrationResult.data),
      deleted_connections: deletedConnections || 0,
      deleted_paths: deletedPaths || 0,
      inserted_connections: finalConnections.length,
      inserted_paths: finalPaths.length,
      calculated_paths: finalPaths.filter(
        (path) => path.calibration_status === "calculated"
      ).length,
      needs_calibration_paths: finalPaths.filter(
        (path) => path.calibration_status === "needs_calibration"
      ).length,
      top_connection_examples: finalConnections.slice(0, 5),
      top_impact_path_examples: finalPaths.slice(0, 5),
    });
  } catch (error) {
    return jsonResponse({ error: String(error) }, 500);
  }
});