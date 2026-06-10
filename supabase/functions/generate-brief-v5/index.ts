import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
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

function severityLabel(severity: string) {
  if (severity === "high") return "HIGH IMPACT";
  if (severity === "medium") return "MEDIUM IMPACT";
  return "WATCHLIST";
}

function compactList(items: string[]) {
  const clean = [...new Set(items.filter(Boolean))].slice(0, 5);
  return clean.length ? clean.join(" · ") : "Not specified";
}

function evidence(items: any) {
  const titles = items.evidence_titles || [];
  const sources = items.evidence_sources || [];

  if (!titles.length) return "Evidence available in source appendix.";

  return titles
    .slice(0, 3)
    .map((title: string, index: number) => `• ${title} — ${sources[index] || "Source"}`)
    .join("\n");
}

function riskBlock(companyName: string, risk: any, annualRevenue: number) {
  const areas = compactList([
    ...(risk.affected_suppliers || []),
    ...(risk.affected_customers || []),
    ...(risk.affected_commodities || []),
    ...(risk.affected_facilities || []),
  ]);

  return `RISK #${risk.risk_rank || "-"} · ${severityLabel(risk.severity)}
${risk.risk_title}

WHY IT MATTERS
${risk.business_impact || risk.executive_summary}

WHAT CHANGED
${risk.what_happened || "Multiple external signals point to this exposure."}

ESTIMATED IMPACT
Exposure: ${money(Number(risk.impact_low || 0))}–${money(Number(risk.impact_high || 0))}
Revenue equivalent: ${pct(Number(risk.impact_high || 0), annualRevenue)}
Margin pressure: up to ${risk.margin_impact_bps || 0} bps
Probability: ${risk.probability || 0}% · Priority score: ${risk.priority_score || 0}/100

EXPOSED AREAS
${areas}

DECISION REQUIRED
${risk.decision_required || risk.action_required}

OWNER AND DEADLINE
${risk.owner || "Unassigned"} · ${datePlusDays(risk.due_days || 14)}

EXPECTED BENEFIT
${risk.expected_benefit || "Reduces exposure if acted on this cycle."}

KEY EVIDENCE
${evidence(risk)}`;
}

