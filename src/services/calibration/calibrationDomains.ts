// Calibration Center — domain registry.
// One config object per calibration domain drives CSV columns, validation,
// sample data, manual-entry fields, scoring, and impact across the whole workbench.
// Pure data + helpers. No Supabase, no React.

import type { ColumnDef, DomainDef, DomainKey } from "./types";

const FREIGHT: DomainDef = {
  key: "freight",
  label: "Freight & Logistics",
  shortLabel: "Freight",
  category: "freight",
  tableName: "freight_lane_exposure",
  templateFile: "freight_lane_template.csv",
  blurb: "Lane-level freight spend, spot/contract split, and surcharge exposure.",
  columns: [
    { key: "lane_name", label: "Lane name", type: "text", required: true, scoringWeight: 2 },
    { key: "origin", label: "Origin", type: "text", recommended: true },
    { key: "destination", label: "Destination", type: "text", recommended: true },
    { key: "carrier", label: "Carrier", type: "text", recommended: true },
    { key: "mode", label: "Mode", type: "enum", enumValues: ["ocean", "air", "truckload", "ltl", "rail", "intermodal"], scoringWeight: 1 },
    { key: "annual_spend", label: "Annual lane spend", type: "money", required: true, unit: "$", scoringWeight: 3 },
    { key: "spot_or_contract", label: "Spot or contract", type: "enum", enumValues: ["spot", "contract", "mixed", "unknown"], scoringWeight: 2 },
    { key: "contract_coverage_pct", label: "Contract coverage", type: "percent", unit: "%", scoringWeight: 1 },
    { key: "surcharge_exposed", label: "Surcharge exposed", type: "boolean", scoringWeight: 1 },
    { key: "surcharge_type", label: "Surcharge type", type: "text" },
    { key: "volume_units", label: "Volume units", type: "number" },
    { key: "volume_unit_label", label: "Volume unit label", type: "text" },
    { key: "lead_time_days", label: "Lead time (days)", type: "number", unit: "days" },
    { key: "priority_lane", label: "Priority lane", type: "boolean" },
    { key: "notes", label: "Notes", type: "text" },
  ],
  sampleRows: [
    { lane_name: "Shanghai → LA inbound", origin: "Shanghai", destination: "Los Angeles", carrier: "Maersk", mode: "ocean", annual_spend: 18500000, spot_or_contract: "spot", contract_coverage_pct: 35, surcharge_exposed: true, surcharge_type: "peak season", volume_units: 4200, volume_unit_label: "TEU", lead_time_days: 28, priority_lane: true, notes: "Highest spot exposure" },
    { lane_name: "Rotterdam → Houston", origin: "Rotterdam", destination: "Houston", carrier: "MSC", mode: "ocean", annual_spend: 9200000, spot_or_contract: "contract", contract_coverage_pct: 85, surcharge_exposed: false, surcharge_type: "", volume_units: 1800, volume_unit_label: "TEU", lead_time_days: 24, priority_lane: false, notes: "" },
    { lane_name: "Chicago → Dallas TL", origin: "Chicago", destination: "Dallas", carrier: "JB Hunt", mode: "truckload", annual_spend: 6400000, spot_or_contract: "mixed", contract_coverage_pct: 60, surcharge_exposed: true, surcharge_type: "fuel", volume_units: 5200, volume_unit_label: "loads", lead_time_days: 3, priority_lane: true, notes: "Fuel-surcharge sensitive" },
    { lane_name: "Atlanta → Memphis LTL", origin: "Atlanta", destination: "Memphis", carrier: "Old Dominion", mode: "ltl", annual_spend: 2100000, spot_or_contract: "contract", contract_coverage_pct: 90, surcharge_exposed: false, surcharge_type: "", volume_units: 12000, volume_unit_label: "shipments", lead_time_days: 2, priority_lane: false, notes: "" },
    { lane_name: "Busan → Tacoma", origin: "Busan", destination: "Tacoma", carrier: "Hapag-Lloyd", mode: "ocean", annual_spend: 7800000, spot_or_contract: "spot", contract_coverage_pct: 40, surcharge_exposed: true, surcharge_type: "congestion", volume_units: 1500, volume_unit_label: "TEU", lead_time_days: 30, priority_lane: true, notes: "Congestion-exposed" },
  ],
  criticalInputs: ["Lane-level freight spend", "Spot/contract split", "Surcharge exposure by lane", "Actual mode mix"],
  affects: ["Freight risk estimate", "Logistics action ROI", "Scenario editor", "Forecast reliability"],
  nextBestAction: "Upload freight lane CSV",
  improvesIssues: ["freight", "container", "shipping", "logistics"],
  naturalKeyFields: ["lane_name"],
};

