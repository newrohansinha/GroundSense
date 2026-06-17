// Starter metric pack (Part 4) — curated mappings for public/no-key sources.
// We do NOT invent values; adapters fetch + validate real source responses and mark
// any series/indicator that fails as skipped with a reason.

import type { ShockType } from "./types";

export type MappingConfidence = "high" | "medium" | "low";

export type BlsSeriesMapping = {
  series_id: string;
  metric_key: string;
  metric_name: string;
  driver: string;
  shock_type: ShockType;
  unit: string;
  mapping_confidence: MappingConfidence;
  source_url: string;
};

// <= 10 series to respect unregistered BLS v1 limits.
export const BLS_STARTER: BlsSeriesMapping[] = [
  { series_id: "WPU101", metric_key: "bls_wpu101_iron_steel", metric_name: "PPI: Iron and steel", driver: "steel_metal_price_pressure", shock_type: "commodity_price_change", unit: "index", mapping_confidence: "high", source_url: "https://data.bls.gov/timeseries/WPU101" },
  { series_id: "WPU101707", metric_key: "bls_wpu101707_cold_rolled", metric_name: "PPI: Cold rolled steel sheet and strip", driver: "steel_metal_price_pressure", shock_type: "commodity_price_change", unit: "index", mapping_confidence: "high", source_url: "https://data.bls.gov/timeseries/WPU101707" },
  { series_id: "WPU101704", metric_key: "bls_wpu101704_hot_rolled", metric_name: "PPI: Hot rolled steel bars, plates, structural shapes", driver: "steel_metal_price_pressure", shock_type: "commodity_price_change", unit: "index", mapping_confidence: "high", source_url: "https://data.bls.gov/timeseries/WPU101704" },
  { series_id: "WPU10260314", metric_key: "bls_wpu10260314_copper_wire", metric_name: "PPI: Copper wire and cable", driver: "copper_price_pressure", shock_type: "commodity_price_change", unit: "index", mapping_confidence: "high", source_url: "https://data.bls.gov/timeseries/WPU10260314" },
  { series_id: "PCUOMFG--OMFG--", metric_key: "bls_pcu_total_manufacturing", metric_name: "PPI by Industry: Total manufacturing industries", driver: "manufacturing_price_pressure", shock_type: "ppi_change", unit: "index", mapping_confidence: "medium", source_url: "https://data.bls.gov/timeseries/PCUOMFG--OMFG--" },
  { series_id: "PCUATRNWR-ATRNWR-", metric_key: "bls_pcu_transport_warehousing", metric_name: "PPI by Industry: Transportation and warehousing", driver: "freight_logistics_cost", shock_type: "freight_rate_change", unit: "index", mapping_confidence: "medium", source_url: "https://data.bls.gov/timeseries/PCUATRNWR-ATRNWR-" },
  { series_id: "PCU488510488510", metric_key: "bls_pcu_freight_arrangement", metric_name: "PPI by Industry: Freight transportation arrangement", driver: "freight_logistics_cost", shock_type: "freight_rate_change", unit: "index", mapping_confidence: "medium", source_url: "https://data.bls.gov/timeseries/PCU488510488510" },
  { series_id: "WPUFD4", metric_key: "bls_wpufd4_final_demand", metric_name: "PPI: Final demand", driver: "macro_price_pressure", shock_type: "ppi_change", unit: "index", mapping_confidence: "medium", source_url: "https://data.bls.gov/timeseries/WPUFD4" },
];

export type WbIndicatorMapping = {
  indicator: string;
  metric_key: string;
  metric_name: string;
  driver: string;
  shock_type: ShockType;
  unit: string;
  macro_context: boolean; // true => not company-specific on its own
  source_url: string;
};

export const WB_DEFAULT_COUNTRY = "US";

export const WB_STARTER: WbIndicatorMapping[] = [
  { indicator: "NY.GDP.MKTP.KD.ZG", metric_key: "wb_gdp_growth", metric_name: "GDP growth (annual %)", driver: "macro_demand_context", shock_type: "macro_indicator_change", unit: "%", macro_context: true, source_url: "https://data.worldbank.org/indicator/NY.GDP.MKTP.KD.ZG" },
  { indicator: "FP.CPI.TOTL.ZG", metric_key: "wb_cpi_inflation", metric_name: "Inflation, consumer prices (annual %)", driver: "macro_price_pressure", shock_type: "macro_indicator_change", unit: "%", macro_context: true, source_url: "https://data.worldbank.org/indicator/FP.CPI.TOTL.ZG" },
  { indicator: "NE.IMP.GNFS.ZS", metric_key: "wb_imports_pct_gdp", metric_name: "Imports of goods and services (% of GDP)", driver: "trade_flow_context", shock_type: "import_volume_change", unit: "% of GDP", macro_context: true, source_url: "https://data.worldbank.org/indicator/NE.IMP.GNFS.ZS" },
  { indicator: "NE.EXP.GNFS.ZS", metric_key: "wb_exports_pct_gdp", metric_name: "Exports of goods and services (% of GDP)", driver: "trade_flow_context", shock_type: "macro_indicator_change", unit: "% of GDP", macro_context: true, source_url: "https://data.worldbank.org/indicator/NE.EXP.GNFS.ZS" },
  { indicator: "NV.IND.MANF.KD.ZG", metric_key: "wb_manufacturing_growth", metric_name: "Manufacturing, value added (annual % growth)", driver: "manufacturing_demand", shock_type: "macro_indicator_change", unit: "%", macro_context: true, source_url: "https://data.worldbank.org/indicator/NV.IND.MANF.KD.ZG" },
  { indicator: "NV.IND.MANF.ZS", metric_key: "wb_manufacturing_pct_gdp", metric_name: "Manufacturing, value added (% of GDP)", driver: "manufacturing_demand", shock_type: "macro_indicator_change", unit: "% of GDP", macro_context: true, source_url: "https://data.worldbank.org/indicator/NV.IND.MANF.ZS" },
];

// GDELT is context/event discovery only — never numeric exposure.
export const GDELT_STARTER_QUERIES: { id: string; label: string; query: string }[] = [
  { id: "freight_disruption", label: "Freight / port disruption", query: "(freight OR shipping OR \"port congestion\") disruption" },
  { id: "tariffs_trade", label: "Tariffs / trade policy", query: "(tariff OR \"import duty\" OR \"trade policy\")" },
  { id: "steel_prices", label: "Steel prices / tariffs", query: "(steel) (price OR tariff)" },
  { id: "copper_aluminum", label: "Copper / aluminum prices", query: "(copper OR aluminum) price" },
  { id: "industrial_demand", label: "Construction / industrial demand", query: "(construction OR industrial) demand" },
];
