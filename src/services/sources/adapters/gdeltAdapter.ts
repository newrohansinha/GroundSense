// GDELT Doc API adapter (public, no key). CONTEXT ONLY.
// Runs starter queries to corroborate evidence and reports docs found, but produces ZERO
// numeric metrics and ZERO shocks — GDELT counts/tone must never become dollar exposure.

import type { FetchResult, ItemDiagnostic, SourceAdapter } from "../types";
import { GDELT_STARTER_QUERIES } from "../starterMetricPack";
import { buildStatus, normalizeGeneric, validateGeneric } from "./adapterBase";
import { callProxy } from "../sourceProxyClient";

const SOURCE_ID = "gdelt_doc_api";

let _lastItems: ItemDiagnostic[] = [];

export const gdeltAdapter: SourceAdapter = {
  sourceId: SOURCE_ID,

  getConnectorStatus() {
    return buildStatus(SOURCE_ID, "context_only", "GDELT public Doc API — context/corroboration only. Not counted as structured numeric metrics; never creates dollar exposure.");
  },

  async fetchStarterMetrics(): Promise<FetchResult> {
    const items: ItemDiagnostic[] = [];
    let totalDocs = 0;
    let reachable = false;
    let proxyDown = false;
    // Probe a couple of starter queries through the proxy (kept small to stay polite).
    for (const q of GDELT_STARTER_QUERIES.slice(0, 3)) {
      const proxy = await callProxy("gdelt", "doc_search", { query: q.query, maxRecords: 5, timespan: "30d" });
      if (proxy.proxyUnavailable) { proxyDown = true; items.push({ id: q.id, name: q.label, status: "skipped", reason: "Proxy not running — deploy public-source-proxy." }); continue; }
      if (proxy.ok) {
        reachable = true;
        const n = proxy.docsFound ?? 0;
        totalDocs += n;
        items.push({ id: q.id, name: q.label, status: "ingested", reason: `${n} context doc(s) found.` });
      } else {
        items.push({ id: q.id, name: q.label, status: "skipped", reason: proxy.reason ?? "GDELT query unavailable." });
      }
    }
    _lastItems = items;
    return {
      status: "context_only",
      reason: proxyDown
        ? "Proxy not running — GDELT context unavailable. Context only; no numeric metrics."
        : reachable
        ? `GDELT reachable via proxy — ${totalDocs} context doc(s) across ${items.filter((i) => i.status === "ingested").length} queries. Context only; not counted as structured numeric metrics.`
        : "GDELT returned no context docs. Context only; no numeric metrics.",
      metrics: [],
      items,
    };
  },

  async fetchMetrics(): Promise<FetchResult> {
    return this.fetchStarterMetrics!();
  },

  normalizeMetric: (raw) => normalizeGeneric(SOURCE_ID, raw),
  validateMetric: validateGeneric,
  getCoverage: () => ["news_events", "geopolitical"],
  getFallbackTemplate: () => null,
};

export function getGdeltLastRunDiagnostics(): ItemDiagnostic[] {
  return _lastItems;
}
