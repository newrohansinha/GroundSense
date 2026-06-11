// operatingModelService.ts
// Pure computation — no Supabase, no React imports.

export type ModelSection = {
  key: string;
  title: string;
  status: "calibrated" | "partially_calibrated" | "inferred" | "missing";
  completenessPercent: number;
  presentFields: string[];
  missingFields: Array<{
    key: string;
    label: string;
    priority: "critical" | "high" | "medium";
  }>;
  whyItMatters: string;
};

export type OperatingModelReport = {
  sections: ModelSection[];
  overallCompleteness: number;
  totalPresent: number;
  totalRequired: number;
};

// ---------------------------------------------------------------------------
// Calibration input type (subset consumed here)
// ---------------------------------------------------------------------------

type Calibration = {
  freight_spend?: number | null;
  freight_spot_rate_exposure_pct?: number | null;
  freight_contract_coverage_pct?: number | null;
  steel_spend?: number | null;
  steel_import_exposure_pct?: number | null;
  copper_spend?: number | null;
  pass_through_coverage_pct?: number | null;
  average_repricing_lag_days?: number | null;
  manufacturing_revenue?: number | null;
  construction_revenue?: number | null;
  gross_margin_pct?: number | null;
  annual_revenue?: number | null;
  quote_win_rate_pct?: number | null;
  fill_rate_pct?: number | null;
  backorder_rate_pct?: number | null;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function present(v: number | null | undefined): boolean {
  return v !== null && v !== undefined && Number.isFinite(v);
}

type FieldDef = {
  key: string;
  label: string;
  priority: "critical" | "high" | "medium";
};

// Completeness includes both checkable (can be present/absent) and structural
// always-missing fields in the denominator so scores are honest.
function completenessOf(
  checkable: Array<FieldDef & { exists: boolean }>,
  alwaysMissing: FieldDef[]
): { pct: number; presentFields: string[]; missingFields: FieldDef[] } {
  const presentFields: string[] = [];
  const missingCheckable: FieldDef[] = [];

  checkable.forEach((f) => {
    if (f.exists) presentFields.push(f.key);
    else missingCheckable.push({ key: f.key, label: f.label, priority: f.priority });
  });

  const allMissing = [...missingCheckable, ...alwaysMissing];
  const total = checkable.length + alwaysMissing.length;
  const pct = total === 0 ? 0 : Math.round((presentFields.length / total) * 100);

  return { pct, presentFields, missingFields: allMissing };
}

// ---------------------------------------------------------------------------
// Section builders
// ---------------------------------------------------------------------------

function freightSection(cal: Calibration): ModelSection {
  // 3 checkable + 5 structural always-missing = 8 total inputs
  // With all 3 calibrated: 3/8 = 37% → honest "partially calibrated" score
  const checkable: Array<FieldDef & { exists: boolean }> = [
    { key: "freight_spend", label: "Annual freight spend", priority: "critical", exists: present(cal.freight_spend) },
    { key: "freight_spot_rate_exposure_pct", label: "Spot rate exposure %", priority: "critical", exists: present(cal.freight_spot_rate_exposure_pct) },
    { key: "freight_contract_coverage_pct", label: "Contract coverage %", priority: "high", exists: present(cal.freight_contract_coverage_pct) },
  ];
  const alwaysMissing: FieldDef[] = [
    { key: "lane_level_spend", label: "Lane-level spend breakdown", priority: "critical" },
    { key: "surcharge_by_lane", label: "Surcharge exposure by lane", priority: "high" },
    { key: "carrier_contracts", label: "Carrier contract terms", priority: "medium" },
    { key: "supplier_paid_vs_company_paid", label: "Supplier-paid vs. company-paid freight split", priority: "high" },
    { key: "customer_pass_through_freight", label: "Customer pass-through terms", priority: "medium" },
  ];

  const { pct, presentFields, missingFields } = completenessOf(checkable, alwaysMissing);

  let status: ModelSection["status"];
  if (present(cal.freight_spend) && present(cal.freight_spot_rate_exposure_pct) && present(cal.freight_contract_coverage_pct)) {
    status = "partially_calibrated";
  } else if (present(cal.freight_spend)) {
    status = "inferred";
  } else {
    status = "missing";
  }

  return {
    key: "freight",
    title: "Freight model",
    status,
    completenessPercent: pct,
    presentFields,
    missingFields,
    whyItMatters:
      "Freight cost is a direct P&L line. Without lane-level and spot-exposure data, rate-shock impact cannot be sized accurately.",
  };
}

function commoditySection(cal: Calibration): ModelSection {
  // 3 checkable + 4 always-missing = 7 total → ~43% when all 3 present
  const checkable: Array<FieldDef & { exists: boolean }> = [
    { key: "steel_spend", label: "Annual steel / metals spend", priority: "critical", exists: present(cal.steel_spend) },
    { key: "steel_import_exposure_pct", label: "Import exposure %", priority: "high", exists: present(cal.steel_import_exposure_pct) },
    { key: "pass_through_coverage_pct", label: "Pass-through coverage %", priority: "high", exists: present(cal.pass_through_coverage_pct) },
  ];
  const alwaysMissing: FieldDef[] = [
    { key: "country_of_origin", label: "Supplier country-of-origin mix", priority: "critical" },
    { key: "supplier_pass_through_terms", label: "Supplier pass-through contract terms", priority: "high" },
    { key: "purchase_order_exposure", label: "Open purchase-order exposure", priority: "high" },
    { key: "sku_landed_cost", label: "SKU/category landed cost", priority: "medium" },
  ];

  const { pct, presentFields, missingFields } = completenessOf(checkable, alwaysMissing);

  let status: ModelSection["status"];
  if (present(cal.steel_spend) && present(cal.steel_import_exposure_pct)) {
    status = "partially_calibrated";
  } else if (present(cal.steel_spend)) {
    status = "inferred";
  } else {
    status = "missing";
  }

  return {
    key: "commodity",
    title: "Commodity model",
    status,
    completenessPercent: pct,
    presentFields,
    missingFields,
    whyItMatters:
      "Steel and copper represent the largest tariff-exposed cost lines. Country-of-origin data is required to apply correct tariff rates to each supplier.",
  };
}

function supplierSection(_cal: Calibration): ModelSection {
  return {
    key: "supplier",
    title: "Supplier model",
    status: "missing",
    completenessPercent: 0,
    presentFields: [],
    missingFields: [
      { key: "supplier_concentration", label: "Supplier concentration (top-10 share)", priority: "high" },
      { key: "single_source_exposure", label: "Single-source item exposure", priority: "critical" },
      { key: "supplier_geography", label: "Supplier geography / country mix", priority: "high" },
      { key: "lead_time_by_supplier", label: "Lead time by supplier", priority: "medium" },
    ],
    whyItMatters:
      "Single-source dependencies amplify any supply disruption; without concentration data, resilience risk is invisible.",
  };
}

function customerRevenueSection(cal: Calibration): ModelSection {
  // 3 checkable + 7 always-missing = 10 total → 3/10 = 30% when all 3 present
  const checkable: Array<FieldDef & { exists: boolean }> = [
    { key: "manufacturing_revenue", label: "Manufacturing segment revenue", priority: "critical", exists: present(cal.manufacturing_revenue) },
    { key: "construction_revenue", label: "Construction segment revenue", priority: "high", exists: present(cal.construction_revenue) },
    { key: "gross_margin_pct", label: "Gross margin %", priority: "high", exists: present(cal.gross_margin_pct) },
  ];
  const alwaysMissing: FieldDef[] = [
    { key: "crm_pipeline", label: "CRM pipeline data", priority: "critical" },
    { key: "quote_volume", label: "Recent quote volume trend", priority: "high" },
    { key: "account_demand_trend", label: "Account-level demand trend", priority: "high" },
    { key: "win_loss_rate", label: "Win/loss rate by segment", priority: "high" },
    { key: "customer_concentration", label: "Customer concentration (top-10 share)", priority: "high" },
    { key: "account_ownership", label: "Account ownership by rep/team", priority: "medium" },
    { key: "segment_growth_trend", label: "Segment growth trend (last 4 quarters)", priority: "medium" },
  ];

  const { pct, presentFields, missingFields } = completenessOf(checkable, alwaysMissing);

  const status: ModelSection["status"] =
    present(cal.manufacturing_revenue) || present(cal.construction_revenue)
      ? "partially_calibrated"
      : "missing";

  return {
    key: "customer_revenue",
    title: "Customer / revenue model",
    status,
    completenessPercent: pct,
    presentFields,
    missingFields,
    whyItMatters:
      "Segment revenue allocation drives demand-shift impact sizing. CRM data is required to convert macro demand signals into actionable pipeline forecasts.",
  };
}

function competitiveSection(_cal: Calibration): ModelSection {
  return {
    key: "competitive",
    title: "Competitive model",
    status: "missing",
    completenessPercent: 0,
    presentFields: [],
    missingFields: [
      { key: "win_loss_data", label: "Win/loss data by account", priority: "critical" },
      { key: "pricing_vs_competitors", label: "Pricing vs. competitor benchmarks", priority: "high" },
      { key: "market_share_trend", label: "Market share trend", priority: "high" },
      { key: "competitor_activity", label: "Competitor sales activity / displacement signals", priority: "medium" },
    ],
    whyItMatters:
      "Without win/loss data, competitive exposure is directional only and cannot be sized in dollar terms.",
  };
}

function financialSection(cal: Calibration): ModelSection {
  // 2 checkable + 2 always-missing = 4 total → 2/4 = 50% when both present
  const checkable: Array<FieldDef & { exists: boolean }> = [
    { key: "annual_revenue", label: "Annual revenue", priority: "critical", exists: present(cal.annual_revenue) },
    { key: "gross_margin_pct", label: "Gross margin %", priority: "critical", exists: present(cal.gross_margin_pct) },
  ];
  const alwaysMissing: FieldDef[] = [
    { key: "segment_gross_margin", label: "Segment-level gross margin", priority: "high" },
    { key: "ebitda_margin", label: "EBITDA margin / operating leverage", priority: "high" },
  ];

  const { pct, presentFields, missingFields } = completenessOf(checkable, alwaysMissing);

  let status: ModelSection["status"];
  if (present(cal.annual_revenue) && present(cal.gross_margin_pct)) {
    status = "partially_calibrated";
  } else if (present(cal.annual_revenue) || present(cal.gross_margin_pct)) {
    status = "inferred";
  } else {
    status = "missing";
  }

  return {
    key: "financial",
    title: "Financial model",
    status,
    completenessPercent: pct,
    presentFields,
    missingFields,
    whyItMatters:
      "Revenue and gross margin anchor every percentage-based exposure calculation in the model.",
  };
}

function actionHistorySection(_cal: Calibration): ModelSection {
  return {
    key: "action_history",
    title: "Action / outcome history",
    status: "missing",
    completenessPercent: 0,
    presentFields: [],
    missingFields: [
      { key: "resolved_issues", label: "Resolved issue outcomes", priority: "critical" },
      { key: "outcome_data", label: "Actual vs. modeled impact data", priority: "high" },
      { key: "accuracy_history", label: "Forecast accuracy history", priority: "medium" },
    ],
    whyItMatters:
      "Outcome tracking allows model calibration over time and builds credibility with the board.",
  };
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function computeOperatingModelCompleteness(
  calibration: Calibration | null
): OperatingModelReport {
  const cal: Calibration = calibration ?? {};

  const sections: ModelSection[] = [
    freightSection(cal),
    commoditySection(cal),
    supplierSection(cal),
    customerRevenueSection(cal),
    competitiveSection(cal),
    financialSection(cal),
    actionHistorySection(cal),
  ];

  // Overall: count present critical+high fields vs. total critical+high fields
  let totalRequired = 0;
  let totalPresent = 0;

  for (const section of sections) {
    const missingCH = section.missingFields.filter(
      (f) => f.priority === "critical" || f.priority === "high"
    ).length;
    const presentCH = section.presentFields.length;
    totalRequired += presentCH + missingCH;
    totalPresent += presentCH;
  }

  const overallCompleteness =
    totalRequired === 0 ? 0 : Math.round((totalPresent / totalRequired) * 100);

  return {
    sections,
    overallCompleteness,
    totalPresent,
    totalRequired,
  };
}
