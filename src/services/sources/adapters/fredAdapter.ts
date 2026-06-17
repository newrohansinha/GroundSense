// FRED adapter (free API key required). Reads VITE_FRED_API_KEY from env only.
// Missing key => not_configured (never fails). Curated commodity series map.

import type { FetchResult, NormalizedMetric, SourceAdapter } from "../types";
import { defaultKeyStatus, normalizeGeneric, pctChange, readEnvKey, safeFetchJson, validateGeneric } from "./adapterBase";

const SOURCE_ID = "fred_api";

// Curated, documented FRED "Global price of" commodity series.
const FRED_SERIES_MAP: Record<string, { driver: string; commodity: string; name: string; unit: string }> = {
  PCOPPUSDM: { driver: "copper", commodity: "Copper", name: "Global price of Copper", unit: "USD/mt" },
  PALUMUSDM: { driver: "aluminum", commodity: "Aluminum", name: "Global price of Aluminum", unit: "USD/mt" },
};

function key(): string | null {
  return readEnvKey("VITE_FRED_API_KEY") ?? readEnvKey("FRED_API_KEY");
}

export const fredAdapter: SourceAdapter = {
  sourceId: SOURCE_ID,
  getConnectorStatus: () => defaultKeyStatus(SOURCE_ID),

  async fetchMetrics(): Promise<FetchResult> {
    const k = key();
    if (!k) {
      return { status: "not_configured_key_required", reason: "Not configured — free key required (VITE_FRED_API_KEY). Manual commodity_price_template.csv fallback available.", metrics: [] };
    }
    const metrics: NormalizedMetric[] = [];
    for (const [series, map] of Object.entries(FRED_SERIES_MAP)) {
      const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${series}&api_key=${k}&file_type=json&sort_order=desc&limit=2`;
      const json = (await safeFetchJson(url)) as { observations?: Array<{ value: string; date: string }> } | null;
      const obs = (json?.observations ?? []).filter((o) => o.value !== ".");
      if (obs.length < 1) continue;
      const current = Number(obs[0].value);
      const baseline = obs.length > 1 ? Number(obs[1].value) : null;
      metrics.push(
        normalizeGeneric(SOURCE_ID, {
          metric_key: `fred_${series.toLowerCase()}`,
          metric_name: map.name,
          category: "commodities",
          driver: map.driver,
          commodity: map.commodity,
          unit: map.unit,
          baseline_value: baseline,
          current_value: current,
          percent_change: pctChange(baseline, current),
          period_end: obs[0].date,
          source_url: `https://fred.stlouisfed.org/series/${series}`,
          source_name: "FRED",
          source_record_id: series,
        })
      );
    }
    return { status: metrics.length ? "live" : "skipped", reason: metrics.length ? "FRED commodity series ingested." : "FRED configured but no series returned.", metrics };
  },

  normalizeMetric: (raw) => normalizeGeneric(SOURCE_ID, raw),
  validateMetric: validateGeneric,
  getCoverage: () => ["commodities", "macro", "rates"],
  getFallbackTemplate: () => "commodity_price_template.csv",
};
