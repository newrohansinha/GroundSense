// UN Comtrade adapter (free tier/key may be required). Optional.
// Reads VITE_UN_COMTRADE_API_KEY only. Missing key => not_configured (never fails).

import type { FetchResult, SourceAdapter } from "../types";
import { defaultKeyStatus, normalizeGeneric, readEnvKey, validateGeneric } from "./adapterBase";

const SOURCE_ID = "un_comtrade_api";

function key(): string | null {
  return readEnvKey("VITE_UN_COMTRADE_API_KEY") ?? readEnvKey("UN_COMTRADE_API_KEY");
}

export const unComtradeAdapter: SourceAdapter = {
  sourceId: SOURCE_ID,
  getConnectorStatus: () => defaultKeyStatus(SOURCE_ID),

  async fetchMetrics(): Promise<FetchResult> {
    if (!key()) {
      return { status: "not_configured_key_required", reason: "Not configured — free key/tier required (VITE_UN_COMTRADE_API_KEY). Manual trade_flow_template.csv fallback available.", metrics: [] };
    }
    return {
      status: "live",
      reason: "UN Comtrade key detected. Configure reporter/partner/commodity mapping or use trade_flow CSV.",
      metrics: [],
    };
  },

  normalizeMetric: (raw) => normalizeGeneric(SOURCE_ID, raw),
  validateMetric: validateGeneric,
  getCoverage: () => ["trade_flows"],
  getFallbackTemplate: () => "trade_flow_template.csv",
};
