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

function money(value: number) {
  if (!Number.isFinite(value)) return "$0";
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

function pct(value: number, total: number) {
  if (!total || !value) return "0.0%";
  return `${((value / total) * 100).toFixed(1)}%`;
}

function datePlusDays(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toLocaleDateString("en-US");
}

function cleanList(items: string[]) {
  return [...new Set(items.filter(Boolean).map((item) => String(item).trim()))];
}

function compactList(items: string[]) {
  const clean = cleanList(items).slice(0, 5);
  return clean.length > 0 ? clean.join(" · ") : "Not specified";
}

function severityLabel(severity: string | null | undefined) {
  if (severity === "high") return "HIGH IMPACT";
  if (severity === "medium") return "MEDIUM IMPACT";
  return "WATCHLIST";
}

function evidence(item: any) {
  const titles = Array.isArray(item.evidence_titles) ? item.evidence_titles : [];
  const sources = Array.isArray(item.evidence_sources) ? item.evidence_sources : [];

  if (titles.length === 0) return "• Evidence available in source appendix.";

  return titles
    .slice(0, 3)
    .map((title: string, index: number) => {
      const source = sources[index] || "Source";
      return `• ${title} — ${source}`;
    })
    .join("\n");
}

function riskAreas(risk: any) {
  return compactList([
    ...(Array.isArray(risk.affected_suppliers) ? risk.affected_suppliers : []),
    ...(Array.isArray(risk.affected_customers) ? risk.affected_customers : []),
    ...(Array.isArray(risk.affected_commodities) ? risk.affected_commodities : []),
    ...(Array.isArray(risk.affected_facilities) ? risk.affected_facilities : []),
  ]);
}

function opportunityAreas(opportunity: any) {
  return compactList([
    ...(Array.isArray(opportunity.affected_customers)
      ? opportunity.affected_customers
      : []),
    ...(Array.isArray(opportunity.affected_segments)
      ? opportunity.affected_segments
      : []),
  ]);
}

function riskBlock(risk: any, annualRevenue: number) {
  const low = Number(risk.impact_low || 0);
  const high = Number(risk.impact_high || 0);

  return `RISK #${risk.risk_rank || "-"} · ${severityLabel(risk.severity)}
${risk.risk_title}

WHY IT MATTERS
${risk.business_impact || risk.executive_summary}

WHAT CHANGED
${risk.what_happened || "External signals point to a change in this exposure."}

ESTIMATED IMPACT
Exposure: ${money(low)}–${money(high)}
Revenue equivalent: ${pct(high, annualRevenue)}
Margin pressure: up to ${risk.margin_impact_bps || 0} bps
Probability: ${risk.probability || 0}% · Priority score: ${risk.priority_score || 0}/100

EXPOSED AREAS
${riskAreas(risk)}

DECISION REQUIRED
${risk.decision_required || risk.action_required}

OWNER AND DEADLINE
${risk.owner || "Unassigned"} · ${datePlusDays(Number(risk.due_days || 14))}

EXPECTED BENEFIT
${risk.expected_benefit || "Reduces exposure if acted on this cycle."}

KEY EVIDENCE
${evidence(risk)}`;
}

function opportunityBlock(opportunity: any) {
  const low = Number(opportunity.revenue_low || 0);
  const high = Number(opportunity.revenue_high || 0);

  return `OPPORTUNITY #${opportunity.opportunity_rank || "-"}
${opportunity.title}

WHY IT MATTERS
${opportunity.summary}

WHAT CHANGED
${opportunity.what_happened || "External signals point to potential demand creation."}

ESTIMATED UPSIDE
Revenue opportunity: ${money(low)}–${money(high)}
Probability: ${opportunity.probability || 0}% · Priority score: ${opportunity.priority_score || 0}/100

TARGET AREAS
${opportunityAreas(opportunity)}

DECISION REQUIRED
${opportunity.decision_required || opportunity.action_required}

OWNER AND DEADLINE
${opportunity.owner || "Commercial"} · ${datePlusDays(Number(opportunity.due_days || 14))}

EXPECTED BENEFIT
${opportunity.expected_benefit || "Creates commercial upside if pursued this cycle."}

KEY EVIDENCE
${evidence(opportunity)}`;
}

function decisionLine(item: any, index: number) {
  return `${index}. ${item.decision_required || item.action_required} Owner: ${
    item.owner || "Unassigned"
  }. Deadline: ${datePlusDays(Number(item.due_days || 14))}.`;
}

function uniqueIdsFromRows(rows: any[]) {
  const ids = new Set<string>();

  for (const row of rows) {
    const sourceIds = Array.isArray(row.source_event_ids) ? row.source_event_ids : [];
    for (const id of sourceIds) {
      if (id) ids.add(id);
    }
  }

  return ids.size;
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

    const [
      companyResult,
      financialResult,
      suppliersResult,
      customersResult,
      commoditiesResult,
      facilitiesResult,
      risksResult,
      opportunitiesResult,
      rawCountResult,
    ] = await Promise.all([
      supabase.from("companies").select("*").eq("id", companyId).single(),
      supabase.from("financial_profile").select("*").eq("company_id", companyId).maybeSingle(),
      supabase.from("supplier_exposure").select("*").eq("company_id", companyId),
      supabase.from("customer_exposure").select("*").eq("company_id", companyId),
      supabase.from("commodity_exposure").select("*").eq("company_id", companyId),
      supabase.from("company_facilities").select("*").eq("company_id", companyId),
      supabase
        .from("risk_register")
        .select("*")
        .eq("company_id", companyId)
        .order("priority_score", { ascending: false })
        .limit(3),
      supabase
        .from("opportunity_register")
        .select("*")
        .eq("company_id", companyId)
        .order("priority_score", { ascending: false })
        .limit(2),
      supabase
        .from("raw_events")
        .select("*", { count: "exact", head: true })
        .eq("company_id", companyId),
    ]);

    if (companyResult.error) {
      return jsonResponse({ error: companyResult.error.message }, 500);
    }

    if (risksResult.error) {
      return jsonResponse({ error: risksResult.error.message }, 500);
    }

    if (opportunitiesResult.error) {
      return jsonResponse({ error: opportunitiesResult.error.message }, 500);
    }

    const company = companyResult.data;
    const financial = financialResult.data;
    const suppliers = suppliersResult.data || [];
    const customers = customersResult.data || [];
    const commodities = commoditiesResult.data || [];
    const facilities = facilitiesResult.data || [];
    const risks = risksResult.data || [];
    const opportunities = opportunitiesResult.data || [];

    if (risks.length === 0) {
      return jsonResponse({
        generated: false,
        message: "No ranked risks found. Generate risks first.",
      });
    }

    const annualRevenue = Number(financial?.annual_revenue || financial?.revenue || 0);
    const monitoredCount = rawCountResult.count || 0;

    const relevantCount = uniqueIdsFromRows([...risks, ...opportunities]);
    const filteredCount = Math.max(monitoredCount - relevantCount, 0);

    const highCount = risks.filter((risk: any) => risk.severity === "high").length;
    const mediumCount = risks.filter((risk: any) => risk.severity === "medium").length;

    const totalRiskLow = risks.reduce(
      (sum: number, risk: any) => sum + Number(risk.impact_low || 0),
      0
    );

    const totalRiskHigh = risks.reduce(
      (sum: number, risk: any) => sum + Number(risk.impact_high || 0),
      0
    );

    const totalOppLow = opportunities.reduce(
      (sum: number, opportunity: any) => sum + Number(opportunity.revenue_low || 0),
      0
    );

    const totalOppHigh = opportunities.reduce(
      (sum: number, opportunity: any) => sum + Number(opportunity.revenue_high || 0),
      0
    );

    const primarySuppliers = suppliers
      .map((item: any) => item.supplier_name)
      .filter(Boolean)
      .slice(0, 4);

    const primaryCustomers = customers
      .map((item: any) => item.customer_name)
      .filter(Boolean)
      .slice(0, 4);

    const primaryCommodities = commodities
      .map((item: any) => item.commodity)
      .filter(Boolean)
      .slice(0, 4);

    const primaryFacilities = facilities
      .map((item: any) => item.facility_name || item.city)
      .filter(Boolean)
      .slice(0, 4);

    const topRisk = risks[0];
    const topOpportunity = opportunities[0];

    const riskBlocks = risks.map((risk: any) => riskBlock(risk, annualRevenue)).join("\n\n");

    const opportunityBlocks =
      opportunities.length > 0
        ? opportunities
            .map((opportunity: any) => opportunityBlock(opportunity))
            .join("\n\n")
        : "No opportunity met the evidence threshold this cycle.";

    const decisions = [
      ...risks.map((risk: any, index: number) => decisionLine(risk, index + 1)),
      ...opportunities
        .slice(0, 1)
        .map((opportunity: any, index: number) =>
          decisionLine(opportunity, risks.length + index + 1)
        ),
    ].join("\n");

    const radar = [
      `${primaryCommodities[0] || "Commodity"} movement · Monitor unless price signals move outside current tolerance.`,
      `${primarySuppliers[0] || "Primary supplier"} exposure · Watch for lead-time, pricing, or availability changes.`,
      `${primaryFacilities[0] || "Primary facility"} operations · Watch for labor, freight, or service-level pressure.`,
    ].join("\n");

    const briefText = `EXTERNAL INTELLIGENCE BRIEF · WEEK OF ${new Date().toLocaleDateString("en-US")}

${company.name}
${company.industry || "Company"} · Revenue base: ${money(annualRevenue)}
Primary exposure: ${compactList(primaryCommodities)}
Key customer segments: ${compactList(primaryCustomers)}

EVENTS MONITORED
${monitoredCount}

REQUIRING ATTENTION
${relevantCount}
${highCount} high · ${mediumCount} medium

NO MATERIAL IMPACT
${filteredCount}

CEO SUMMARY
This week’s top priority is ${topRisk.risk_title}. It is ranked #1 because it combines ${
      topRisk.supporting_event_count || 0
    } supporting signals, ${topRisk.probability || 0}% probability, and ${money(
      Number(topRisk.impact_high || 0)
    )} of upper-bound exposure.

Modeled downside across the top risks is ${money(totalRiskLow)}–${money(
      totalRiskHigh
    )}. Confirmed upside is ${money(totalOppLow)}–${money(totalOppHigh)}${
      topOpportunity ? `, led by ${topOpportunity.title}` : ""
    }. The exposed areas are concentrated in ${compactList(
      [...primaryCommodities, ...primarySuppliers, ...primaryCustomers].slice(0, 6)
    )}.

DECISIONS REQUIRED THIS WEEK
${decisions}

TOP RISKS

${riskBlocks}

TOP OPPORTUNITIES

${opportunityBlocks}

ON OUR RADAR
${radar}

Generated by GroundSense · Report version brief-v8-vp-ready · ${monitoredCount} sources monitored · Next brief: ${datePlusDays(
      7
    )}`;

    const title = `External Intelligence Brief · Week of ${new Date().toLocaleDateString("en-US")}`;

    const summary = `${company.name} has ${risks.length} ranked risks requiring action. Top downside exposure is ${money(
      totalRiskLow
    )}–${money(totalRiskHigh)}. Top upside is ${money(totalOppLow)}–${money(
      totalOppHigh
    )}.`;

    const { data: insertedBrief, error: insertError } = await supabase
      .from("intelligence_briefs")
      .insert({
        company_id: companyId,
        title,
        summary,
        key_risks: riskBlocks,
        opportunities: opportunityBlocks,
        recommended_actions: decisions,
        brief_text: briefText,
        monitored_count: monitoredCount,
        relevant_count: relevantCount,
        filtered_count: filteredCount,
        high_count: highCount,
        medium_count: mediumCount,
        source_count: relevantCount,
      })
      .select()
      .single();

    if (insertError) {
      return jsonResponse({ error: insertError.message }, 500);
    }

    return jsonResponse({
      generated: true,
      version: "brief-v8-vp-ready",
      brief: insertedBrief,
    });
  } catch (error) {
    return jsonResponse({ error: String(error) }, 500);
  }
});