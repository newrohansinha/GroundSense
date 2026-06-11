// estimateQualityService.ts
// Pure computation — no Supabase, no React imports.

export type EstimateQuality =
  | "calibrated"
  | "partially_calibrated"
  | "inferred"
  | "benchmark_based"
  | "scenario_only"
  | "needs_validation";

export type MissingInputDef = {
  key: string;
  label: string;
  why_it_matters: string;
  category: "freight" | "commodity" | "customer" | "competitor" | "financial";
  priority: "critical" | "high" | "medium";
};

export type EstimateQualityReport = {
  quality: EstimateQuality;
  qualityLabel: string;
  qualityDescription: string;
  missingInputs: MissingInputDef[];
  caveats: string[];
  overallScore: number; // 0–100
};

// ---------------------------------------------------------------------------
// Missing input catalogues
// ---------------------------------------------------------------------------

const FREIGHT_MISSING: MissingInputDef[] = [
  {
    key: "freight_spend",
    label: "Annual freight spend",
    why_it_matters: "Sets the absolute dollar base for all freight exposure math.",
    category: "freight",
    priority: "critical",
  },
  {
    key: "freight_spot_rate_exposure_pct",
    label: "Spot rate exposure %",
    why_it_matters: "Determines what share of spend is unprotected by contracts and directly affected by rate shocks.",
    category: "freight",
    priority: "critical",
  },
  {
    key: "freight_contract_coverage_pct",
    label: "Contract coverage %",
    why_it_matters: "Hedged volumes reduce scenario exposure; without this, protection is unknown.",
    category: "freight",
    priority: "high",
  },
  {
    key: "lane_level_spend",
    label: "Lane-level spend breakdown",
    why_it_matters: "Ocean, truckload, and parcel lanes have different rate dynamics; blended rates hide material exposure.",
    category: "freight",
    priority: "critical",
  },
  {
    key: "surcharge_exposure_by_lane",
    label: "Surcharge exposure by lane",
    why_it_matters: "Fuel and peak surcharges compound base rate moves; lane-level detail is required for accurate impact.",
    category: "freight",
    priority: "high",
  },
];

const COMMODITY_MISSING: MissingInputDef[] = [
  {
    key: "steel_spend",
    label: "Annual steel / metals spend",
    why_it_matters: "Establishes the gross dollar base before import or pass-through adjustments.",
    category: "commodity",
    priority: "critical",
  },
  {
    key: "steel_import_exposure_pct",
    label: "Import exposure %",
    why_it_matters: "Only import-sourced volumes are directly subject to tariff shocks.",
    category: "commodity",
    priority: "high",
  },
  {
    key: "supplier_country_exposure",
    label: "Supplier country-of-origin mix",
    why_it_matters: "Tariff rates differ by country; without origin data the effective rate is guessed.",
    category: "commodity",
    priority: "critical",
  },
  {
    key: "purchase_order_exposure",
    label: "Open purchase-order exposure",
    why_it_matters: "In-transit and open POs lock in pricing; the gap to spot determines near-term cash impact.",
    category: "commodity",
    priority: "medium",
  },
];

const CUSTOMER_MISSING: MissingInputDef[] = [
  {
    key: "crm_pipeline",
    label: "CRM pipeline data",
    why_it_matters: "Quantifies prospective revenue that would confirm or refute the demand opportunity.",
    category: "customer",
    priority: "critical",
  },
  {
    key: "quote_volume",
    label: "Recent quote volume trend",
    why_it_matters: "Leading indicator of near-term demand momentum before revenue is booked.",
    category: "customer",
    priority: "high",
  },
  {
    key: "account_demand_trend",
    label: "Account-level demand trend",
    why_it_matters: "Aggregate demand shifts can mask divergent account behaviour; segment clarity is needed.",
    category: "customer",
    priority: "high",
  },
  {
    key: "sales_rep_validation",
    label: "Field / sales rep validation",
    why_it_matters: "Macro signals must be corroborated by customer-facing teams before acting.",
    category: "customer",
    priority: "critical",
  },
];

