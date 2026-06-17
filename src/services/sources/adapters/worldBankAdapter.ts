// World Bank Indicators API adapter (public, no key, CORS-friendly).
// Fetches a curated starter pack of macro indicators. World Bank data is macro CONTEXT —
// shocks are marked macro_context and must not become company-specific exposure on their own.

import type { FetchResult, ItemDiagnostic, NormalizedMetric, SourceAdapter } from "../types";
import { WB_DEFAULT_COUNTRY, WB_STARTER, type WbIndicatorMapping } from "../starterMetricPack";
import { buildStatus, normalizeGeneric, pctChange, validateGeneric } from "./adapterBase";
import { callProxy } from "../sourceProxyClient";

const SOURCE_ID = "world_bank_indicators";

let _lastItems: ItemDiagnostic[] = [];

type WbObs = { date: string; value: number | null };

function metricFromObs(mapping: WbIndicatorMapping, country: string, valid: WbObs[]): NormalizedMetric {
  const current = valid[0].value as number;
  const baseline = valid[1].value as number;
  return normalizeGeneric(SOURCE_ID, {
    metric_key: mapping.metric_key,
    metric_name: mapping.metric_name,
    category: "macroeconomic",
    driver: mapping.driver,
    geography: country,
    unit: mapping.unit,
    baseline_value: baseline,
    current_value: current,
    percent_change: pctChange(baseline, current),
    period_start: `${valid[1].date}-12-31`,
    period_end: `${valid[0].date}-12-31`,
    source_url: mapping.source_url,
    source_name: "World Bank",
    source_record_id: mapping.indicator,
  });
}

async function fetchIndicator(country: string, indicator: string): Promise<WbObs[] | null> {
  const proxy = await callProxy("world_bank", "indicator", { countryCode: country, indicatorCode: indicator });
  if (!proxy.ok) return null;
  const json = proxy.data as [unknown, WbObs[] | null] | null;
  if (!Array.isArray(json)) return null;
  return json[1] ?? [];
}

export const worldBankAdapter: SourceAdapter = {
  sourceId: SOURCE_ID,

  getConnectorStatus() {
    return buildStatus(SOURCE_ID, "live", "World Bank Indicators — no key. Macro context; verified shocks only for explicitly mapped indicators.");
  },

  async fetchStarterMetrics(params): Promise<FetchResult> {
    const country = String((params?.country as string) ?? WB_DEFAULT_COUNTRY);
    const items: ItemDiagnostic[] = [];
    const metrics: NormalizedMetric[] = [];
    let reachable = false;

    for (const mapping of WB_STARTER) {
      const obs = await fetchIndicator(country, mapping.indicator);
      if (obs === null) {
        items.push({ id: mapping.indicator, name: mapping.metric_name, status: "error", reason: "World Bank request failed (network/parse)." });
        continue;
      }
      reachable = true;
      const valid = obs.filter((o) => o.value !== null && Number.isFinite(Number(o.value)));
      if (valid.length < 2) {
        items.push({ id: mapping.indicator, name: mapping.metric_name, status: "skipped", reason: valid.length === 0 ? "No non-null observations for this country." : "Fewer than 2 valid observations." });
        continue;
      }
      metrics.push(metricFromObs(mapping, country, valid));
      items.push({ id: mapping.indicator, name: mapping.metric_name, status: "ingested", reason: `${valid[0].date} vs ${valid[1].date} (macro context).` });
    }

    _lastItems = items;
    const ingested = items.filter((i) => i.status === "ingested").length;
    if (!reachable) return { status: "error", reason: "World Bank unreachable via proxy (deploy public-source-proxy) — or use manual macro_indicator_template.csv.", metrics, items };
    if (ingested === 0) return { status: "live_no_metrics", reason: "World Bank reachable but no mapped indicator returned 2+ observations.", metrics, items };
    return { status: "live", reason: `World Bank ingested ${ingested}/${WB_STARTER.length} macro indicators (context).`, metrics, items };
  },

  async fetchMetrics(params): Promise<FetchResult> {
    return this.fetchStarterMetrics!(params);
  },

  normalizeMetric: (raw) => normalizeGeneric(SOURCE_ID, raw),
  validateMetric: validateGeneric,
  getCoverage: () => ["macro", "trade", "manufacturing_demand"],
  getFallbackTemplate: () => "macro_indicator_template.csv",
};

export function getWorldBankLastRunDiagnostics(): ItemDiagnostic[] {
  return _lastItems;
}
