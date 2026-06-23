// generate-numeric-candidates — Phase 5/6/7/8 candidate engine.
//
// Replaces article-summary clustering. Candidates START from the numeric_shocks
// ledger (official structured metrics + normalized article claims), are mapped to
// real company exposure via driver-specific templates, get a formula + dollar
// impact + owner action, and are routed by a quality gate into
// published / watch / review / block. Stale generated rows + their actions are
// cleaned so dashboard/brief/actions counts stay consistent.
//
// Writes: risk_register (numeric_basis_*, gate_status, exposure_path, methodology),
// risk_actions (published only), issue_quality_gate_results (every candidate).

// deno-lint-ignore-file no-explicit-any
import { createClient } from "jsr:@supabase/supabase-js@2";
import { recomputeProvenanceAndCoverage } from "../_shared/provenance.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(b: unknown, s = 200) { return new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } }); }

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = () => createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

function money(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}
function sev(d: number): string { const a = Math.abs(d); return a >= 500_000 ? "high" : a >= 100_000 ? "medium" : "low"; }
function probFromFresh(f: string | null, pct: number): number {
  const base = f === "fresh" ? 75 : f === "latest_official" ? 70 : f === "acceptable_lag" ? 62 : 55;
  return Math.min(90, base + Math.min(10, Math.round(Math.abs(pct))));
}
// Deterministic priority for a PUBLISHED, metric-backed issue. Never 0 for a
// real published issue (impact + official source + formula + action all score).
function priorityScore(input: { dollar: number; confidence: number; freshness: string | null; official: boolean; hasFormula: boolean; hasAction: boolean }): number {
  const a = Math.abs(input.dollar);
  const impact = a >= 1_000_000 ? 35 : a >= 500_000 ? 30 : a >= 250_000 ? 25 : a >= 100_000 ? 20 : a >= 50_000 ? 15 : a > 0 ? 10 : 4;
  const conf = Math.round(Math.max(0, Math.min(20, (input.confidence / 100) * 20)));
  const urgency = input.freshness === "fresh" ? 15 : input.freshness === "latest_official" ? 11 : input.freshness === "acceptable_lag" ? 7 : 4;
  const sourceQ = input.official ? 15 : 8;
  const action = input.hasFormula && input.hasAction ? 15 : input.hasFormula ? 10 : input.hasAction ? 7 : 3;
  return Math.max(1, Math.min(100, impact + conf + urgency + sourceQ + action));
}

type Shock = any;
type Candidate = {
  issue_key: string;
  risk_title: string;
  risk_type: string;
  driver_category: string;
  decision: "published" | "watch" | "review" | "block";
  issue_category: string;          // risk | operating_change | watchlist
  issue_direction: string;
  display_section: string;          // risk_register | operating_changes | watchlist
  dollar: number;
  probability: number;
  confidence: number;
  severity: string;
  owner: string;
  action_required: string;
  what_happened: string;
  why_now: string;
  business_impact: string;
  exposure_interpretation: string;
  formula_text: string;
  formula_inputs: Record<string, unknown>;
  exposure_path: any[];
  numeric_basis_type: string;       // official_structured_metric | article_numeric_claim | no_numeric_basis
  numeric_basis_value: number | null;
  numeric_basis_unit: string | null;
  numeric_basis_snippet: string | null;
  numeric_basis_source_url: string | null;
  numeric_basis_source_label: string | null;
  affected_commodities: string[];
  affected_suppliers: string[];
  affected_customers: string[];
  source_shock_id: string | null;
  source_observation_id: string | null;
  freshness_level: string | null;
  missing: string[];
  reasons: string[];
  required_to_promote: string[];
};

function num(v: any): number { const n = Number(v); return Number.isFinite(n) ? n : 0; }

// ── Exposure bundle ─────────────────────────────────────────────────────────
async function loadExposure(db: any, companyId: string) {
  const [commodity, logistics, lanes, suppliers, segments, financial, calib] = await Promise.all([
    db.from("company_commodity_exposure").select("*").eq("company_id", companyId),
    db.from("company_logistics_exposure").select("*").eq("company_id", companyId),
    db.from("freight_lane_exposure").select("*").eq("company_id", companyId),
    db.from("supplier_procurement_exposure").select("*").eq("company_id", companyId),
    db.from("company_segment_exposure").select("*").eq("company_id", companyId),
    db.from("financial_anchors").select("*").eq("company_id", companyId).order("created_at", { ascending: false }),
    db.from("company_calibration").select("*").eq("company_id", companyId).maybeSingle(),
  ]);
  return {
    commodity: commodity.data ?? [],
    logistics: (logistics.data ?? [])[0] ?? null,
    lanes: lanes.data ?? [],
    suppliers: suppliers.data ?? [],
    segments: segments.data ?? [],
    financial: (financial.data ?? [])[0] ?? null,
    calib: calib.data ?? null,
  };
}

