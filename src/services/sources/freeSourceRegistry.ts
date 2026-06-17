// Free Source Registry (Part 1).
// Declares every free/public data source GroundSense can use, cleanly separated into:
//   - live_public_no_key      (BLS, SEC EDGAR, GDELT, World Bank)
//   - free_key_required       (FRED, Census, USITC, UN Comtrade)
//   - manual_upload           (manual structured metric CSV — always available)
//
// HARD RULES (CLAUDE.md + sprint spec):
//   - Free/public sources only. No paid connectors.
//   - Never assume keys exist; read from env only. Missing key => not_configured.
//   - A source being unavailable must NEVER fail the pipeline.

export type AccessMode =
  | "live_public_no_key"
  | "free_key_required"
  | "free_account_or_credentials_required"
  | "free_key_or_free_tier"
  | "manual_upload";

export type TrustTier =
  | "official_government"
  | "official_multilateral"
  | "official_economic_database"
  | "company_disclosure"
  | "open_news_event_dataset"
  | "user_imported_structured_data";

// Precise status taxonomy (Part 1) — every state tells the user what to do next.
export type SourceStatus =
  | "live"                          // reachable + refreshed with usable metrics
  | "live_no_metrics"               // reachable, but no mapping produced usable metrics
  | "needs_user_agent"              // SEC: User-Agent absent
  | "needs_server_proxy"            // reachable in principle but browser can't fetch (e.g. SEC UA header)
  | "not_configured_key_required"   // FRED/Census/USITC/UN: free key/account required, absent
  | "manual_only"                   // manual structured CSV
  | "context_only"                  // GDELT: events/context, not numeric metrics
  | "skipped"                       // intentionally skipped with reason
  | "error"                         // attempted and failed unexpectedly
  | "unknown";

export type SourceCategory =
  | "commodities"
  | "macro"
  | "producer_prices"
  | "company_filings"
  | "news_events"
  | "macroeconomic"
  | "trade_flows"
  | "tariff_trade"
  | "all";

export type FreeSource = {
  id: string;
  name: string;
  category: SourceCategory;
  source_type: string;
  trust_tier: TrustTier;
  access_mode: AccessMode;
  requires_key: boolean;
  // Env var(s) the credential-aware adapters look for. Client-side only VITE_* are readable.
  env_key_names: string[];
  coverage_domains: string[];
  supported_metrics: string[];
  notes: string;
  fallback_csv_template: string | null;
  // GDELT and World Bank (broad) are context-only — must NOT directly drive $ exposure.
  numeric_exposure_allowed: boolean;
};

// Reads a key from the Vite client env. Accepts both the bare name and the VITE_ prefixed
// variant; server-only (non-VITE) names are simply undefined client-side → not_configured.
export function readEnvKey(name: string): string | null {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
  const direct = env[name];
  const prefixed = name.startsWith("VITE_") ? undefined : env[`VITE_${name}`];
  const v = direct ?? prefixed ?? null;
  return v && String(v).trim().length > 0 ? String(v).trim() : null;
}

// True if at least one of the source's env keys is configured.
export function hasConfiguredKey(source: FreeSource): boolean {
  if (!source.requires_key) return true;
  return source.env_key_names.some((k) => readEnvKey(k) !== null);
}

