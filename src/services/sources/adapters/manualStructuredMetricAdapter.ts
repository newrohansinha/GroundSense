// Manual Structured Metric CSV adapter. Always available (no key, no network).
// Live fetch is a no-op — metrics arrive via the ManualMetricImportPanel / import service.
// normalize/validate are shared with the importer so behavior is identical.

import type { FetchResult, SourceAdapter } from "../types";
import { buildStatus, normalizeGeneric, validateGeneric } from "./adapterBase";

const SOURCE_ID = "manual_structured_metric_csv";

export const manualStructuredMetricAdapter: SourceAdapter = {
  sourceId: SOURCE_ID,

  getConnectorStatus() {
    return buildStatus(SOURCE_ID, "manual_only", "Manual structured metric CSV — always available. Upload official metrics; trusted above article claims.");
  },

  async fetchMetrics(): Promise<FetchResult> {
    // Manual metrics are applied via the import service, not fetched here.
    return { status: "manual_only", reason: "Manual upload source — use Import CSV in the Source Hub.", metrics: [] };
  },

  normalizeMetric: (raw) => normalizeGeneric(SOURCE_ID, raw),
  validateMetric: validateGeneric,
  getCoverage: () => ["tariff", "freight", "commodities", "trade_flows", "macro", "company_filings"],
  getFallbackTemplate: () => "self",
};