function opportunityBlock(opp: any) {
  const areas = compactList([...(opp.affected_customers || []), ...(opp.affected_segments || [])]);

  return `OPPORTUNITY #${opp.opportunity_rank || "-"}
${opp.title}

WHY IT MATTERS
${opp.summary}

WHAT CHANGED
${opp.what_happened || "External signals suggest potential demand creation."}

ESTIMATED UPSIDE
Revenue opportunity: ${money(Number(opp.revenue_low || 0))}–${money(Number(opp.revenue_high || 0))}
Probability: ${opp.probability || 0}% · Priority score: ${opp.priority_score || 0}/100

TARGET AREAS
${areas}

DECISION REQUIRED
${opp.decision_required || opp.action_required}

OWNER AND DEADLINE
${opp.owner || "Commercial"} · ${datePlusDays(opp.due_days || 14)}

EXPECTED BENEFIT
${opp.expected_benefit || "Creates commercial upside if pursued this cycle."}

KEY EVIDENCE
${evidence(opp)}`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { companyId } = await req.json();
    if (!companyId) return jsonResponse({ error: "Missing companyId" }, 400);

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
      assessmentCountResult,
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
      supabase.from("raw_events").select("*", { count: "exact", head: true }).eq("company_id", companyId),
      supabase
        .from("event_assessments")
        .select("*", { count: "exact", head: true })
        .eq("company_id", companyId)
        .eq("relevant", true)
        .or("event_age_days.lte.365,event_age_days.is.null"),
    ]);

    if (companyResult.error) return jsonResponse({ error: companyResult.error.message }, 500);

    const company = companyResult.data;
    const financial = financialResult.data;
    const suppliers = suppliersResult.data || [];
    const customers = customersResult.data || [];
    const commodities = commoditiesResult.data || [];
    const facilities = facilitiesResult.data || [];
    const risks = risksResult.data || [];
    const opportunities = opportunitiesResult.data || [];

    if (!risks.length) {
      return jsonResponse({
        generated: false,
        message: "No ranked risks found. Generate risks first.",
      });
    }

    const annualRevenue = Number(financial?.annual_revenue || financial?.revenue || 0);
    const monitoredCount = rawCountResult.count || 0;
    const relevantCount = assessmentCountResult.count || 0;
    const filteredCount = Math.max(monitoredCount - relevantCount, 0);

    const highCount = risks.filter((risk: any) => risk.severity === "high").length;
    const mediumCount = risks.filter((risk: any) => risk.severity === "medium").length;

    const totalRiskLow = risks.reduce((sum: number, risk: any) => sum + Number(risk.impact_low || 0), 0);
    const totalRiskHigh = risks.reduce((sum: number, risk: any) => sum + Number(risk.impact_high || 0), 0);
    const totalOppLow = opportunities.reduce((sum: number, opp: any) => sum + Number(opp.revenue_low || 0), 0);
    const totalOppHigh = opportunities.reduce((sum: number, opp: any) => sum + Number(opp.revenue_high || 0), 0);

    const primarySuppliers = suppliers.map((item: any) => item.supplier_name).filter(Boolean).slice(0, 4);
    const primaryCustomers = customers.map((item: any) => item.customer_name).filter(Boolean).slice(0, 4);
    const primaryCommodities = commodities.map((item: any) => item.commodity).filter(Boolean).slice(0, 4);
    const primaryFacilities = facilities.map((item: any) => item.facility_name || item.city).filter(Boolean).slice(0, 4);

    const topRisk = risks[0];
    const topOpportunity = opportunities[0];

    const riskBlocks = risks.map((risk: any) => riskBlock(company.name, risk, annualRevenue)).join("\n\n");
    const opportunityBlocks = opportunities.length
      ? opportunities.map((opp: any) => opportunityBlock(opp)).join("\n\n")
      : "No opportunity met the evidence threshold this cycle.";

    const decisions = [
      ...risks.slice(0, 3).map((risk: any, index: number) => `${index + 1}. ${risk.decision_required || risk.action_required} Owner: ${risk.owner}. Deadline: ${datePlusDays(risk.due_days || 14)}.`),
      ...opportunities.slice(0, 1).map((opp: any, index: number) => `${risks.length + index + 1}. ${opp.decision_required || opp.action_required} Owner: ${opp.owner}. Deadline: ${datePlusDays(opp.due_days || 14)}.`),
    ].join("\n");

    const radar = [
      `${primaryCommodities[0] || "Commodity"} movement · Keep monitoring unless price signals move outside current tolerance.`,
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
This week’s priority is ${topRisk.risk_title}. It is ranked #1 because it combines ${topRisk.supporting_event_count || 0} supporting signals, ${topRisk.probability || 0}% probability, and ${money(Number(topRisk.impact_high || 0))} of upper-bound exposure.

Modeled downside across the top risks is ${money(totalRiskLow)}–${money(totalRiskHigh)}. Confirmed upside is ${money(totalOppLow)}–${money(totalOppHigh)}${topOpportunity ? `, led by ${topOpportunity.title}` : ""}. The exposed areas are concentrated in ${compactList([...primaryCommodities, ...primarySuppliers, ...primaryCustomers].slice(0, 6))}.

DECISIONS REQUIRED THIS WEEK
${decisions}

TOP RISKS

${riskBlocks}

TOP OPPORTUNITIES

${opportunityBlocks}

ON OUR RADAR
${radar}

Generated by GroundSense · Report version brief-v7-vp-ready · ${monitoredCount} sources monitored · Next brief: ${datePlusDays(7)}`;

    const title = `External Intelligence Brief · Week of ${new Date().toLocaleDateString("en-US")}`;

    const summary = `${company.name} has ${risks.length} ranked risks requiring action. Top downside exposure is ${money(totalRiskLow)}–${money(totalRiskHigh)}. Top upside is ${money(totalOppLow)}–${money(totalOppHigh)}.`;

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

    if (insertError) return jsonResponse({ error: insertError.message }, 500);

    return jsonResponse({ generated: true, brief: insertedBrief });
  } catch (error) {
    return jsonResponse({ error: String(error) }, 500);
  }
});