import { supabase } from "../lib/supabase";
import { isDemoMode } from "./companyService";

export type CompanyCalibrationInput = {
  annual_revenue?: number | null;
  gross_margin_pct?: number | null;
  cogs?: number | null;

  manufacturing_revenue?: number | null;
  construction_revenue?: number | null;
  utilities_revenue?: number | null;
  industrial_maintenance_revenue?: number | null;

  steel_spend?: number | null;
  copper_spend?: number | null;
  aluminum_spend?: number | null;
  freight_spend?: number | null;

  steel_import_exposure_pct?: number | null;
  copper_import_exposure_pct?: number | null;
  aluminum_import_exposure_pct?: number | null;

  pass_through_coverage_pct?: number | null;
  average_repricing_lag_days?: number | null;

  freight_contract_coverage_pct?: number | null;
  freight_spot_rate_exposure_pct?: number | null;

  quote_win_rate_pct?: number | null;
  lost_quote_rate_pct?: number | null;
  customer_churn_rate_pct?: number | null;

  backorder_rate_pct?: number | null;
  backorder_cancellation_rate_pct?: number | null;

  expedite_premium_pct?: number | null;
  average_supplier_lead_time_days?: number | null;

  inventory_days?: number | null;
  fill_rate_pct?: number | null;

  notes?: string | null;
};

function dbNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;

  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function positiveNumber(value: unknown) {
  const n = dbNumber(value);
  return n !== null && n > 0 ? n : null;
}

function affectedSegmentsFromInput(input: CompanyCalibrationInput) {
  const segments: string[] = [];

  if (positiveNumber(input.manufacturing_revenue)) {
    segments.push("Manufacturing Customers");
  }

  if (positiveNumber(input.construction_revenue)) {
    segments.push("Construction Customers");
  }

  if (positiveNumber(input.utilities_revenue)) {
    segments.push("Utilities Customers");
  }

  if (positiveNumber(input.industrial_maintenance_revenue)) {
    segments.push("Industrial Maintenance Customers");
  }

  return segments;
}

function buildCommodityRows(companyId: string, input: CompanyCalibrationInput) {
  const affectedSegments = affectedSegmentsFromInput(input);

  return [
    {
      company_id: companyId,
      commodity: "Steel",
      annual_spend: dbNumber(input.steel_spend),
      import_exposure_pct: dbNumber(input.steel_import_exposure_pct),
      supplier_country_exposure: {},
      pass_through_pct: dbNumber(input.pass_through_coverage_pct),
      repricing_lag_days: dbNumber(input.average_repricing_lag_days),
      affected_segments: affectedSegments,
      updated_at: new Date().toISOString(),
    },
    {
      company_id: companyId,
      commodity: "Copper",
      annual_spend: dbNumber(input.copper_spend),
      import_exposure_pct: dbNumber(input.copper_import_exposure_pct),
      supplier_country_exposure: {},
      pass_through_pct: dbNumber(input.pass_through_coverage_pct),
      repricing_lag_days: dbNumber(input.average_repricing_lag_days),
      affected_segments: affectedSegments,
      updated_at: new Date().toISOString(),
    },
    {
      company_id: companyId,
      commodity: "Aluminum",
      annual_spend: dbNumber(input.aluminum_spend),
      import_exposure_pct: dbNumber(input.aluminum_import_exposure_pct),
      supplier_country_exposure: {},
      pass_through_pct: dbNumber(input.pass_through_coverage_pct),
      repricing_lag_days: dbNumber(input.average_repricing_lag_days),
      affected_segments: affectedSegments,
      updated_at: new Date().toISOString(),
    },
  ].filter((row) => positiveNumber(row.annual_spend));
}

function buildLogisticsRows(companyId: string, input: CompanyCalibrationInput) {
  if (!positiveNumber(input.freight_spend)) return [];

  return [
    {
      company_id: companyId,
      freight_mode: "Freight",
      annual_freight_spend: dbNumber(input.freight_spend),
      contract_coverage_pct: dbNumber(input.freight_contract_coverage_pct),
      spot_rate_exposure_pct: dbNumber(input.freight_spot_rate_exposure_pct),
      affected_segments: affectedSegmentsFromInput(input),
      updated_at: new Date().toISOString(),
    },
  ];
}

