import { supabase } from "../lib/supabase";
import { generateQueries } from "./queryGenerator";

export async function createTrackingQueries(companyId: string, industry: string) {
  console.log("createTrackingQueries called");
  console.log("companyId:", companyId);
  console.log("industry:", industry);

  const [
    entitiesResult,
    suppliersResult,
    customersResult,
    commoditiesResult,
    facilitiesResult,
  ] = await Promise.all([
    supabase.from("company_entities").select("*").eq("company_id", companyId),
    supabase.from("supplier_exposure").select("*").eq("company_id", companyId),
    supabase.from("customer_exposure").select("*").eq("company_id", companyId),
    supabase.from("commodity_exposure").select("*").eq("company_id", companyId),
    supabase.from("company_facilities").select("*").eq("company_id", companyId),
  ]);

  if (entitiesResult.error) {
    alert(entitiesResult.error.message);
    return;
  }

  await supabase
    .from("tracking_queries")
    .delete()
    .eq("company_id", companyId);

  const generatedQueries = generateQueries({
    entities: entitiesResult.data || [],
    industry,
    suppliers: suppliersResult.data || [],
    customers: customersResult.data || [],
    commodities: commoditiesResult.data || [],
    facilities: facilitiesResult.data || [],
  });

  console.log("generatedQueries:", generatedQueries);

  if (generatedQueries.length === 0) {
    console.log("No queries generated");
    return;
  }

  const inserts = generatedQueries.map((query) => ({
    company_id: companyId,
    query_text: query.query_text,
    query_type: query.query_type,
  }));

  const { error } = await supabase
    .from("tracking_queries")
    .insert(inserts);

  if (error) {
    alert(error.message);
    return;
  }

  console.log(`Inserted ${inserts.length} tracking queries`);
}