const SUPPLIER: DomainDef = {
  key: "supplier",
  label: "Supplier / Procurement",
  shortLabel: "Supplier",
  category: "supplier_procurement",
  tableName: "supplier_procurement_exposure",
  templateFile: "supplier_procurement_template.csv",
  blurb: "Supplier country-of-origin, tariff exposure, pass-through, and open PO exposure.",
  columns: [
    { key: "supplier_name", label: "Supplier name", type: "text", required: true, scoringWeight: 2 },
    { key: "country_of_origin", label: "Country of origin", type: "text", recommended: true, scoringWeight: 2 },
    { key: "supplier_region", label: "Region", type: "text" },
    { key: "category", label: "Category", type: "text" },
    { key: "commodity", label: "Commodity", type: "text", scoringWeight: 1 },
    { key: "annual_spend", label: "Annual spend", type: "money", required: true, unit: "$", scoringWeight: 3 },
    { key: "tariff_exposed", label: "Tariff exposed", type: "boolean", scoringWeight: 2 },
    { key: "tariff_rate", label: "Tariff rate", type: "percent", unit: "%" },
    { key: "pass_through_terms", label: "Pass-through terms", type: "text", scoringWeight: 1 },
    { key: "lead_time_days", label: "Lead time (days)", type: "number", unit: "days" },
    { key: "single_source", label: "Single source", type: "boolean", scoringWeight: 1 },
    { key: "open_po_exposure", label: "Open PO exposure", type: "money", unit: "$", scoringWeight: 1 },
    { key: "sku_count", label: "SKU count", type: "number" },
    { key: "landed_cost_updated", label: "Landed cost updated", type: "boolean", scoringWeight: 1 },
    { key: "contract_expiry_date", label: "Contract expiry", type: "date" },
    { key: "notes", label: "Notes", type: "text" },
  ],
  sampleRows: [
    { supplier_name: "Nippon Steel", country_of_origin: "Japan", supplier_region: "APAC", category: "Raw metal", commodity: "Steel", annual_spend: 28000000, tariff_exposed: true, tariff_rate: 15, pass_through_terms: "60-day lag", lead_time_days: 45, single_source: false, open_po_exposure: 4200000, sku_count: 320, landed_cost_updated: false, contract_expiry_date: "2026-12-31", notes: "Largest steel supplier" },
    { supplier_name: "Aurubis", country_of_origin: "Germany", supplier_region: "EU", category: "Raw metal", commodity: "Copper", annual_spend: 14500000, tariff_exposed: true, tariff_rate: 12, pass_through_terms: "spot index", lead_time_days: 38, single_source: true, open_po_exposure: 2100000, sku_count: 95, landed_cost_updated: false, contract_expiry_date: "2026-09-30", notes: "Single-source copper" },
    { supplier_name: "Alcoa", country_of_origin: "USA", supplier_region: "NA", category: "Raw metal", commodity: "Aluminum", annual_spend: 11200000, tariff_exposed: false, tariff_rate: 0, pass_through_terms: "fixed", lead_time_days: 20, single_source: false, open_po_exposure: 800000, sku_count: 140, landed_cost_updated: true, contract_expiry_date: "2027-03-31", notes: "Domestic" },
    { supplier_name: "POSCO", country_of_origin: "South Korea", supplier_region: "APAC", category: "Raw metal", commodity: "Steel", annual_spend: 9600000, tariff_exposed: true, tariff_rate: 15, pass_through_terms: "90-day lag", lead_time_days: 50, single_source: false, open_po_exposure: 1500000, sku_count: 210, landed_cost_updated: false, contract_expiry_date: "2026-11-15", notes: "" },
    { supplier_name: "Wieland", country_of_origin: "Germany", supplier_region: "EU", category: "Components", commodity: "Copper", annual_spend: 5400000, tariff_exposed: true, tariff_rate: 12, pass_through_terms: "quarterly", lead_time_days: 35, single_source: false, open_po_exposure: 600000, sku_count: 80, landed_cost_updated: false, contract_expiry_date: "2027-01-31", notes: "" },
  ],
  criticalInputs: ["Supplier country-of-origin", "Open PO exposure", "SKU landed cost", "Single-source exposure"],
  affects: ["Tariff/steel exposure estimate", "Procurement action", "Scenario editor", "Forecast reliability"],
  nextBestAction: "Upload supplier country-of-origin CSV",
  improvesIssues: ["tariff", "steel", "copper", "aluminum", "supplier", "procurement", "commodity"],
  naturalKeyFields: ["supplier_name"],
};