function buildSegmentRows(companyId: string, input: CompanyCalibrationInput) {
  return [
    {
      company_id: companyId,
      segment_name: "Manufacturing Customers",
      annual_revenue: dbNumber(input.manufacturing_revenue),
      gross_margin_pct: dbNumber(input.gross_margin_pct),
      price_sensitivity: null,
      demand_beta: 1,
      updated_at: new Date().toISOString(),
    },
    {
      company_id: companyId,
      segment_name: "Construction Customers",
      annual_revenue: dbNumber(input.construction_revenue),
      gross_margin_pct: dbNumber(input.gross_margin_pct),
      price_sensitivity: null,
      demand_beta: 1,
      updated_at: new Date().toISOString(),
    },
    {
      company_id: companyId,
      segment_name: "Utilities Customers",
      annual_revenue: dbNumber(input.utilities_revenue),
      gross_margin_pct: dbNumber(input.gross_margin_pct),
      price_sensitivity: null,
      demand_beta: 1,
      updated_at: new Date().toISOString(),
    },
    {
      company_id: companyId,
      segment_name: "Industrial Maintenance Customers",
      annual_revenue: dbNumber(input.industrial_maintenance_revenue),
      gross_margin_pct: dbNumber(input.gross_margin_pct),
      price_sensitivity: null,
      demand_beta: 1,
      updated_at: new Date().toISOString(),
    },
  ].filter((row) => positiveNumber(row.annual_revenue));
}

async function replaceCompanyRows(
  tableName: string,
  companyId: string,
  rows: Record<string, unknown>[]
) {
  const { error: deleteError } = await supabase
    .from(tableName)
    .delete()
    .eq("company_id", companyId);

  if (deleteError) {
    throw deleteError;
  }

  if (rows.length === 0) return;

  const { error: insertError } = await supabase.from(tableName).insert(rows);

  if (insertError) {
    throw insertError;
  }
}

export async function getCalibrationForCompany(companyId: string) {
  const { data, error } = await supabase
    .from("company_calibration")
    .select("*")
    .eq("company_id", companyId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

export async function saveCalibrationForCompany(
  companyId: string,
  input: CompanyCalibrationInput
) {
  // Public demo is read-only — never mutate the demo company's calibration.
  if (isDemoMode()) return null;

  const payload = {
    company_id: companyId,

    annual_revenue: dbNumber(input.annual_revenue),
    gross_margin_pct: dbNumber(input.gross_margin_pct),
    cogs: dbNumber(input.cogs),

    manufacturing_revenue: dbNumber(input.manufacturing_revenue),
    construction_revenue: dbNumber(input.construction_revenue),
    utilities_revenue: dbNumber(input.utilities_revenue),
    industrial_maintenance_revenue: dbNumber(
      input.industrial_maintenance_revenue
    ),

    steel_spend: dbNumber(input.steel_spend),
    copper_spend: dbNumber(input.copper_spend),
    aluminum_spend: dbNumber(input.aluminum_spend),
    freight_spend: dbNumber(input.freight_spend),

    steel_import_exposure_pct: dbNumber(input.steel_import_exposure_pct),
    copper_import_exposure_pct: dbNumber(input.copper_import_exposure_pct),
    aluminum_import_exposure_pct: dbNumber(
      input.aluminum_import_exposure_pct
    ),

    pass_through_coverage_pct: dbNumber(input.pass_through_coverage_pct),
    average_repricing_lag_days: dbNumber(input.average_repricing_lag_days),

    freight_contract_coverage_pct: dbNumber(
      input.freight_contract_coverage_pct
    ),
    freight_spot_rate_exposure_pct: dbNumber(
      input.freight_spot_rate_exposure_pct
    ),

    quote_win_rate_pct: dbNumber(input.quote_win_rate_pct),
    lost_quote_rate_pct: dbNumber(input.lost_quote_rate_pct),
    customer_churn_rate_pct: dbNumber(input.customer_churn_rate_pct),

    backorder_rate_pct: dbNumber(input.backorder_rate_pct),
    backorder_cancellation_rate_pct: dbNumber(
      input.backorder_cancellation_rate_pct
    ),

    expedite_premium_pct: dbNumber(input.expedite_premium_pct),
    average_supplier_lead_time_days: dbNumber(
      input.average_supplier_lead_time_days
    ),

    inventory_days: dbNumber(input.inventory_days),
    fill_rate_pct: dbNumber(input.fill_rate_pct),

    notes: input.notes ?? null,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("company_calibration")
    .upsert(payload, {
      onConflict: "company_id",
    })
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  await replaceCompanyRows(
    "company_commodity_exposure",
    companyId,
    buildCommodityRows(companyId, input)
  );

  await replaceCompanyRows(
    "company_logistics_exposure",
    companyId,
    buildLogisticsRows(companyId, input)
  );

  await replaceCompanyRows(
    "company_segment_exposure",
    companyId,
    buildSegmentRows(companyId, input)
  );

  return data;
}