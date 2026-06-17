// Census International Trade API adapter (free API key required).
// Reads VITE_CENSUS_API_KEY only. Missing key => not_configured (never fails).

import type { FetchResult, SourceAdapter } from "../types";
import { defaultKeyStatus, normalizeGeneric, readEnvKey, validateGeneric } from "./adapterBase";

const SOURCE_ID = "census_trade_api";

function key(): string | null {
  return readEnvKey("VITE_CENSUS_API_KEY") ?? readEnvKey("CENSUS_API_KEY");
}

export const censusTradeAdapter: SourceAdapter = {
  sourceId: SOURCE_ID,
  getConnectorStatus: () => defaultKeyStatus(SOURCE_ID),

  async fetchMetrics(): Promise<FetchResult> {
    if (!key()) {
      return { status: "not_configured_key_required", reason: "Not configured — free key required (VITE_CENSUS_API_KEY). Manual trade_flow_template.csv fallback available.", metrics: [] };
    }
    // Configured: live series mapping is deployment-specific (HTS/commodity selection).
    // Until a series mapping is configured we report live with no auto-ingested metrics,
    // keeping behavior safe and explicit rather than inventing endpoints.
    return {
      status: "live",
      reason: "Census Trade API key detected. Configure HTS/commodity series mapping or use trade_flow CSV to ingest specific flows.",
      metrics: [],
    };
  },

  normalizeMetric: (raw) => normalizeGeneric(SOURCE_ID, raw),
  validateMetric: validateGeneric,
  getCoverage: () => ["trade_flows", "imports", "exports"],
  getFallbackTemplate: () => "trade_flow_template.csv",
};