const CRM: DomainDef = {
  key: "crm",
  label: "Customer / CRM",
  shortLabel: "CRM",
  category: "crm_demand",
  tableName: "crm_demand_signals",
  templateFile: "crm_demand_template.csv",
  blurb: "Segment pipeline, quote/order growth, and account-level demand evidence.",
  columns: [
    { key: "segment", label: "Segment", type: "text", required: true, scoringWeight: 2 },
    { key: "account_name", label: "Account name", type: "text", recommended: true, scoringWeight: 1 },
    { key: "customer_region", label: "Region", type: "text" },
    { key: "industry", label: "Industry", type: "text" },
    { key: "pipeline_value", label: "Pipeline value", type: "money", unit: "$", scoringWeight: 2 },
    { key: "quote_volume", label: "Quote volume", type: "number", scoringWeight: 1 },
    { key: "quote_volume_change_pct", label: "Quote volume change", type: "percent", unit: "%", scoringWeight: 2 },
    { key: "order_growth_pct", label: "Order growth", type: "percent", unit: "%", scoringWeight: 2 },
    { key: "revenue_last_period", label: "Revenue last period", type: "money", unit: "$" },
    { key: "revenue_current_period", label: "Revenue current period", type: "money", unit: "$", scoringWeight: 1 },
    { key: "win_rate", label: "Win rate", type: "percent", unit: "%" },
    { key: "churn_risk_score", label: "Churn risk score", type: "percent", unit: "%" },
    { key: "sales_owner", label: "Sales owner", type: "text" },
    { key: "signal_period", label: "Signal period", type: "text", recommended: true },
    { key: "source_system", label: "Source system", type: "text" },
    { key: "notes", label: "Notes", type: "text" },
  ],
  sampleRows: [
    { segment: "Manufacturing", account_name: "Midwest Tooling Co", customer_region: "Midwest", industry: "Metal fabrication", pipeline_value: 4200000, quote_volume: 320, quote_volume_change_pct: 18, order_growth_pct: 12, revenue_last_period: 8800000, revenue_current_period: 9850000, win_rate: 42, churn_risk_score: 15, sales_owner: "J. Alvarez", signal_period: "Q2 2026", source_system: "Salesforce", notes: "Strong quote growth" },
    { segment: "Manufacturing", account_name: "Great Lakes Assembly", customer_region: "Midwest", industry: "Machinery", pipeline_value: 2600000, quote_volume: 180, quote_volume_change_pct: 9, order_growth_pct: 7, revenue_last_period: 5400000, revenue_current_period: 5780000, win_rate: 38, churn_risk_score: 22, sales_owner: "K. Singh", signal_period: "Q2 2026", source_system: "Salesforce", notes: "" },
    { segment: "Construction", account_name: "Sunbelt Builders", customer_region: "Southeast", industry: "Commercial construction", pipeline_value: 1900000, quote_volume: 95, quote_volume_change_pct: 4, order_growth_pct: 2, revenue_last_period: 4100000, revenue_current_period: 4180000, win_rate: 31, churn_risk_score: 28, sales_owner: "M. Reyes", signal_period: "Q2 2026", source_system: "HubSpot", notes: "Flat demand" },
  ],
  criticalInputs: ["Segment pipeline", "Quote/order growth", "Account-level demand", "Win rate by segment"],
  affects: ["Demand opportunity promotion", "Customer/revenue model", "Forecast reliability"],
  nextBestAction: "Upload CRM quote/order trend CSV",
  improvesIssues: ["demand", "manufacturing", "construction", "opportunity", "customer"],
  naturalKeyFields: ["segment", "account_name"],
};