export const FREE_SOURCES: FreeSource[] = [
  {
    id: "bls_public_api",
    name: "BLS Public Data API",
    category: "producer_prices",
    source_type: "official_statistics_api",
    trust_tier: "official_government",
    access_mode: "live_public_no_key",
    requires_key: false,
    env_key_names: [],
    coverage_domains: ["steel", "metals", "commodities", "macro", "producer_prices"],
    supported_metrics: ["ppi_change", "commodity_price_change", "macro_indicator_change"],
    notes: "BLS Public Data API v1 — no registration for basic series. Producer Price Index series.",
    fallback_csv_template: "commodity_price_template.csv",
    numeric_exposure_allowed: true,
  },
  {
    id: "sec_edgar_api",
    name: "SEC EDGAR",
    category: "company_filings",
    source_type: "company_disclosure_api",
    trust_tier: "company_disclosure",
    access_mode: "live_public_no_key",
    requires_key: false,
    env_key_names: ["VITE_SEC_EDGAR_USER_AGENT"],
    coverage_domains: ["company_filings", "financial_anchors"],
    supported_metrics: ["company_financial_change"],
    notes: "Public SEC EDGAR company facts/submissions. Requires a descriptive User-Agent header. Lower priority than company-provided calibration.",
    fallback_csv_template: "company_filing_metric_template.csv",
    numeric_exposure_allowed: true,
  },
  {
    id: "gdelt_doc_api",
    name: "GDELT Doc API",
    category: "news_events",
    source_type: "open_event_dataset_api",
    trust_tier: "open_news_event_dataset",
    access_mode: "live_public_no_key",
    requires_key: false,
    env_key_names: [],
    coverage_domains: ["news_events", "geopolitical"],
    supported_metrics: ["news_event_context"],
    notes: "Context/corroboration only. GDELT counts, tone, or article volume must NOT become dollar exposure.",
    fallback_csv_template: null,
    numeric_exposure_allowed: false,
  },
  {
    id: "world_bank_indicators",
    name: "World Bank Indicators",
    category: "macroeconomic",
    source_type: "official_indicator_api",
    trust_tier: "official_multilateral",
    access_mode: "live_public_no_key",
    requires_key: false,
    env_key_names: [],
    coverage_domains: ["macro", "trade", "demand"],
    supported_metrics: ["macro_indicator_change"],
    notes: "Macro context. Only creates verified shocks when an explicit indicator→driver mapping exists; otherwise context-only.",
    fallback_csv_template: "macro_indicator_template.csv",
    numeric_exposure_allowed: false,
  },
  {
    id: "fred_api",
    name: "FRED",
    category: "macroeconomic",
    source_type: "official_economic_api",
    trust_tier: "official_economic_database",
    access_mode: "free_key_required",
    requires_key: true,
    env_key_names: ["VITE_FRED_API_KEY", "FRED_API_KEY"],
    coverage_domains: ["commodities", "macro", "rates", "industrial_production"],
    supported_metrics: ["commodity_price_change", "macro_indicator_change"],
    notes: "Free API key required. Set VITE_FRED_API_KEY to enable live fetch. Manual commodity/macro CSV fallback otherwise.",
    fallback_csv_template: "commodity_price_template.csv",
    numeric_exposure_allowed: true,
  },
  {
    id: "census_trade_api",
    name: "Census International Trade API",
    category: "trade_flows",
    source_type: "official_trade_api",
    trust_tier: "official_government",
    access_mode: "free_key_required",
    requires_key: true,
    env_key_names: ["VITE_CENSUS_API_KEY", "CENSUS_API_KEY"],
    coverage_domains: ["trade_flows", "imports", "exports"],
    supported_metrics: ["import_volume_change"],
    notes: "Free API key required. Set VITE_CENSUS_API_KEY to enable. Manual trade_flow CSV fallback otherwise.",
    fallback_csv_template: "trade_flow_template.csv",
    numeric_exposure_allowed: true,
  },
  {
    id: "usitc_dataweb_api",
    name: "USITC DataWeb",
    category: "tariff_trade",
    source_type: "official_tariff_api",
    trust_tier: "official_government",
    access_mode: "free_account_or_credentials_required",
    requires_key: true,
    env_key_names: ["VITE_USITC_API_KEY", "USITC_API_KEY", "USITC_USERNAME"],
    coverage_domains: ["tariff", "trade", "hts"],
    supported_metrics: ["tariff_rate_change", "import_volume_change"],
    notes: "Free account/credentials required. Manual tariff_metric CSV fallback — tariff numbers can be verified from official manual CSV even when the API is unavailable.",
    fallback_csv_template: "tariff_metric_template.csv",
    numeric_exposure_allowed: true,
  },
  {
    id: "un_comtrade_api",
    name: "UN Comtrade",
    category: "trade_flows",
    source_type: "official_trade_api",
    trust_tier: "official_multilateral",
    access_mode: "free_key_or_free_tier",
    requires_key: true,
    env_key_names: ["VITE_UN_COMTRADE_API_KEY", "UN_COMTRADE_API_KEY"],
    coverage_domains: ["trade_flows"],
    supported_metrics: ["import_volume_change"],
    notes: "Free tier/key may be required. Optional. Manual trade_flow CSV fallback otherwise.",
    fallback_csv_template: "trade_flow_template.csv",
    numeric_exposure_allowed: true,
  },
  {
    id: "manual_structured_metric_csv",
    name: "Manual Structured Metric CSV",
    category: "all",
    source_type: "manual_structured_upload",
    trust_tier: "user_imported_structured_data",
    access_mode: "manual_upload",
    requires_key: false,
    env_key_names: [],
    coverage_domains: ["tariff", "freight", "commodities", "trade_flows", "macro", "company_filings"],
    supported_metrics: [
      "tariff_rate_change",
      "freight_rate_change",
      "commodity_price_change",
      "import_volume_change",
      "macro_indicator_change",
      "company_financial_change",
    ],
    notes: "Always available. Structured official metrics uploaded by the user. Trusted more than article-only claims; less than official live APIs unless marked official/user-approved.",
    fallback_csv_template: "self",
    numeric_exposure_allowed: true,
  },
];

// Paid sources GroundSense explicitly does NOT support (surfaced in UI as such).
export const UNSUPPORTED_PAID_SOURCES = [
  "Freightos", "Xeneta", "Bloomberg", "Refinitiv", "S&P Global", "FactSet",
  "Panjiva", "ImportGenius", "Paid NewsAPI tiers", "Paid Event Registry plans",
  "Paid supplier-risk feeds", "Paid freight benchmark APIs",
];

export function getSourceById(id: string): FreeSource | undefined {
  return FREE_SOURCES.find((s) => s.id === id);
}

export type SourceRegistryEntry = FreeSource & {
  configured: boolean;
  // Best-effort status before any live probe: live (no-key) / not_configured (key missing) / manual_only.
  baseline_status: SourceStatus;
};

// Snapshot the registry with current configuration state (pure; no network).
export function getRegistrySnapshot(): SourceRegistryEntry[] {
  return FREE_SOURCES.map((s) => {
    const configured = hasConfiguredKey(s);
    let baseline_status: SourceStatus;
    if (s.access_mode === "manual_upload") baseline_status = "manual_only";
    else if (s.id === "gdelt_doc_api") baseline_status = "context_only";
    else if (s.id === "sec_edgar_api") baseline_status = readEnvKey("VITE_SEC_EDGAR_USER_AGENT") ? "live" : "needs_user_agent";
    else if (s.requires_key && !configured) baseline_status = "not_configured_key_required";
    else baseline_status = "live";
    return { ...s, configured, baseline_status };
  });
}

export function summarizeRegistry() {
  const snap = getRegistrySnapshot();
  return {
    livePublicNoKey: snap.filter((s) => s.access_mode === "live_public_no_key").length,
    freeKeyConfigured: snap.filter((s) => s.requires_key && s.configured).length,
    freeKeyNotConfigured: snap.filter((s) => s.requires_key && !s.configured).length,
    manual: snap.filter((s) => s.access_mode === "manual_upload").length,
    total: snap.length,
  };
}