const COMPETITOR_MISSING: MissingInputDef[] = [
  {
    key: "win_loss_data",
    label: "Win/loss data",
    why_it_matters: "Without deal-level outcomes, competitive pressure is directional at best.",
    category: "competitor",
    priority: "critical",
  },
  {
    key: "pricing_data",
    label: "Competitor pricing data",
    why_it_matters: "Price gaps drive displacement; without observable pricing, exposure magnitude is unknown.",
    category: "competitor",
    priority: "high",
  },
  {
    key: "account_displacement",
    label: "Account displacement signals",
    why_it_matters: "Lost accounts confirm competitive erosion; without them the risk remains hypothetical.",
    category: "competitor",
    priority: "high",
  },
];

const FINANCIAL_MISSING: MissingInputDef[] = [
  {
    key: "annual_revenue",
    label: "Annual revenue",
    why_it_matters: "All percentage-based exposures are meaningless without a revenue anchor.",
    category: "financial",
    priority: "critical",
  },
  {
    key: "gross_margin_pct",
    label: "Gross margin %",
    why_it_matters: "Margin determines the profit impact of any cost shock or revenue upside.",
    category: "financial",
    priority: "critical",
  },
];

// ---------------------------------------------------------------------------
// Category resolver
// ---------------------------------------------------------------------------

function resolveCategory(issue: {
  issue_category?: string | null;
  display_section?: string | null;
}): string {
  const raw = (
    issue.issue_category ??
    issue.display_section ??
    ""
  ).toLowerCase();

  if (/freight|logistic|shipping|ocean|port|carrier/.test(raw)) return "freight";
  if (/tariff|trade|import|duty|section 301/.test(raw)) return "tariff";
  if (/steel|metal|copper|aluminum|commodity/.test(raw)) return "commodity";
  if (/opportunit|demand|customer/.test(raw)) return "opportunity";
  if (/competitor|competition|grainger|msc/.test(raw)) return "competitor";
  if (/watchlist/.test(raw)) return "watchlist";
  return "unknown";
}

// ---------------------------------------------------------------------------
// Public helper: get missing inputs by category string
// ---------------------------------------------------------------------------

export function getMissingInputsForCategory(category: string): MissingInputDef[] {
  const cat = category.toLowerCase();
  if (/freight|logistic/.test(cat)) return FREIGHT_MISSING;
  if (/tariff|steel|copper|aluminum|commodity/.test(cat)) return COMMODITY_MISSING;
  if (/opportunit|demand|customer/.test(cat)) return CUSTOMER_MISSING;
  if (/competitor/.test(cat)) return COMPETITOR_MISSING;
  if (/financial|revenue|margin/.test(cat)) return FINANCIAL_MISSING;
  return [];
}

// ---------------------------------------------------------------------------
// Score map
// ---------------------------------------------------------------------------

const QUALITY_SCORES: Record<EstimateQuality, number> = {
  calibrated: 90,
  partially_calibrated: 60,
  inferred: 40,
  benchmark_based: 35,
  scenario_only: 25,
  needs_validation: 15,
};

const QUALITY_LABELS: Record<EstimateQuality, string> = {
  calibrated: "Calibrated",
  partially_calibrated: "Partially calibrated",
  inferred: "Inferred from public data",
  benchmark_based: "Benchmark-based",
  scenario_only: "Scenario only",
  needs_validation: "Needs company validation",
};