const FINANCIAL: DomainDef = {
  key: "financial",
  label: "Financial Anchors",
  shortLabel: "Financial",
  category: "financial_anchor",
  tableName: "financial_anchors",
  templateFile: "financial_anchor_template.csv",
  blurb: "Revenue, margin, COGS, freight and commodity spend anchors per period.",
  columns: [
    { key: "period", label: "Period", type: "text", required: true, scoringWeight: 1 },
    { key: "revenue", label: "Revenue", type: "money", unit: "$", recommended: true, scoringWeight: 3 },
    { key: "gross_margin", label: "Gross margin", type: "money", unit: "$" },
    { key: "gross_margin_pct", label: "Gross margin %", type: "percent", unit: "%", scoringWeight: 2 },
    { key: "ebitda", label: "EBITDA", type: "money", unit: "$" },
    { key: "eps", label: "EPS", type: "number", unit: "$" },
    { key: "cogs", label: "COGS", type: "money", unit: "$", scoringWeight: 1 },
    { key: "sgna", label: "SG&A", type: "money", unit: "$" },
    { key: "working_capital", label: "Working capital", type: "money", unit: "$" },
    { key: "inventory_turns", label: "Inventory turns", type: "number" },
    { key: "freight_spend", label: "Freight spend", type: "money", unit: "$", scoringWeight: 1 },
    { key: "commodity_spend", label: "Commodity spend", type: "money", unit: "$", scoringWeight: 1 },
    { key: "operating_income", label: "Operating income", type: "money", unit: "$" },
    { key: "cash_flow", label: "Cash flow", type: "money", unit: "$" },
  ],
  sampleRows: [
    { period: "FY2025", revenue: 7600000000, gross_margin: 3496000000, gross_margin_pct: 46, ebitda: 1520000000, eps: 2.05, cogs: 4104000000, sgna: 1900000000, working_capital: 2100000000, inventory_turns: 3.8, freight_spend: 104000000, commodity_spend: 138000000, operating_income: 1480000000, cash_flow: 1180000000 },
    { period: "Q1 2026", revenue: 1980000000, gross_margin: 910000000, gross_margin_pct: 46, ebitda: 396000000, eps: 0.52, cogs: 1070000000, sgna: 490000000, working_capital: 2150000000, inventory_turns: 3.7, freight_spend: 27000000, commodity_spend: 35000000, operating_income: 385000000, cash_flow: 300000000 },
  ],
  criticalInputs: ["Revenue anchor", "Gross margin %", "Freight spend", "Commodity spend"],
  affects: ["All percentage-based exposure estimates", "Margin sensitivity", "Scenario editor"],
  nextBestAction: "Upload latest financial anchor CSV",
  improvesIssues: ["margin", "revenue", "financial"],
  naturalKeyFields: ["period"],
};