// ── Templates ───────────────────────────────────────────────────────────────
function basisFromShock(s: Shock, type = "official_structured_metric"): Partial<Candidate> {
  return {
    numeric_basis_type: type,
    numeric_basis_value: s.numeric_value,
    numeric_basis_unit: s.numeric_unit ?? "pct",
    numeric_basis_snippet: s.snippet ?? s.claim_text ?? null,
    numeric_basis_source_url: s.source_url ?? null,
    numeric_basis_source_label: `${s.source_name}${s.source_period ? " · " + s.source_period : ""}`,
    source_shock_id: s.id ?? null,
    source_observation_id: s.source_observation_id ?? null,
    freshness_level: s.freshness_level ?? null,
  };
}

function metalsCandidate(commodity: string, shock: Shock | null, exp: any, suppliers: any[]): Candidate | null {
  const key = `ns_${commodity.toLowerCase()}_cost`;
  const supplierNames = suppliers.filter((s) => (s.commodity || "").toLowerCase() === commodity.toLowerCase()).map((s) => s.supplier_name);
  if (!shock) {
    if (!exp) return null;
    return watch(key, `${commodity}-linked supplier spend — awaiting external price metric`,
      "commodity_cost", "metals", `No fresh official ${commodity} price metric this run. Company has ${money(num(exp.annual_spend))} ${commodity} spend exposed.`,
      ["external_price_metric"], [commodity], supplierNames);
  }
  if (!exp) {
    return watch(key, `${commodity} PPI ${fmtPct(shock.percent_change)} — ${commodity.toLowerCase()}-linked spend needs calibration`,
      "commodity_cost", "metals",
      `${commodity} PPI ${fmtPct(shock.percent_change)} detected, but ${commodity.toLowerCase()}-linked spend needs calibration before modeling dollar impact.`,
      ["company_commodity_exposure"], [commodity], supplierNames, shock);
  }
  const spend = num(exp.annual_spend);
  const unpassed = Math.max(0, 1 - num(exp.pass_through_pct) / 100);
  const pct = num(shock.percent_change);
  const dollar = spend * unpassed * (pct / 100);
  const adverse = pct > 0;
  const dir = adverse ? "downside" : "favorable";
  const cat = adverse ? "risk" : "operating_change";
  const section = adverse ? "risk_register" : "operating_changes";
  const formula = `${commodity} spend ${money(spend)} × unpassed ${(unpassed * 100).toFixed(0)}% × ${fmtPct(pct)} = ${money(dollar)}`;
  return {
    issue_key: key,
    risk_title: `${commodity} PPI ${fmtPct(pct)} → ${commodity.toLowerCase()}-linked supplier spend ${adverse ? "exposure" : "relief"}`,
    risk_type: "commodity_cost", driver_category: "metals",
    decision: "published", issue_category: cat, issue_direction: dir, display_section: section,
    dollar: Math.abs(dollar), probability: probFromFresh(shock.freshness_level, pct),
    confidence: Math.round(num(shock.confidence) * 100) || 90, severity: sev(dollar),
    owner: "Head of Procurement",
    action_required: `Pull top ${commodity}-linked supplier spend by SKU, country of origin, HTS code, supplier price update, and pass-through status; confirm the ${(unpassed * 100).toFixed(0)}% unpassed share against current contracts.`,
    what_happened: `${shock.metric_name} ${fmtPct(pct)} (${shock.source_name}, ${shock.source_period}).`,
    why_now: `A verified ${commodity} producer-price move maps directly to ${money(spend)} of ${commodity} spend with ${num(exp.pass_through_pct)}% contractual pass-through — leaving ${money(spend * unpassed)} exposed before repricing.`,
    formula_inputs: { commodity_spend: spend, pass_through_pct: num(exp.pass_through_pct), unpassed_share: unpassed, percent_change: pct, result: Math.round(dollar), source_shock_id: shock.id },
    business_impact: `${adverse ? "Incremental cost pressure" : "Cost relief"} of ~${money(dollar)} on the unpassed share of ${commodity} spend at the observed price move.`,
    exposure_interpretation: adverse
      ? `${commodity} input cost is rising; the unpassed share is live margin exposure until suppliers/POs reprice.`
      : `${commodity} input cost fell; this is favorable versus prior, tracked as an operating change.`,
    formula_text: formula,
    exposure_path: [
      { step: "External change", detail: `${shock.metric_name} ${fmtPct(pct)} (${shock.source_name}, ${shock.source_period})` },
      { step: "Operating path", detail: `${commodity}-linked suppliers${supplierNames.length ? ": " + supplierNames.join(", ") : ""}` },
      { step: "Financial driver", detail: `${commodity} spend ${money(spend)} × unpassed ${(unpassed * 100).toFixed(0)}%` },
      { step: "Dollar exposure", detail: money(dollar) },
      { step: "Action", detail: "Validate supplier price updates & pass-through" },
    ],
    affected_commodities: [commodity], affected_suppliers: supplierNames, affected_customers: [],
    missing: [], reasons: [`official ${commodity} metric`, "company exposure mapped", "formula complete"],
    required_to_promote: [],
    ...(basisFromShock(shock) as any),
  };
}

