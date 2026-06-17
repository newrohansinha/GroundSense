// BLS Public Data API v1 adapter (no key). Fetches a curated starter pack of real PPI
// series, validates the response, and produces metrics + per-series diagnostics. If the
// browser blocks the request (CORS) every series is marked skipped with a clear reason.

import type { FetchResult, ItemDiagnostic, NormalizedMetric, SourceAdapter } from "../types";
import { BLS_STARTER, type BlsSeriesMapping } from "../starterMetricPack";
import { buildStatus, normalizeGeneric, pctChange, validateGeneric } from "./adapterBase";
import { callProxy } from "../sourceProxyClient";

const SOURCE_ID = "bls_public_api";

let _lastItems: ItemDiagnostic[] = [];

type BlsObs = { year: string; period: string; periodName?: string; value: string };
type BlsResponse = {
  status?: string;
  message?: string[];
  Results?: { series?: Array<{ seriesID: string; data?: BlsObs[] }> };
};

function periodEnd(o: BlsObs): string | null {
  if (!o) return null;
  const m = /^M(\d{2})$/.exec(o.period);
  if (m) return `${o.year}-${m[1]}-01`;
  const q = /^Q(\d)$/.exec(o.period);
  if (q) return `${o.year}-${String(Number(q[1]) * 3).padStart(2, "0")}-01`;
  return `${o.year}-01-01`;
}

function metricFromSeries(mapping: BlsSeriesMapping, data: BlsObs[]): NormalizedMetric {
  const current = Number(data[0].value);
  const baseline = Number(data[1].value);
  return normalizeGeneric(SOURCE_ID, {
    metric_key: mapping.metric_key,
    metric_name: mapping.metric_name,
    category: "producer_prices",
    driver: mapping.driver,
    commodity: /steel|iron/.test(mapping.driver) ? "Steel" : /copper/.test(mapping.driver) ? "Copper" : null,
    geography: "US",
    unit: mapping.unit,
    baseline_value: baseline,
    current_value: current,
    percent_change: pctChange(baseline, current),
    period_start: periodEnd(data[1]),
    period_end: periodEnd(data[0]),
    source_url: mapping.source_url,
    source_name: "BLS Producer Price Index",
    source_record_id: mapping.series_id,
  });
}

export const blsAdapter: SourceAdapter = {
  sourceId: SOURCE_ID,

  getConnectorStatus() {
    return buildStatus(SOURCE_ID, "live", "BLS Public Data API v1 (via server proxy) — no key. Click Refresh to ingest the curated PPI starter pack.");
  },

  async fetchStarterMetrics(): Promise<FetchResult> {
    const seriesIds = BLS_STARTER.map((s) => s.series_id);
    const now = new Date();
    const proxy = await callProxy("bls", "series", {
      seriesIds,
      startYear: String(now.getFullYear() - 2),
      endYear: String(now.getFullYear()),
    });

    const items: ItemDiagnostic[] = [];
    const metrics: NormalizedMetric[] = [];

    if (proxy.proxyUnavailable) {
      for (const m of BLS_STARTER) items.push({ id: m.series_id, name: m.metric_name, status: "skipped", reason: "Proxy not running — deploy public-source-proxy." });
      _lastItems = items;
      return { status: "skipped", reason: proxy.reason ?? "Public-source proxy not reachable. Manual commodity_price_template.csv remains available.", metrics, items };
    }
    const json = (proxy.ok ? proxy.data : null) as BlsResponse | null;
    if (!json) {
      for (const m of BLS_STARTER) items.push({ id: m.series_id, name: m.metric_name, status: "error", reason: proxy.reason ?? "BLS upstream returned no data." });
      _lastItems = items;
      return { status: "error", reason: proxy.reason ?? "BLS upstream error via proxy.", metrics, items };
    }

    const byId = new Map((json.Results?.series ?? []).map((s) => [s.seriesID, s.data ?? []]));
    for (const mapping of BLS_STARTER) {
      const data = (byId.get(mapping.series_id) ?? []).filter((d) => d.value !== "" && d.value != null && !Number.isNaN(Number(d.value)));
      if (data.length < 2) {
        items.push({ id: mapping.series_id, name: mapping.metric_name, status: "skipped", reason: data.length === 0 ? "No observations returned (series may be invalid or rate-limited)." : "Fewer than 2 observations — cannot derive a change." });
        continue;
      }
      metrics.push(metricFromSeries(mapping, data));
      items.push({ id: mapping.series_id, name: mapping.metric_name, status: "ingested", reason: `Latest ${periodEnd(data[0])} vs ${periodEnd(data[1])}.` });
    }

    _lastItems = items;
    const ingested = items.filter((i) => i.status === "ingested").length;
    if (ingested === 0) {
      const reason = json.message?.length ? `BLS: ${json.message.join("; ")}` : "BLS reachable but no starter series produced usable metrics.";
      return { status: "live_no_metrics", reason, metrics, items };
    }
    return { status: "live", reason: `BLS ingested ${ingested}/${BLS_STARTER.length} starter PPI series.`, metrics, items };
  },

  async fetchMetrics(): Promise<FetchResult> {
    return this.fetchStarterMetrics!();
  },

  normalizeMetric: (raw) => normalizeGeneric(SOURCE_ID, raw),
  validateMetric: validateGeneric,
  getCoverage: () => ["steel", "metals", "copper", "manufacturing", "freight_logistics", "producer_prices"],
  getFallbackTemplate: () => "commodity_price_template.csv",
};

export function getBlsLastRunDiagnostics(): ItemDiagnostic[] {
  return _lastItems;
}