const INVENTORY: DomainDef = {
  key: "inventory",
  label: "Inventory & Service Levels",
  shortLabel: "Inventory",
  category: "inventory_service",
  tableName: "inventory_service_levels",
  templateFile: "inventory_service_template.csv",
  blurb: "Inventory value, fill rate, backorders, and supplier lead-time exposure.",
  columns: [
    { key: "product_category", label: "Product category", type: "text", required: true, scoringWeight: 2 },
    { key: "location", label: "Location", type: "text" },
    { key: "inventory_value", label: "Inventory value", type: "money", unit: "$", scoringWeight: 2 },
    { key: "inventory_units", label: "Inventory units", type: "number" },
    { key: "fill_rate_pct", label: "Fill rate", type: "percent", unit: "%", scoringWeight: 2 },
    { key: "backorder_rate_pct", label: "Backorder rate", type: "percent", unit: "%", scoringWeight: 2 },
    { key: "service_level_sla_pct", label: "Service-level SLA", type: "percent", unit: "%", scoringWeight: 1 },
    { key: "safety_stock_days", label: "Safety stock (days)", type: "number", unit: "days" },
    { key: "supplier_lead_time_days", label: "Supplier lead time (days)", type: "number", unit: "days", scoringWeight: 1 },
    { key: "stockout_events", label: "Stockout events", type: "number" },
    { key: "notes", label: "Notes", type: "text" },
  ],
  sampleRows: [
    { product_category: "Fasteners", location: "Winona DC", inventory_value: 84000000, inventory_units: 1200000, fill_rate_pct: 96, backorder_rate_pct: 3.2, service_level_sla_pct: 98, safety_stock_days: 21, supplier_lead_time_days: 45, stockout_events: 12, notes: "Core SKUs" },
    { product_category: "Tools", location: "Indianapolis DC", inventory_value: 36000000, inventory_units: 280000, fill_rate_pct: 92, backorder_rate_pct: 5.8, service_level_sla_pct: 95, safety_stock_days: 14, supplier_lead_time_days: 60, stockout_events: 24, notes: "Longer lead time" },
    { product_category: "Safety", location: "Dallas DC", inventory_value: 22000000, inventory_units: 410000, fill_rate_pct: 97, backorder_rate_pct: 2.1, service_level_sla_pct: 99, safety_stock_days: 25, supplier_lead_time_days: 30, stockout_events: 6, notes: "" },
  ],
  criticalInputs: ["Inventory value by category", "Fill rate", "Backorder rate", "Supplier lead time"],
  affects: ["Service-level / supply-disruption issues", "Working-capital exposure", "Watchlist reliability"],
  nextBestAction: "Upload inventory & service-level CSV",
  improvesIssues: ["fill rate", "backorder", "service", "supply", "inventory", "stockout"],
  naturalKeyFields: ["product_category", "location"],
};

const COMPETITIVE: DomainDef = {
  key: "competitive",
  label: "Competitive / Win-Loss",
  shortLabel: "Competitive",
  category: "competitive",
  tableName: "competitive_signals",
  templateFile: "competitive_win_loss_template.csv",
  blurb: "Win/loss outcomes, price gaps, and account-displacement signals.",
  columns: [
    { key: "competitor_name", label: "Competitor", type: "text", required: true, scoringWeight: 2 },
    { key: "segment", label: "Segment", type: "text", scoringWeight: 1 },
    { key: "account_name", label: "Account", type: "text", recommended: true },
    { key: "win_loss", label: "Win/loss", type: "enum", enumValues: ["win", "loss", "unknown"], scoringWeight: 2 },
    { key: "deal_value", label: "Deal value", type: "money", unit: "$", scoringWeight: 2 },
    { key: "price_gap_pct", label: "Price gap", type: "percent", unit: "%", scoringWeight: 1 },
    { key: "churn_reason", label: "Churn reason", type: "text" },
    { key: "displacement_risk", label: "Displacement risk", type: "text" },
    { key: "signal_period", label: "Signal period", type: "text", recommended: true },
    { key: "notes", label: "Notes", type: "text" },
  ],
  sampleRows: [
    { competitor_name: "Grainger", segment: "Manufacturing", account_name: "Midwest Tooling Co", win_loss: "win", deal_value: 1200000, price_gap_pct: -3, churn_reason: "", displacement_risk: "low", signal_period: "Q2 2026", notes: "Retained on service" },
    { competitor_name: "MSC", segment: "Manufacturing", account_name: "Great Lakes Assembly", win_loss: "loss", deal_value: 850000, price_gap_pct: 6, churn_reason: "price", displacement_risk: "high", signal_period: "Q2 2026", notes: "Lost on price" },
    { competitor_name: "Applied", segment: "Construction", account_name: "Sunbelt Builders", win_loss: "unknown", deal_value: 600000, price_gap_pct: 2, churn_reason: "", displacement_risk: "medium", signal_period: "Q2 2026", notes: "" },
  ],
  criticalInputs: ["Win/loss by account", "Price gap vs competitor", "At-risk account value"],
  affects: ["Competitive pressure issue", "Account retention exposure"],
  nextBestAction: "Upload win/loss CSV",
  improvesIssues: ["competitor", "grainger", "msc", "win", "loss", "displacement"],
  naturalKeyFields: ["competitor_name", "account_name"],
};