function freightCandidate(freightShocks: Shock[], exp: any, lanes: any[]): Candidate | null {
  const key = "ns_freight_cost";
  // ONE freight issue only. The largest freight PPI move is the primary driver of
  // the dollar estimate; every other freight shock (e.g. Truck transportation,
  // Freight transportation arrangement) is carried as a SUPPORTING/corroborating
  // signal — never a second freight issue and never separately counted in dollars.
  const sorted = [...freightShocks].sort((a, b) => Math.abs(num(b.percent_change)) - Math.abs(num(a.percent_change)));
  const shock = sorted[0] ?? null;
  const supporting = sorted.slice(1);
  const supportingText = supporting.map((s) => `${s.metric_name} ${fmtPct(s.percent_change)}`).join("; ");
  const spotLanes = lanes.filter((l) => l.spot_or_contract === "spot" || l.surcharge_exposed);
  const laneNames = spotLanes.map((l) => l.lane_name);
  if (!shock) {
    if (!exp) return null;
    return watch(key, "Spot-exposed freight lanes — awaiting external freight metric", "freight_logistics", "freight",
      `No fresh freight PPI this run. ${money(num(exp.annual_freight_spend))} freight spend, ${num(exp.spot_rate_exposure_pct)}% spot-exposed.`,
      ["external_freight_metric"], [], laneNames);
  }
  if (!exp) return watch(key, `Freight PPI ${fmtPct(shock.percent_change)} — no freight exposure mapped`, "freight_logistics", "freight",
    `Freight PPI moved but no freight spend calibrated.`, ["company_logistics_exposure"], [], laneNames, shock);
  const spend = num(exp.annual_freight_spend);
  const spot = num(exp.spot_rate_exposure_pct) / 100;
  const pct = num(shock.percent_change);
  const dollar = spend * spot * (pct / 100);
  const adverse = pct > 0;
  const formula = `freight spend ${money(spend)} × spot ${(spot * 100).toFixed(0)}% × ${fmtPct(pct)} = ${money(dollar)}`;
  return {
    issue_key: key,
    risk_title: `Freight PPI ${fmtPct(pct)} → spot-lane surcharge ${adverse ? "exposure" : "relief"}`,
    risk_type: "freight_logistics", driver_category: "freight",
    decision: "published", issue_category: adverse ? "risk" : "operating_change",
    issue_direction: adverse ? "downside" : "favorable", display_section: adverse ? "risk_register" : "operating_changes",
    dollar: Math.abs(dollar), probability: probFromFresh(shock.freshness_level, pct),
    confidence: Math.round(num(shock.confidence) * 100) || 90, severity: sev(dollar),
    owner: "Head of Logistics",
    action_required: `Pull top spot-exposed lanes, current surcharge terms, carrier contract coverage, and repricing dates${laneNames.length ? ` (priority: ${laneNames.slice(0, 3).join(", ")})` : ""}.`,
    what_happened: `${shock.metric_name} ${fmtPct(pct)} (${shock.source_name}, ${shock.source_period}).${supportingText ? ` Corroborating freight signals: ${supportingText}.` : ""}`,
    why_now: `A verified freight producer-price move hits the ${(spot * 100).toFixed(0)}% spot-exposed share of ${money(spend)} freight spend before contracts reset.${supportingText ? ` ${supporting.length} other freight PPI series move the same direction (${supportingText}) — corroborating, not separately counted.` : ""}`,
    formula_inputs: { freight_spend: spend, spot_exposure_pct: num(exp.spot_rate_exposure_pct), percent_change: pct, result: Math.round(dollar), source_shock_id: shock.id,
      supporting_signals: supporting.map((s) => ({ metric: s.metric_name, metric_id: s.metric_id, percent_change: num(s.percent_change), role: "supporting_not_counted" })) },
    business_impact: `${adverse ? "Incremental freight cost" : "Freight cost relief"} of ~${money(dollar)} on spot-exposed lanes (single freight exposure base; corroborating freight PPI series are not double-counted).`,
    exposure_interpretation: adverse ? "Spot-exposed freight cost is rising; validate surcharge terms before they flow through." : "Freight cost relief on spot lanes; tracked as an operating change.",
    formula_text: formula,
    exposure_path: [
      { step: "External change", detail: `${shock.metric_name} ${fmtPct(pct)} (${shock.source_name}, ${shock.source_period})` },
      ...(supportingText ? [{ step: "Supporting signals", detail: `${supportingText} — corroborating freight PPI, not separately counted` }] : []),
      { step: "Operating path", detail: `Spot-exposed lanes${laneNames.length ? ": " + laneNames.slice(0, 3).join(", ") : ""}` },
      { step: "Financial driver", detail: `Freight spend ${money(spend)} × spot ${(spot * 100).toFixed(0)}%` },
      { step: "Dollar exposure", detail: money(dollar) },
      { step: "Action", detail: "Validate surcharge terms & contract coverage" },
    ],
    affected_commodities: [], affected_suppliers: [], affected_customers: [],
    missing: [], reasons: ["official freight metric", "company exposure mapped", "formula complete", ...(supporting.length ? [`${supporting.length} corroborating freight signal(s)`] : [])], required_to_promote: [],
    ...(basisFromShock(shock) as any),
  };
}

