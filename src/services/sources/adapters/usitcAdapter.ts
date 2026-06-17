// USITC DataWeb adapter (free account/credentials required).
// Reads VITE_USITC_API_KEY only. Missing credentials => not_configured (never fails).
// Tariff numbers can still be verified via the manual tariff_metric CSV fallback.

import type { FetchResult, SourceAdapter } from "../types";
import { defaultKeyStatus, normalizeGeneric, readEnvKey, validateGeneric } from "./adapterBase";

const SOURCE_ID = "usitc_dataweb_api";

function credentials(): string | null {
  return readEnvKey("VITE_USITC_API_KEY") ?? readEnvKey("USITC_API_KEY") ?? readEnvKey("USITC_USERNAME");
}

export const usitcAdapter: SourceAdapter = {
  sourceId: SOURCE_ID,
  getConnectorStatus: () => defaultKeyStatus(SOURCE_ID),

  async fetchMetrics(): Promise<FetchResult> {
    if (!credentials()) {
      return {
        status: "not_configured_key_required",
        reason: "Not configured — free account/credentials required (VITE_USITC_API_KEY or USITC credentials). Tariff metrics can still be verified via manual tariff_metric_template.csv.",
        metrics: [],
      };
    }
    return {
      status: "live",
      reason: "USITC credentials detected. Configure HTS/tariff query mapping or use tariff_metric CSV to ingest specific tariff lines.",
      metrics: [],
    };
  },

  normalizeMetric: (raw) => normalizeGeneric(SOURCE_ID, raw),
  validateMetric: validateGeneric,
  getCoverage: () => ["tariff", "trade", "hts"],
  getFallbackTemplate: () => "tariff_metric_template.csv",
};