const OUTCOMES: DomainDef = {
  key: "outcomes",
  label: "Outcomes & Forecast Accuracy",
  shortLabel: "Outcomes",
  category: "outcome_history",
  tableName: "forecast_outcomes",
  templateFile: "forecast_outcomes_template.csv",
  blurb: "Resolved forecast outcomes that train future model accuracy.",
  columns: [
    { key: "issue_title", label: "Linked issue", type: "text", required: true, scoringWeight: 2 },
    { key: "issue_type", label: "Issue type", type: "enum", enumValues: ["risk", "opportunity", "operating_change", "watchlist"] },
    { key: "forecast_date", label: "Forecast date", type: "date", recommended: true },
    { key: "predicted_low", label: "Predicted low", type: "money", unit: "$" },
    { key: "predicted_mid", label: "Predicted mid", type: "money", unit: "$", scoringWeight: 1 },
    { key: "predicted_high", label: "Predicted high", type: "money", unit: "$" },
    { key: "actual_impact", label: "Actual impact", type: "money", unit: "$", required: true, scoringWeight: 3 },
    { key: "actual_metric", label: "Actual metric", type: "text" },
    { key: "action_taken", label: "Action taken", type: "text" },
    { key: "protected_value", label: "Protected value", type: "money", unit: "$" },
    { key: "outcome_status", label: "Outcome status", type: "enum", enumValues: ["resolved", "accurate", "overestimated", "underestimated", "missed"], scoringWeight: 1 },
    { key: "accuracy_class", label: "Accuracy class", type: "text" },
    { key: "resolved_at", label: "Resolved date", type: "date" },
    { key: "notes", label: "Notes", type: "text" },
  ],
  sampleRows: [
    { issue_title: "Surging Container Freight Rates", issue_type: "risk", forecast_date: "2026-03-01", predicted_low: 756000, predicted_mid: 1900000, predicted_high: 3000000, actual_impact: 1650000, actual_metric: "incremental freight cost", action_taken: "Renegotiated 3 spot lanes", protected_value: 380000, outcome_status: "accurate", accuracy_class: "in_range", resolved_at: "2026-05-20", notes: "Within modeled range" },
  ],
  criticalInputs: ["Resolved forecast outcomes", "Actual vs modeled impact", "Protected value captured"],
  affects: ["Forecast accuracy scoring", "Model calibration history", "Board credibility"],
  nextBestAction: "Record an actual outcome for a resolved forecast",
  improvesIssues: [],
  naturalKeyFields: ["issue_title"],
};

export const CALIBRATION_DOMAINS: DomainDef[] = [
  FREIGHT,
  SUPPLIER,
  CRM,
  FINANCIAL,
  INVENTORY,
  COMPETITIVE,
  OUTCOMES,
];

export const DOMAIN_BY_KEY: Record<DomainKey, DomainDef> = CALIBRATION_DOMAINS.reduce(
  (acc, d) => {
    acc[d.key] = d;
    return acc;
  },
  {} as Record<DomainKey, DomainDef>
);

export function getDomain(key: DomainKey): DomainDef {
  return DOMAIN_BY_KEY[key];
}

export function requiredColumns(domain: DomainDef): ColumnDef[] {
  return domain.columns.filter((c) => c.required);
}