function fuelCandidate(shock: Shock | null, exp: any, lanes: any[]): Candidate | null {
  const key = "ns_fuel_cost";
  if (!shock || !exp) return null;
  const fuelLanes = lanes.filter((l) => (l.surcharge_type || "").toLowerCase().includes("fuel") || l.spot_or_contract === "spot" || l.surcharge_exposed);
  const fuelExposedSpend = fuelLanes.reduce((a, l) => a + num(l.annual_spend), 0) || num(exp.annual_freight_spend) * (num(exp.spot_rate_exposure_pct) / 100);
  const pct = num(shock.percent_change);
  const dollar = fuelExposedSpend * Math.abs(pct / 100);
  const adverse = pct > 0;
  const formula = `fuel-exposed freight ${money(fuelExposedSpend)} × ${fmtPct(Math.abs(pct))} = ${money(dollar)}`;
  const fuelLabel = shock.commodity ?? "Diesel";
  return {
    issue_key: key,
    risk_title: `${fuelLabel} ${fmtPct(pct)} → fuel-surcharge ${adverse ? "exposure" : "relief"}`,
    risk_type: "fuel_energy", driver_category: "fuel",
    decision: "published", issue_category: adverse ? "risk" : "operating_change",
    issue_direction: adverse ? "downside" : "favorable", display_section: adverse ? "risk_register" : "operating_changes",
    dollar, probability: probFromFresh(shock.freshness_level, pct),
    confidence: Math.round(num(shock.confidence) * 100) || 90, severity: sev(dollar),
    owner: "Head of Logistics",
    action_required: `Review carrier fuel-surcharge tables and fuel clauses on fuel-sensitive lanes; ${adverse ? "confirm surcharge pass-through caps" : "capture relief on spot-priced lanes before carriers reset surcharges"}.`,
    what_happened: `${shock.metric_name} ${fmtPct(pct)} (${shock.source_name}, ${shock.source_period}).`,
    why_now: `Diesel is a direct fuel-surcharge driver on ${money(fuelExposedSpend)} of fuel-/spot-exposed freight.`,
    formula_inputs: { fuel_exposed_freight: fuelExposedSpend, percent_change: pct, abs_percent_change: Math.abs(pct), result: Math.round(dollar), source_shock_id: shock.id },
    business_impact: `${adverse ? "Added fuel-surcharge cost" : "Fuel-surcharge relief"} of ~${money(dollar)}.`,
    exposure_interpretation: adverse ? "Diesel up → surcharge cost pressure." : "Diesel down → fuel-surcharge relief; operating change, not downside.",
    formula_text: formula,
    exposure_path: [
      { step: "External change", detail: `${shock.metric_name} ${fmtPct(pct)} (${shock.source_name}, ${shock.source_period})` },
      { step: "Operating path", detail: "Fuel-sensitive / spot freight lanes" },
      { step: "Financial driver", detail: `Fuel-exposed freight ${money(fuelExposedSpend)}` },
      { step: "Dollar exposure", detail: money(dollar) },
      { step: "Action", detail: "Review carrier fuel-surcharge clauses" },
    ],
    affected_commodities: ["Diesel"], affected_suppliers: [], affected_customers: [],
    missing: [], reasons: ["official fuel metric", "freight exposure mapped", "formula complete"], required_to_promote: [],
    ...(basisFromShock(shock) as any),
  };
}

function fmtPct(p: number): string { const n = Number(p) || 0; return `${n > 0 ? "+" : ""}${n}%`; }

// Generic watch builder (no dollar; needs upgrade trigger).
function watch(key: string, title: string, riskType: string, driverCat: string, why: string,
  required: string[], commodities: string[], suppliers: string[], shock?: Shock): Candidate {
  const basis = shock ? basisFromShock(shock) : { numeric_basis_type: "no_numeric_basis", numeric_basis_value: null, numeric_basis_unit: null, numeric_basis_snippet: null, numeric_basis_source_url: null, numeric_basis_source_label: null, source_shock_id: null, source_observation_id: null, freshness_level: null };
  return {
    issue_key: key, risk_title: title, risk_type: riskType, driver_category: driverCat,
    decision: "watch", issue_category: "watchlist", issue_direction: "uncertain", display_section: "watchlist",
    dollar: 0, probability: 40, confidence: shock ? Math.round(num(shock.confidence) * 100) || 60 : 40, severity: "low",
    owner: "Executive Owner",
    action_required: `Provide: ${required.join(", ")} to promote this to a quantified, published exposure.`,
    what_happened: why, why_now: why,
    business_impact: "Not quantified — missing inputs listed below.",
    exposure_interpretation: "Relevant signal without a complete numeric + company-exposure basis. Held on the watchlist with an explicit upgrade trigger.",
    formula_text: "", formula_inputs: {}, exposure_path: [],
    affected_commodities: commodities, affected_suppliers: suppliers, affected_customers: [],
    missing: required, reasons: ["incomplete basis"], required_to_promote: required,
    ...(basis as any),
  } as Candidate;
}