const QUALITY_DESCRIPTIONS: Record<EstimateQuality, string> = {
  calibrated:
    "Estimate is grounded in company-specific data and closely matches actual operating parameters.",
  partially_calibrated:
    "Core spend inputs are available but key exposure variables are estimated from public benchmarks.",
  inferred:
    "Estimate is derived from publicly observable data; company-specific inputs have not been provided.",
  benchmark_based:
    "Estimate is based on industry benchmarks in the absence of company-specific data.",
  scenario_only:
    "No grounding data available; impact reflects a modeled scenario with assumed parameters.",
  needs_validation:
    "Estimate direction is plausible but must be confirmed by internal sales, operations, or finance data.",
};

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function computeEstimateQuality(
  issue: {
    issue_category?: string | null;
    display_section?: string | null;
    methodology?: Record<string, unknown> | null;
    evidence_items?: unknown[] | null;
  },
  calibration?: {
    freight_spend?: number | null;
    freight_spot_rate_exposure_pct?: number | null;
    freight_contract_coverage_pct?: number | null;
    steel_spend?: number | null;
    steel_import_exposure_pct?: number | null;
    pass_through_coverage_pct?: number | null;
    manufacturing_revenue?: number | null;
    construction_revenue?: number | null;
  } | null
): EstimateQualityReport {
  const category = resolveCategory(issue);
  const cal = calibration ?? {};
  const modelStatus =
    (issue.methodology?.model_status as string | undefined) ??
    (issue.methodology?.shock_source as string | undefined) ??
    "unknown";

  let quality: EstimateQuality;
  let missingInputs: MissingInputDef[];
  let caveats: string[];

  // ---- Freight ----------------------------------------------------------------
  if (category === "freight") {
    missingInputs = FREIGHT_MISSING.filter((m) => {
      // lane-level and surcharge are always missing (not in calibration shape)
      if (m.key === "lane_level_spend" || m.key === "surcharge_exposure_by_lane") return true;
      // Show structural calibration fields that are absent
      if (m.key === "freight_spend") return !cal.freight_spend;
      if (m.key === "freight_spot_rate_exposure_pct") return !cal.freight_spot_rate_exposure_pct;
      if (m.key === "freight_contract_coverage_pct") return !cal.freight_contract_coverage_pct;
      return false;
    });

    if (cal.freight_spend && cal.freight_spot_rate_exposure_pct) {
      quality = "partially_calibrated";
    } else if (cal.freight_spend) {
      quality = "inferred";
    } else {
      quality = "scenario_only";
    }

    caveats = [
      "Lane-level spend data would materially improve accuracy.",
      "Surcharge exposure by lane is required for full cost-to-serve modelling.",
    ];

  // ---- Tariff / commodity / steel / copper ------------------------------------
  } else if (category === "tariff" || category === "commodity") {
    missingInputs = COMMODITY_MISSING.filter((m) => {
      if (m.key === "supplier_country_exposure" || m.key === "purchase_order_exposure") return true;
      if (m.key === "steel_spend") return !cal.steel_spend;
      if (m.key === "steel_import_exposure_pct") return !cal.steel_import_exposure_pct;
      return false;
    });

    if (cal.steel_spend && cal.steel_import_exposure_pct) {
      quality = "partially_calibrated";
    } else if (cal.steel_spend) {
      quality = "inferred";
    } else {
      quality = "inferred";
    }

    caveats = [
      "Supplier country-of-origin data is required to apply correct tariff rates.",
      "Open purchase-order exposure determines near-term cash impact vs. longer-run cost basis.",
    ];

  // ---- Opportunity / demand / customer ----------------------------------------
  } else if (category === "opportunity") {
    missingInputs = CUSTOMER_MISSING; // always fully missing

    if (modelStatus === "evidence_backed") {
      quality = "partially_calibrated";
    } else {
      quality = "needs_validation";
    }

    caveats = [
      "CRM pipeline data and field validation are required before acting on any revenue upside.",
      "Macro demand signals must be corroborated at the account level.",
    ];

  // ---- Competitor -------------------------------------------------------------
  } else if (category === "competitor") {
    missingInputs = COMPETITOR_MISSING;

    if (modelStatus === "evidence_backed") {
      quality = "inferred";
    } else {
      quality = "needs_validation";
    }

    caveats = [
      "Win/loss data is necessary to distinguish directional risk from measurable exposure.",
      "Account displacement signals are the most reliable leading indicator of competitive pressure.",
    ];

  // ---- Watchlist --------------------------------------------------------------
  } else if (category === "watchlist") {
    missingInputs = [];
    quality = "scenario_only";
    caveats = [
      "Watchlist items are monitored for emerging signals; no financial impact is modelled yet.",
    ];

  // ---- Fallback ---------------------------------------------------------------
  } else {
    missingInputs = FINANCIAL_MISSING.filter((m) => {
      if (m.key === "annual_revenue") return !cal.manufacturing_revenue && !cal.construction_revenue;
      return true;
    });
    quality = "inferred";
    caveats = [
      "Provide revenue and gross margin to anchor percentage-based exposure estimates.",
    ];
  }

  return {
    quality,
    qualityLabel: QUALITY_LABELS[quality],
    qualityDescription: QUALITY_DESCRIPTIONS[quality],
    missingInputs,
    caveats,
    overallScore: QUALITY_SCORES[quality],
  };
}
