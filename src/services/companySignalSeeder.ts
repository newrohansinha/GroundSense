// Seeds the signal inputs the intelligence pipeline needs (company entities +
// news tracking queries) from the data the onboarding wizard actually collects
// (company profile + calibration domains). Without this, a fresh company has no
// tracking queries, so the pipeline fetches/scores nothing and finishes as a
// fast no-op. Idempotent; replaces prior seeded rows.

import { supabase } from "../lib/supabase";
import { generateQueries, type QueryModelInput } from "./queryGenerator";
import { isDemoMode } from "./companyService";

export type SeedResult = { entities: number; queries: number };

function splitCsv(v: unknown): string[] {
  return String(v ?? "")
    .split(/[,\n;]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function seedCompanySignals(companyId: string): Promise<SeedResult> {
  // Never seed/mutate the read-only demo company.
  if (isDemoMode()) return { entities: 0, queries: 0 };

  const [companyRes, profileAns, suppliersRes, crmRes, compRes, calibRes] = await Promise.all([
    supabase.from("companies").select("industry,name").eq("id", companyId).maybeSingle(),
    supabase.from("onboarding_answers").select("answers").eq("company_id", companyId).eq("step_key", "company_profile").maybeSingle(),
    supabase.from("supplier_procurement_exposure").select("supplier_name,country_of_origin,commodity").eq("company_id", companyId),
    supabase.from("crm_demand_signals").select("segment,account_name").eq("company_id", companyId),
    supabase.from("competitive_signals").select("competitor_name").eq("company_id", companyId),
    supabase.from("company_calibration").select("steel_spend,copper_spend,aluminum_spend").eq("company_id", companyId).maybeSingle(),
  ]);

  const industry = (companyRes.data?.industry as string) ?? "";
  const ans = (profileAns.data?.answers ?? {}) as Record<string, unknown>;
  const suppliers = (suppliersRes.data ?? []) as { supplier_name?: string; country_of_origin?: string; commodity?: string }[];
  const crm = (crmRes.data ?? []) as { segment?: string; account_name?: string }[];
  const competitors = (compRes.data ?? []) as { competitor_name?: string }[];
  const calib = (calibRes.data ?? {}) as { steel_spend?: number; copper_spend?: number; aluminum_spend?: number };

  const commoditySet = new Set<string>();
  for (const s of suppliers) if (s.commodity) commoditySet.add(s.commodity.trim());
  if (Number(calib.steel_spend) > 0) commoditySet.add("Steel");
  if (Number(calib.copper_spend) > 0) commoditySet.add("Copper");
  if (Number(calib.aluminum_spend) > 0) commoditySet.add("Aluminum");

  const countrySet = new Set<string>();
  for (const s of suppliers) if (s.country_of_origin) countrySet.add(s.country_of_origin.trim());

  const segmentSet = new Set<string>();
  for (const r of crm) if (r.segment) segmentSet.add(r.segment.trim());
  splitCsv(ans.customer_segments).forEach((x) => segmentSet.add(x));

  const products = splitCsv(ans.product_categories);
  const competitorNames = competitors.map((c) => c.competitor_name).filter(Boolean) as string[];

  // ── Company entities (used by connection-building + company model views) ──
  const entityRows: { company_id: string; entity_type: string; entity_value: string }[] = [];
  const push = (type: string, vals: Iterable<string>) => {
    for (const v of vals) {
      const t = String(v).trim();
      if (t) entityRows.push({ company_id: companyId, entity_type: type, entity_value: t });
    }
  };
  push("supplier", suppliers.map((s) => s.supplier_name ?? "").filter(Boolean));
  push("supplier_country", countrySet);
  push("commodity", commoditySet);
  push("competitor", competitorNames);
  push("product_line", products);
  push("customer_segment", segmentSet);

  await supabase.from("company_entities").delete().eq("company_id", companyId);
  if (entityRows.length) await supabase.from("company_entities").insert(entityRows);

  // ── News tracking queries (the source the fetch step actually reads) ──
  const model: QueryModelInput = {
    industry,
    entities: entityRows.map((e) => ({ entity_type: e.entity_type, entity_value: e.entity_value })),
    suppliers: suppliers.map((s) => ({ supplier_name: s.supplier_name ?? "", country: s.country_of_origin ?? "", supplied_input: s.commodity ?? "" })),
    customers: crm.map((r) => ({ customer_name: r.account_name ?? "", product_line: "" })),
    commodities: Array.from(commoditySet).map((c) => ({ commodity: c })),
    facilities: [],
  };
  const queries = generateQueries(model);

  // news_tracking_queries has UNIQUE(company_id, query_name). generateQueries can
  // emit the SAME text under different query_types (e.g. supplier-country vs
  // country-commodity "China Steel tariffs"), which would collide on query_name
  // and reject the whole batch. Dedupe by query_name and upsert-ignore so the
  // insert is robust.
  const byName = new Map<string, { query_name: string; query_text: string; query_type: string }>();
  for (const q of queries) {
    const name = q.query_text.slice(0, 80).trim();
    if (!name || byName.has(name)) continue;
    byName.set(name, { query_name: name, query_text: q.query_text, query_type: q.query_type });
  }
  // Cap total tracking queries. generateQueries orders company-specific queries
  // (suppliers, commodities, countries, competitors) first, so slicing keeps the
  // most relevant and avoids hammering the news API with hundreds of queries.
  const MAX_QUERIES = 80;
  const rows = Array.from(byName.values()).slice(0, MAX_QUERIES).map((q) => ({
    company_id: companyId,
    query_name: q.query_name,
    query_text: q.query_text,
    query_type: q.query_type,
    active: true,
    // Slightly lower than the default 70 so a fresh company's first run can
    // actually ingest relevant articles before manual tuning.
    min_relevance_score: 55,
  }));

  await supabase.from("news_tracking_queries").delete().eq("company_id", companyId);
  if (rows.length) {
    const { error } = await supabase
      .from("news_tracking_queries")
      .upsert(rows, { onConflict: "company_id,query_name", ignoreDuplicates: true });
    if (error) throw new Error(`news_tracking_queries insert failed: ${error.message}`);
  }

  return { entities: entityRows.length, queries: rows.length };
}