// ── Article claims → ledger + corroboration (P3/P4) ─────────────────────────
function driverCatForClaim(driver: string, commodity: string): string {
  const d = `${driver} ${commodity}`.toLowerCase();
  if (/freight|logistic|truck/.test(d)) return "freight";
  if (/diesel|fuel|energy/.test(d)) return "fuel";
  if (/tariff|duty/.test(d)) return "tariff";
  if (/steel|copper|aluminum|metal/.test(d)) return "metals";
  if (/demand|industrial|manufactur|construction|order/.test(d)) return "demand";
  if (/import|export|trade/.test(d)) return "trade_flow";
  return "context";
}
async function normalizeArticleClaims(db: any, companyId: string, officialShocks: Shock[], runId: string | null) {
  const { data: claims } = await db.from("article_metric_claims").select("*").eq("company_id", companyId).order("created_at", { ascending: false }).limit(80);
  const rows: any[] = [];
  let corroborated = 0;
  for (const c of (claims ?? [])) {
    const val = c.delta_pp ?? c.extracted_value;
    if (val == null) continue;
    const cat = driverCatForClaim(c.driver || c.metric_key || "", c.commodity || "");
    const dir = c.direction || (num(val) > 0 ? "up" : num(val) < 0 ? "down" : "unknown");
    // Corroboration vs official shocks on same category + direction.
    const match = officialShocks.find((s) => s.driver_category === cat && s.direction === dir && s.can_publish);
    let corro = "uncorroborated";
    if (match) {
      const gap = Math.abs(num(match.percent_change) - num(val));
      corro = gap <= Math.max(2, Math.abs(num(val)) * 0.5) ? "corroborated" : "directionally_supported";
      if (corro === "corroborated") corroborated++;
    }
    const contradict = officialShocks.find((s) => s.driver_category === cat && s.direction && dir !== "unknown" && s.direction !== dir && s.can_publish);
    if (!match && contradict) corro = "contradicted";
    rows.push({
      company_id: companyId, source_type: "article_numeric_claim",
      source_name: c.source_domain || "article", source_tier: 3, source_trust: "article",
      source_url: c.source_url, source_domain: c.source_domain, source_period: c.period_text,
      driver: c.driver || c.metric_key, driver_category: cat, commodity: c.commodity, geography: c.geography, entity: c.entity,
      metric_name: c.metric_key || c.claim_type || "article claim", metric_id: null,
      claim_text: c.claim_text, snippet: c.claim_text,
      numeric_value: num(val), numeric_unit: c.extracted_unit || (c.delta_pp != null ? "pp" : "pct"),
      percent_change: c.delta_pp == null ? num(c.extracted_value) : null, percentage_point_change: c.delta_pp ?? null,
      change_type: c.delta_pp != null ? "percentage_point_change" : "percent_change", direction: dir,
      freshness_level: "fresh", confidence: 0.6, extraction_method: "article_body_llm",
      corroboration_status: corro, can_publish: false,
      cannot_publish_reason: "article_claim_routes_to_watch_unless_corroborated_and_mapped",
      company_mapping_status: "context_only",
      shock_key: `article:${c.id}`, run_summary_id: runId, article_claim_id: c.id, raw_event_id: c.raw_event_id,
      raw_source_payload: { article_title: c.article_title },
    });
  }
  if (rows.length > 0) {
    // Replace this company's article shocks, then insert fresh.
    await db.from("numeric_shocks").delete().eq("company_id", companyId).eq("source_type", "article_numeric_claim");
    await db.from("numeric_shocks").insert(rows);
  }
  return { article_shocks: rows.length, corroborated };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  let body: any = {}; try { body = await req.json(); } catch { /* */ }
  const companyId: string = body.companyId || body.company_id;
  const runId: string | null = body.runSummaryId ?? null;
  if (!companyId) return json({ error: "companyId required" }, 400);

  const db = admin();

  // 1. Load official shocks (global) + exposure.
  const { data: official } = await db.from("numeric_shocks").select("*")
    .eq("source_type", "official_structured_metric").order("created_at", { ascending: false });
  const officialShocks: Shock[] = official ?? [];
  const exp = await loadExposure(db, companyId);

  // 2. Article claims → ledger + corroboration.
  const articleStats = await normalizeArticleClaims(db, companyId, officialShocks, runId);

  // 3. Build candidates via driver templates.
  const candidates: Candidate[] = [];
  // Only price-pressure metals shocks (exclude trade-flow / volume shocks) and
  // only publishable ones can drive the metals price candidate.
  const pubMetals = officialShocks.filter((s) => s.driver_category === "metals" && s.source_type === "official_structured_metric"
    && s.can_publish && /price/i.test(s.driver || "") && s.change_type !== "volume_change");
  for (const commodity of ["Steel", "Copper", "Aluminum"]) {
    const expRow = exp.commodity.find((c: any) => (c.commodity || "").toLowerCase() === commodity.toLowerCase()) ?? null;
    const matches = pubMetals.filter((s) => (s.commodity || "").toLowerCase().includes(commodity.toLowerCase()) || (s.metric_name || "").toLowerCase().includes(commodity.toLowerCase()));
    const rep = matches.find((s) => /iron and steel|copper wire|aluminum mill/i.test(s.metric_name)) ?? matches.sort((a, b) => Math.abs(num(b.percent_change)) - Math.abs(num(a.percent_change)))[0] ?? null;
    const c = metalsCandidate(commodity, rep, expRow, exp.suppliers);
    if (c) candidates.push(c);
  }
  // Pass ALL publishable freight shocks; the template keeps the largest as the
  // primary driver and folds the rest (e.g. Truck transportation +3.8%) in as
  // supporting signals so there is never a second freight issue.
  const freightShocks = officialShocks.filter((s) => s.driver_category === "freight" && s.can_publish);
  const cf = freightCandidate(freightShocks, exp.logistics, exp.lanes); if (cf) candidates.push(cf);
  // Fuel-surcharge exposure is driven by DIESEL specifically (crude WTI is context),
  // so prefer the diesel shock over any larger crude move — title must match source.
  const fuelShocks = officialShocks.filter((s) => s.driver_category === "fuel" && s.can_publish);
  const fuelShock = fuelShocks.find((s) => /diesel/i.test(s.metric_name) || /DIESEL/i.test(s.metric_id ?? ""))
    ?? fuelShocks.sort((a, b) => Math.abs(num(b.percent_change)) - Math.abs(num(a.percent_change)))[0] ?? null;
  const cu = fuelCandidate(fuelShock, exp.logistics, exp.lanes); if (cu) candidates.push(cu);

  // Demand / FX / macro context shocks → watch (no clean exposure_share/beta<1).
  const demandShock = officialShocks.filter((s) => s.driver_category === "demand" && s.can_publish).sort((a, b) => Math.abs(num(b.percent_change)) - Math.abs(num(a.percent_change)))[0] ?? null;
  if (demandShock && exp.segments.length > 0) {
    candidates.push(watch("ns_demand", `${demandShock.metric_name} ${fmtPct(demandShock.percent_change)} → customer demand watch`,
      "customer_demand", "demand",
      `${demandShock.metric_name} moved ${fmtPct(demandShock.percent_change)} (${demandShock.source_name}). Segment revenue is calibrated but a demand exposure_share and beta<1 are required before modeling a dollar impact.`,
      ["segment_exposure_share", "demand_beta"], [], [], demandShock));
  }
  // Trade-flow context shocks (Census/UN Comtrade) → supplier-availability watch.
  const tradeShocks = officialShocks.filter((s) => s.driver_category === "trade_flow" || (s.cannot_publish_reason || "").includes("trade_flow"));
  const tradeRep = tradeShocks.sort((a, b) => Math.abs(num(b.percent_change)) - Math.abs(num(a.percent_change)))[0];
  if (tradeRep) {
    candidates.push(watch("ns_trade_flow", `${tradeRep.commodity || "Trade"} import flow ${fmtPct(tradeRep.percent_change)} → supplier-availability watch`,
      "trade_flow", "trade_flow",
      `${tradeRep.metric_name} ${fmtPct(tradeRep.percent_change)} (${tradeRep.source_name}, ${tradeRep.source_period}). Trade-flow signal; map to specific supplier country-of-origin to quantify.`,
      ["supplier_country_of_origin_mapping"], tradeRep.commodity ? [tradeRep.commodity] : [], [], tradeRep));
  }

  // 3a. Duplicate / double-count guard.
  // A published candidate may not stand if its driver + exposure base is already
  // represented by another published candidate. The base key is driver_category +
  // commodity, so: two freight issues collide (→ one wins), but steel/copper/aluminum
  // (distinct commodity bases) and freight-vs-fuel (distinct drivers, intentionally
  // separate) never collide. The higher-dollar candidate keeps; the loser is demoted
  // to watch with an explicit "already represented" reason — never silently dropped.
  const baseKey = (c: Candidate) => `${c.driver_category}:${(c.affected_commodities[0] || c.risk_type || "_").toLowerCase()}`;
  const preventedDuplicates: { demoted: string; kept: string; base: string }[] = [];
  const bestByBase = new Map<string, Candidate>();
  for (const c of candidates) {
    if (c.decision !== "published") continue;
    const k = baseKey(c);
    const incumbent = bestByBase.get(k);
    if (!incumbent) { bestByBase.set(k, c); continue; }
    const loser = Math.abs(c.dollar) > Math.abs(incumbent.dollar) ? incumbent : c;
    const winner = loser === incumbent ? c : incumbent;
    bestByBase.set(k, winner);
    // Demote the loser to watch (same exposure base already published).
    loser.decision = "watch"; loser.issue_category = "watchlist"; loser.display_section = "watchlist";
    loser.issue_direction = "uncertain"; loser.dollar = 0; loser.formula_text = ""; loser.formula_inputs = {};
    loser.required_to_promote = ["distinct_exposure_base"]; loser.missing = ["distinct_exposure_base"];
    loser.reasons = [`exposure base already represented by ${winner.risk_title}`];
    loser.business_impact = `Not separately counted — this driver + exposure base is already represented by the published issue "${winner.risk_title}".`;
    preventedDuplicates.push({ demoted: loser.issue_key, kept: winner.issue_key, base: k });
  }

  // 4. Persist: upsert by issue_key, clean stale, write actions + gate results.
  const keys = candidates.map((c) => c.issue_key);
  const { data: existing } = await db.from("risk_register").select("id, issue_key").eq("company_id", companyId);
  const existingByKey = new Map((existing ?? []).map((r: any) => [r.issue_key, r.id]));
  const nowIso = new Date().toISOString();

  const writtenIds: Record<string, string> = {};
  for (const c of candidates) {
    const row: any = {
      company_id: companyId, risk_title: c.risk_title, risk_type: c.risk_type,
      probability: c.probability, impact_low: Math.round(c.dollar * (c.decision === "published" ? 0.85 : 0)),
      impact_high: Math.round(c.dollar), confidence: c.confidence, severity: c.severity,
      owner: c.owner, action_required: c.action_required, due_days: c.decision === "published" ? 7 : 30,
      issue_category: c.issue_category, issue_direction: c.issue_direction, display_section: c.display_section,
      is_actionable_risk: c.display_section === "risk_register",
      exposure_interpretation: c.exposure_interpretation, what_happened: c.what_happened, why_now: c.why_now,
      business_impact: c.business_impact, decision_required: c.action_required,
      estimated_revenue_exposure: c.dollar || null,
      affected_commodities: c.affected_commodities, affected_suppliers: c.affected_suppliers, affected_customers: c.affected_customers,
      exposure_path: c.exposure_path,
      // The numeric shock IS the evidence — populate evidence_items so the
      // Evidence Sources metric and per-card evidence count are never 0 for a
      // metric-backed published issue.
      evidence_items: c.numeric_basis_value != null ? [{
        title: `${c.numeric_basis_source_label ?? "metric"}: ${c.risk_title}`,
        source: c.numeric_basis_source_label ?? "source",
        source_name: c.numeric_basis_source_label ?? "source",
        url: c.numeric_basis_source_url ?? null,
        source_url: c.numeric_basis_source_url ?? null,
        source_quality: c.numeric_basis_type === "article_numeric_claim" ? 60 : 95,
        content_text: c.numeric_basis_snippet ?? c.what_happened,
        why_it_matters: c.business_impact,
      }] : [],
      evidence_titles: c.numeric_basis_value != null ? [`${c.numeric_basis_source_label ?? "metric"}: ${c.risk_title}`] : [],
      evidence_sources: c.numeric_basis_source_label ? [c.numeric_basis_source_label] : [],
      evidence_urls: c.numeric_basis_source_url ? [c.numeric_basis_source_url] : [],
      evidence_quality_score: c.numeric_basis_type === "article_numeric_claim" ? 60 : 95,
      supporting_event_count: c.numeric_basis_value != null ? 1 : 0,
      methodology: {
        generator_version: "numeric-shock-ledger-v1",
        // Carry the canonical basis into methodology so UI badge logic that only
        // receives `methodology` (getIssueModelStatus) classifies correctly.
        numeric_basis_type: c.numeric_basis_type,
        shock_source: c.numeric_basis_type === "article_numeric_claim" ? "article_claim" : "official_structured_metric",
        driver_template: c.driver_category, formula: c.formula_text, formula_text: c.formula_text,
        formula_status: c.formula_text ? "calculated" : "not_calculated",
        gate_status: c.decision === "published" ? "published" : "watch",
        gate_reason: c.decision === "published"
          ? "Published: official numeric shock + mapped company exposure + formula + owner action."
          : `Watch: ${c.required_to_promote.join(", ")}.`,
        missing_inputs: c.missing, required_to_promote: c.required_to_promote, source_shock_id: c.source_shock_id,
        calibration_status: c.decision === "published" ? "calibrated" : "needs_calibration",
      },
      numeric_basis_type: c.numeric_basis_type, numeric_basis_value: c.numeric_basis_value,
      numeric_basis_unit: c.numeric_basis_unit, numeric_basis_snippet: c.numeric_basis_snippet,
      numeric_basis_source_url: c.numeric_basis_source_url, numeric_basis_source_label: c.numeric_basis_source_label,
      // First-class basis/audit columns (one truth system — no JSON digging).
      numeric_shock_id: c.source_shock_id, source_observation_id: c.source_observation_id,
      formula: c.formula_text || null, business_estimate: c.dollar || null,
      formula_inputs: c.formula_inputs,
      priority_score: c.decision === "published"
        ? priorityScore({
            dollar: c.dollar, confidence: c.confidence, freshness: c.freshness_level,
            official: c.numeric_basis_type !== "article_numeric_claim" && c.numeric_basis_type !== "no_numeric_basis",
            hasFormula: !!c.formula_text, hasAction: !!c.action_required,
          })
        : Math.min(40, 10 + Math.round((c.confidence / 100) * 20)),
      gate_status: c.decision === "published" ? "published" : "watch",
      issue_key: c.issue_key, last_seen_run_id: runId, last_seen_at: nowIso, last_updated: nowIso,
      archived_at: null, archived_reason: null,
    };
    const existId = existingByKey.get(c.issue_key);
    if (existId) {
      await db.from("risk_register").update(row).eq("id", existId);
      writtenIds[c.issue_key] = existId as string;
    } else {
      const { data: ins } = await db.from("risk_register").insert(row).select("id").single();
      if (ins) writtenIds[c.issue_key] = ins.id;
    }
  }

  // 4a. Stale cleanup: demote any prior generated row not in this run to watchlist + archive.
  const staleKeys = (existing ?? []).filter((r: any) => !keys.includes(r.issue_key)).map((r: any) => r.issue_key);
  if (staleKeys.length > 0) {
    // Demote to watch AND clear stale dollar values so no superseded $-estimate
    // (e.g. the old $457M scenario) ever shows on the watchlist.
    await db.from("risk_register").update({
      gate_status: "watch", display_section: "watchlist", issue_category: "watchlist", is_actionable_risk: false,
      impact_low: 0, impact_high: 0, estimated_revenue_exposure: null,
      archived_at: nowIso, archived_reason: "superseded_by_numeric_ledger_run",
    }).eq("company_id", companyId).in("issue_key", staleKeys);
  }

  // 4b. Actions: clean slate, then one per published issue (no stale actions).
  await db.from("risk_actions").delete().eq("company_id", companyId);
  const pubCands = candidates.filter((c) => c.decision === "published");
  for (const c of pubCands) {
    const rid = writtenIds[c.issue_key];
    if (!rid) continue;
    await db.from("risk_actions").insert({
      company_id: companyId, risk_id: rid, issue_key: c.issue_key, title: c.action_required.slice(0, 280),
      owner: c.owner, status: "open", source_type: "risk",
      deadline: new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10),
      expected_benefit: `Quantify and act on ${money(c.dollar)} ${c.issue_direction} exposure (${c.formula_text}).`,
    });
  }

  // 4c. Gate results: clean slate, then one per candidate.
  await db.from("issue_quality_gate_results").delete().eq("company_id", companyId);
  for (const c of candidates) {
    await db.from("issue_quality_gate_results").insert({
      company_id: companyId, published_risk_id: writtenIds[c.issue_key] ?? null,
      decision: c.decision, quality_score: c.decision === "published" ? 85 : 45,
      financial_model_score: c.formula_text ? 90 : 30, actionability_score: c.decision === "published" ? 90 : 40,
      forecast_eligible: c.decision === "published",
      reasons: c.reasons, required_to_promote: c.required_to_promote,
      reviewer_notes: c.formula_text || c.exposure_interpretation,
    });
  }

  // 4d/4e. Formula-input provenance + company calibration coverage (DB-backed trust
  // foundation). Delegated to the single shared writer so manual (here) and scheduled
  // (runOrchestration finalize) runs use identical, idempotent logic. It reads the
  // risk_register rows just written, so reruns update in place (no duplicates) and stale
  // inputs never linger. Estimates/formulas/gates are NOT touched.
  const prov = await recomputeProvenanceAndCoverage(db, companyId);
  if (!prov.ok && prov.error) console.error("provenance/coverage writer error", prov.error);

  const published = pubCands.length;
  const watchCount = candidates.filter((c) => c.decision === "watch").length;
  const publishedMetricBacked = pubCands.filter((c) => c.numeric_basis_type !== "article_numeric_claim" && c.numeric_basis_type !== "no_numeric_basis").length;
  const publishedArticleBacked = pubCands.filter((c) => c.numeric_basis_type === "article_numeric_claim").length;
  return json({
    ok: true,
    candidates_generated: candidates.length,
    published, watch: watchCount,
    published_metric_backed: publishedMetricBacked,
    published_article_claim_backed: publishedArticleBacked,
    published_scenario_backed: 0,
    numeric_shocks_used_in_published: pubCands.filter((c) => c.source_shock_id).length,
    article_shocks: articleStats.article_shocks, article_claims_corroborated: articleStats.corroborated,
    published_issues: pubCands.map((c) => ({ issue_key: c.issue_key, title: c.risk_title, dollar: money(c.dollar), basis: `${c.numeric_basis_value}${c.numeric_basis_unit}`, source: c.numeric_basis_source_label, formula: c.formula_text })),
    stale_demoted: staleKeys,
    prevented_duplicates: preventedDuplicates,
    provenance_rows_written: prov.provenance_rows_written,
    company_calibration_coverage_pct: prov.coverage_pct,
    provenance_ok: prov.ok,
    provenance_error: prov.error ?? null,
  });
});
