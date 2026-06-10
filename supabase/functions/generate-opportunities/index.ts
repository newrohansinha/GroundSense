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

function normalize(value: string) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean).map((x) => String(x).trim()))];
}

function money(value: number) {
  if (!Number.isFinite(value)) return "$0";
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

function numberField(row: any, keys: string[], fallback = 0) {
  for (const key of keys) {
    const value = Number(row?.[key]);
    if (Number.isFinite(value) && value > 0) return value;
  }

  return fallback;
}

function sourceTier(source: string) {
  const s = normalize(source);

  if (
    s.includes("reuters") ||
    s.includes("wall street journal") ||
    s.includes("wsj") ||
    s.includes("bloomberg") ||
    s.includes("financial times") ||
    s.includes("sec")
  ) {
    return "tier_1";
  }

  if (
    s.includes("manufacturing dive") ||
    s.includes("supply chain dive") ||
    s.includes("freightwaves") ||
    s.includes("modern distribution management") ||
    s.includes("industrial distribution") ||
    s.includes("s p global") ||
    s.includes("fastmarkets") ||
    s.includes("rto insider")
  ) {
    return "tier_2";
  }

  if (
    s.includes("business wire") ||
    s.includes("pr newswire") ||
    s.includes("yahoo finance") ||
    s.includes("law firm") ||
    s.includes("white case") ||
    s.includes("perkins")
  ) {
    return "tier_3";
  }

  if (
    s.includes("ad hoc news") ||
    s.includes("simplywall") ||
    s.includes("moomoo") ||
    s.includes("stock titan") ||
    s.includes("indexbox") ||
    s.includes("travel and tour world")
  ) {
    return "low_quality";
  }

  return "tier_3";
}

function sourceQuality(source: string) {
  const tier = sourceTier(source);

  if (tier === "tier_1") return 92;
  if (tier === "tier_2") return 75;
  if (tier === "tier_3") return 55;
  if (tier === "low_quality") return 25;

  return 50;
}

function textForAssessment(assessment: any) {
  const event = assessment.raw_events || {};

  return normalize(
    `${event.title || ""} ${event.query_text || ""} ${
      assessment.why_it_matters || ""
    } ${
      Array.isArray(assessment.affected_areas)
        ? assessment.affected_areas.join(" ")
        : ""
    }`
  );
}

function clusterForOpportunity(assessment: any) {
  const text = textForAssessment(assessment);

  if (
    (text.includes("utility") || text.includes("utilities")) &&
    (text.includes("award") ||
      text.includes("awarded") ||
      text.includes("maintenance") ||
      text.includes("repair") ||
      text.includes("infrastructure") ||
      text.includes("grid") ||
      text.includes("power plant") ||
      text.includes("rebuild"))
  ) {
    return "utility-maintenance";
  }

  if (
    text.includes("construction") &&
    (text.includes("project") ||
      text.includes("contract") ||
      text.includes("spending") ||
      text.includes("demand"))
  ) {
    return "construction-demand";
  }

  if (
    text.includes("industrial demand") ||
    text.includes("sales growth") ||
    text.includes("resilient demand") ||
    text.includes("strong demand") ||
    text.includes("manufacturing growth")
  ) {
    return "industrial-demand";
  }

  if (
    text.includes("competitor") ||
    text.includes("würth") ||
    text.includes("wuerth") ||
    text.includes("white cap") ||
    text.includes("service gap")
  ) {
    return "account-capture";
  }

  return "";
}

function metaForOpportunity(key: string) {
  const map: Record<
    string,
    {
      title: string;
      owner: string;
      decision: string;
      action: string;
      benefit: string;
    }
  > = {
    "utility-maintenance": {
      title: "Utility Maintenance Demand Opportunity",
      owner: "VP Sales",
      decision:
        "Decide whether utilities should become a priority outbound campaign this cycle.",
      action:
        "Build a target list of utility accounts with MRO, fastener, safety, and industrial-tool needs and launch outreach within 14 days.",
      benefit:
        "Could convert infrastructure repair and maintenance activity into incremental MRO and safety-equipment demand.",
    },
    "construction-demand": {
      title: "Construction Demand Opportunity",
      owner: "VP Sales",
      decision:
        "Decide whether construction account outreach should be accelerated this cycle.",
      action:
        "Prepare fastener, MRO, and safety bundles for construction customers tied to active project demand within 14 days.",
      benefit:
        "Could offset competitive pressure by increasing share of wallet in construction accounts.",
    },
    "industrial-demand": {
      title: "Industrial Demand Growth Opportunity",
      owner: "VP Sales",
      decision:
        "Decide whether manufacturing accounts showing demand resilience should receive added sales focus.",
      action:
        "Prioritize manufacturing accounts with active order growth and prepare cross-sell offers within 14 days.",
      benefit:
        "Could convert industrial demand strength into incremental MRO and fastener sales.",
    },
    "account-capture": {
      title: "Competitor Disruption Account Capture Opportunity",
      owner: "VP Sales",
      decision:
        "Decide whether to pursue customers exposed to competitor disruption or service gaps.",
      action:
        "Identify accounts exposed to competitor service disruption and pitch reliability, inventory availability, and fulfillment speed within 14 days.",
      benefit:
        "Could defend or win accounts where competitors create uncertainty.",
    },
  };

  return map[key] || map["industrial-demand"];
}

function avgQuality(items: any[]) {
  if (items.length === 0) return 50;

  return (
    items.reduce((sum, item) => {
      const eventSource = item.raw_events?.source_name || "";
      const stored = Number(item.source_quality || item.raw_events?.source_quality || 0);
      return sum + (stored > 0 ? stored : sourceQuality(eventSource));
    }, 0) / items.length
  );
}

function getMatches(allNames: string[], affectedAreas: string[]) {
  const joined = normalize(affectedAreas.join(" "));
  return unique(allNames.filter((name) => joined.includes(normalize(name))));
}

function buildEvidenceItems(items: any[]) {
  return items
    .map((item) => {
      const event = item.raw_events || {};
      const source = event.source_name || "Source";
      const computedQuality = sourceQuality(source);
const storedQuality = Number(item.source_quality || event.source_quality || 0);

const quality =
  sourceTier(source) === "low_quality"
    ? Math.min(storedQuality || computedQuality, computedQuality)
    : storedQuality > 0
    ? storedQuality
    : computedQuality;

const rawAge = item.event_age_days ?? event.event_age_days ?? null;

const age =
  rawAge === null || rawAge === undefined || Number(rawAge) >= 9999
    ? null
    : Number(rawAge);

      return {
        title: event.title || "Untitled event",
        source,
        url: event.source_url || null,
        source_quality: quality,
        source_tier: sourceTier(source),
        published_at: event.published_at || null,
        age_days: age,
age_label: age === null ? "Unknown date" : `${age} days`,
      };
    })
    .filter((item) => item.title)
    .sort((a, b) => {
      const tierRank: Record<string, number> = {
        tier_1: 4,
        tier_2: 3,
        tier_3: 2,
        low_quality: 1,
      };

      return (
        (tierRank[b.source_tier] || 0) - (tierRank[a.source_tier] || 0) ||
        b.source_quality - a.source_quality ||
        a.age_days - b.age_days
      );
    })
    .slice(0, 8);
}

function estimateOpportunity({
  key,
  annualRevenue,
  affectedCustomerRevenue,
  supportCount,
  quality,
}: {
  key: string;
  annualRevenue: number;
  affectedCustomerRevenue: number;
  supportCount: number;
  quality: number;
}) {
  const baseExposureType = affectedCustomerRevenue > 0
    ? "affected_customer_revenue"
    : "revenue_proxy";

  const baseExposure = affectedCustomerRevenue || annualRevenue * 0.06;

  let lowRate = 0.004;
  let highRate = 0.014;

  if (key === "utility-maintenance") {
    lowRate = 0.005;
    highRate = 0.018;
  }

  if (key === "construction-demand") {
    lowRate = 0.004;
    highRate = 0.014;
  }

  if (key === "industrial-demand") {
    lowRate = 0.004;
    highRate = 0.012;
  }

  if (key === "account-capture") {
    lowRate = 0.003;
    highRate = 0.01;
  }

  const evidenceMultiplier = Math.min(
    1.15,
    0.95 + Math.min(supportCount, 4) * 0.04
  );

  const qualityMultiplier = quality >= 80 ? 1.08 : quality <= 35 ? 0.72 : 1;

  let low = Math.round(baseExposure * lowRate * evidenceMultiplier * qualityMultiplier);
  let high = Math.round(baseExposure * highRate * evidenceMultiplier * qualityMultiplier);

  const hardCap = Math.round(annualRevenue * 0.006);

  if (high > hardCap) {
    high = hardCap;
    low = Math.round(high * 0.35);
  }

  const methodology = {
    formula:
      "base_exposure * conversion_rate * evidence_multiplier * quality_multiplier",
    base_exposure_type: baseExposureType,
    base_exposure_value: Math.round(baseExposure),
    conversion_rate_low: lowRate,
    conversion_rate_high: highRate,
    supporting_signal_count: supportCount,
    average_source_quality: Math.round(quality),
    evidence_multiplier: Number(evidenceMultiplier.toFixed(2)),
    quality_multiplier: Number(qualityMultiplier.toFixed(2)),
    final_low: low,
    final_high: high,
    hard_cap_applied: high === hardCap,
  };

  return { low, high, methodology };
}

function buildExposurePath({
  opportunityTitle,
  affectedCustomers,
  affectedSegments,
  revenueHigh,
}: {
  opportunityTitle: string;
  affectedCustomers: string[];
  affectedSegments: string[];
  revenueHigh: number;
}) {
  const path = [opportunityTitle];

  if (affectedCustomers.length) path.push(affectedCustomers[0]);
  if (affectedSegments.length) path.push(affectedSegments[0]);

  path.push(`${money(revenueHigh)} modeled upside`);

  return path;
}

function makeWhatHappened(items: any[]) {
  return unique(items.map((item) => item.raw_events?.title).filter(Boolean))
    .slice(0, 3)
    .join(" ");
}

function addDays(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
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

    const [financialResult, customersResult, assessmentsResult] =
      await Promise.all([
        supabase
          .from("financial_profile")
          .select("*")
          .eq("company_id", companyId)
          .maybeSingle(),

        supabase
          .from("customer_exposure")
          .select("*")
          .eq("company_id", companyId),

        supabase
          .from("event_assessments")
          .select(
            `
            *,
            raw_events (
              id,
              title,
              source_name,
              source_url,
              query_text,
              published_at,
              event_age_days,
              source_quality
            )
          `
          )
          .eq("company_id", companyId)
          .eq("relevant", true)
          .or("event_age_days.lte.365,event_age_days.is.null")
          .order("strategic_score", { ascending: false })
          .limit(120),
      ]);

    if (assessmentsResult.error) {
      return jsonResponse({ error: assessmentsResult.error.message }, 500);
    }

    const annualRevenue = numberField(
      financialResult.data,
      ["annual_revenue", "revenue"],
      0
    );

    const customers = customersResult.data || [];
    const assessments = assessmentsResult.data || [];

    const customerNames = customers
      .map((customer: any) => customer.customer_name)
      .filter(Boolean);

    const customerRevenueByName = new Map<string, number>();

    for (const customer of customers) {
      const name = customer.customer_name;

      const directRevenue = numberField(
        customer,
        ["annual_revenue_estimate", "revenue_estimate"],
        0
      );

      const share = numberField(
        customer,
        ["revenue_share_pct", "share_pct", "percent_revenue"],
        0
      );

      const revenue =
        directRevenue || (share > 0 ? annualRevenue * (share / 100) : 0);

      if (name && revenue) {
        customerRevenueByName.set(name, revenue);
      }
    }

    const grouped: Record<string, any[]> = {};

    for (const assessment of assessments) {
      const key = clusterForOpportunity(assessment);

      if (!key) continue;

      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(assessment);
    }

    const { count: deletedOpportunities } = await supabase
      .from("opportunity_register")
      .delete({ count: "exact" })
      .eq("company_id", companyId);

    await supabase
      .from("risk_actions")
      .delete()
      .eq("company_id", companyId)
      .eq("source_type", "opportunity");

    const drafts = Object.entries(grouped)
      .map(([key, items]) => {
        const meta = metaForOpportunity(key);
        const quality = avgQuality(items);

        const avgConfidence =
          items.reduce((sum, item) => sum + Number(item.confidence || 0), 0) /
          items.length;

        const avgStrategic =
          items.reduce((sum, item) => sum + Number(item.strategic_score || 50), 0) /
          items.length;

        const affectedAreas = items.flatMap((item) =>
          Array.isArray(item.affected_areas) ? item.affected_areas : []
        );

        const affectedCustomers = getMatches(customerNames, affectedAreas);

        if (
          key === "utility-maintenance" &&
          !affectedCustomers.includes("Utilities Customers")
        ) {
          affectedCustomers.push("Utilities Customers");
        }

        if (
          key === "construction-demand" &&
          !affectedCustomers.includes("Construction Customers")
        ) {
          affectedCustomers.push("Construction Customers");
        }

        if (
          key === "industrial-demand" &&
          !affectedCustomers.includes("Manufacturing Customers")
        ) {
          affectedCustomers.push("Manufacturing Customers");
        }

        const affectedCustomerRevenue = affectedCustomers.reduce(
          (sum, name) => sum + (customerRevenueByName.get(name) || 0),
          0
        );

        const revenue = estimateOpportunity({
          key,
          annualRevenue,
          affectedCustomerRevenue,
          supportCount: items.length,
          quality,
        });

        const probability = clamp(
          Math.round(
            avgConfidence * 100 + Math.min(items.length, 4) * 1.2 + quality / 25
          ),
          45,
          82
        );

        const priorityScore = clamp(
          Math.round(
            probability * 0.3 +
              avgStrategic * 0.25 +
              Math.min((revenue.high / Math.max(annualRevenue, 1)) * 10000, 100) *
                0.25 +
              quality * 0.2
          ),
          0,
          100
        );

        const evidenceItems = buildEvidenceItems(items);
        const evidenceTitles = evidenceItems.map((item) => item.title);
        const evidenceSources = evidenceItems.map((item) => item.source);
        const evidenceUrls = evidenceItems.map((item) => item.url).filter(Boolean);

        const affectedSegments = unique(affectedAreas).slice(0, 6);

        const exposurePath = buildExposurePath({
          opportunityTitle: meta.title,
          affectedCustomers,
          affectedSegments,
          revenueHigh: revenue.high,
        });

        return {
          company_id: companyId,
          title: meta.title,
          summary: `${meta.title}. ${items.length} signal${
            items.length === 1 ? "" : "s"
          }. ${money(revenue.low)}–${money(revenue.high)} modeled upside. ${probability}% probability.`,
          probability,
          revenue_low: revenue.low,
          revenue_high: revenue.high,
          confidence: Math.round(avgConfidence * 100),
          owner: meta.owner,
          action_required: meta.action,
          due_days: 14,
          affected_customers: affectedCustomers,
          affected_products: [],
          affected_segments: affectedSegments,
          source_event_ids: items.map((item) => item.raw_event_id).filter(Boolean),
          supporting_event_count: items.length,
          priority_score: priorityScore,
          what_happened: makeWhatHappened(items),
          why_now: `${items.length} signal${
            items.length === 1 ? "" : "s"
          } support action this cycle.`,
          evidence_titles: evidenceTitles,
          evidence_sources: evidenceSources,
          evidence_urls: evidenceUrls,
          evidence_quality_score: Math.round(quality),
          evidence_items: evidenceItems,
          methodology: revenue.methodology,
          exposure_path: exposurePath,
          decision_required: meta.decision,
          expected_benefit: meta.benefit,
          _priority: priorityScore,
        };
      })
      .filter(
        (draft: any) =>
          draft.supporting_event_count >= 2 && draft.revenue_high > 0
      )
      .sort((a: any, b: any) => b._priority - a._priority)
      .slice(0, 2);

    if (drafts.length === 0) {
      return jsonResponse({
        inserted: 0,
        deleted_old: deletedOpportunities || 0,
        assessments_checked: assessments.length,
        message: "No opportunity met the evidence threshold.",
      });
    }

    const opportunitiesToInsert = drafts.map((draft: any, index: number) => {
      const { _priority, ...cleanDraft } = draft;

      return {
        ...cleanDraft,
        opportunity_rank: index + 1,
      };
    });

    const { data: insertedOpportunities, error: insertError } = await supabase
      .from("opportunity_register")
      .insert(opportunitiesToInsert)
      .select();

    if (insertError) {
      return jsonResponse({ error: insertError.message }, 500);
    }

    const snapshotRows = (insertedOpportunities || []).map((opportunity: any) => ({
      company_id: companyId,
      opportunity_id: opportunity.id,
      opportunity_title: opportunity.title,
      priority_score: opportunity.priority_score,
      probability: opportunity.probability,
      revenue_low: opportunity.revenue_low,
      revenue_high: opportunity.revenue_high,
      snapshot_week: new Date().toISOString().slice(0, 10),
    }));

    if (snapshotRows.length > 0) {
      await supabase.from("opportunity_snapshots").insert(snapshotRows);
    }

    const actionRows = (insertedOpportunities || []).map((opportunity: any) => ({
      company_id: companyId,
      opportunity_id: opportunity.id,
      title: opportunity.decision_required || opportunity.action_required,
      owner: opportunity.owner,
      deadline: addDays(Number(opportunity.due_days || 14)),
      expected_benefit: opportunity.expected_benefit,
      status: "open",
      source_type: "opportunity",
    }));

    if (actionRows.length > 0) {
      await supabase.from("risk_actions").insert(actionRows);
    }

    return jsonResponse({
      inserted: insertedOpportunities?.length || 0,
      deleted_old: deletedOpportunities || 0,
      opportunities: insertedOpportunities,
    });
  } catch (error) {
    return jsonResponse({ error: String(error) }, 500);
  }
});