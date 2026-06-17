// SEC EDGAR adapter — fetches company facts through the public-source-proxy so the
// required User-Agent header is set server-side (browsers cannot set it). Status:
//   - no User-Agent anywhere -> needs_user_agent
//   - proxy down              -> skipped (proxy not running)
//   - works                   -> live, company-disclosure corroboration (never overrides calibration)

import type { FetchResult, ItemDiagnostic, NormalizedMetric, SourceAdapter } from "../types";
import { buildStatus, normalizeGeneric, pctChange, validateGeneric } from "./adapterBase";
import { callProxy, clientSecUserAgent } from "../sourceProxyClient";

const SOURCE_ID = "sec_edgar_api";
const UA_ENV = "VITE_SEC_EDGAR_USER_AGENT";

let _lastItems: ItemDiagnostic[] = [];

// us-gaap concepts to normalize (label + driver stays company_financials).
const CONCEPTS: { key: string; concepts: string[]; name: string }[] = [
  { key: "revenue", name: "Revenue", concepts: ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax"] },
  { key: "cogs", name: "Cost of revenue", concepts: ["CostOfGoodsAndServicesSold", "CostOfRevenue"] },
  { key: "gross_profit", name: "Gross profit", concepts: ["GrossProfit"] },
  { key: "operating_income", name: "Operating income", concepts: ["OperatingIncomeLoss"] },
  { key: "net_income", name: "Net income", concepts: ["NetIncomeLoss"] },
  { key: "inventory", name: "Inventory (net)", concepts: ["InventoryNet"] },
];

type UsdFact = { val: number; end: string; form?: string; fy?: number; fp?: string };

function annualPair(facts: Record<string, { units?: { USD?: UsdFact[] } }>, concepts: string[]): { current: UsdFact; baseline: UsdFact | null } | null {
  for (const c of concepts) {
    const usd = facts[c]?.units?.USD;
    if (!usd?.length) continue;
    const annual = usd.filter((u) => u.form === "10-K").sort((a, b) => a.end.localeCompare(b.end));
    if (annual.length === 0) continue;
    return { current: annual[annual.length - 1], baseline: annual.length > 1 ? annual[annual.length - 2] : null };
  }
  return null;
}

export const secEdgarAdapter: SourceAdapter = {
  sourceId: SOURCE_ID,

  getConnectorStatus() {
    if (!clientSecUserAgent()) {
      return buildStatus(
        SOURCE_ID,
        "needs_user_agent",
        `SEC EDGAR needs a descriptive User-Agent. Set ${UA_ENV}="GroundSense your-email@example.com" (or SEC_EDGAR_USER_AGENT on the proxy) and restart. (User-Agent detected: No)`
      );
    }
    return buildStatus(SOURCE_ID, "live", "SEC EDGAR via server proxy (User-Agent detected: Yes). Company-disclosure corroboration; never overrides calibration.");
  },

  async fetchStarterMetrics(params): Promise<FetchResult> {
    const ua = clientSecUserAgent();
    const ticker = String((params?.ticker as string) ?? "FAST").toUpperCase();

    const proxy = await callProxy("sec", "companyfacts", { ticker, userAgent: ua ?? undefined });

    if (proxy.status === "needs_user_agent" && !proxy.userAgentDetected) {
      _lastItems = [{ id: "user_agent", name: "User-Agent", status: "skipped", reason: `Set ${UA_ENV} (or SEC_EDGAR_USER_AGENT on proxy).` }];
      return { status: "needs_user_agent", reason: "SEC EDGAR User-Agent not configured.", metrics: [], items: _lastItems };
    }
    if (proxy.proxyUnavailable) {
      _lastItems = [{ id: ticker, name: ticker, status: "skipped", reason: "Proxy not running — deploy public-source-proxy." }];
      return { status: "skipped", reason: proxy.reason ?? "Proxy not reachable.", metrics: [], items: _lastItems };
    }
    const facts = (proxy.ok ? (proxy.data as { facts?: { "us-gaap"?: Record<string, { units?: { USD?: UsdFact[] } }> } })?.facts?.["us-gaap"] : null) ?? null;
    if (!facts) {
      _lastItems = [{ id: ticker, name: `${ticker} facts`, status: "error", reason: proxy.reason ?? "SEC returned no us-gaap facts." }];
      return { status: "error", reason: proxy.reason ?? "SEC EDGAR returned no usable facts.", metrics: [], items: _lastItems };
    }

    const items: ItemDiagnostic[] = [];
    const metrics: NormalizedMetric[] = [];
    for (const def of CONCEPTS) {
      const pair = annualPair(facts, def.concepts);
      if (!pair) { items.push({ id: def.key, name: def.name, status: "skipped", reason: "Concept not reported." }); continue; }
      metrics.push(
        normalizeGeneric(SOURCE_ID, {
          metric_key: `sec_${ticker.toLowerCase()}_${def.key}`,
          metric_name: `${ticker} ${def.name} (10-K)`,
          category: "company_filings",
          driver: "company_financials",
          geography: "US",
          unit: "USD",
          baseline_value: pair.baseline?.val ?? null,
          current_value: pair.current.val,
          percent_change: pctChange(pair.baseline?.val ?? null, pair.current.val),
          period_end: pair.current.end,
          period_start: pair.baseline?.end ?? null,
          source_url: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${ticker}`,
          source_name: "SEC EDGAR",
          source_record_id: `${ticker}:${def.key}`,
        })
      );
      items.push({ id: def.key, name: def.name, status: "ingested", reason: `${pair.current.end} (company disclosure).` });
    }
    _lastItems = items;
    const ingested = items.filter((i) => i.status === "ingested").length;
    return { status: ingested ? "live" : "live_no_metrics", reason: ingested ? `SEC ingested ${ingested} company fact(s) for ${ticker}.` : "SEC reachable but no mapped concepts found.", metrics, items };
  },

  async fetchMetrics(params): Promise<FetchResult> {
    return this.fetchStarterMetrics!(params);
  },

  normalizeMetric: (raw) => normalizeGeneric(SOURCE_ID, raw),
  validateMetric: validateGeneric,
  getCoverage: () => ["company_filings", "financial_anchors"],
  getFallbackTemplate: () => "company_filing_metric_template.csv",
};

export function getSecLastRunDiagnostics(): ItemDiagnostic[] {
  return _lastItems;
}
