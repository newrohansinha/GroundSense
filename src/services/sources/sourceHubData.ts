// Source Hub data loaders. Combines the static registry + adapter connector status
// with stored external metrics / shocks / claims / imports / runs from Supabase.

import { supabase } from "../../lib/supabase";
import { ADAPTERS } from "./adapters";
import { UNSUPPORTED_PAID_SOURCES } from "./freeSourceRegistry";
import { produceSourceFusionSummary } from "./sourceFusionService";
import type { ConnectorStatus, SourceFusionSummary } from "./types";

export { UNSUPPORTED_PAID_SOURCES };

// Connector cards reflect current env configuration (pure; no network).
export function loadConnectors(): ConnectorStatus[] {
  return ADAPTERS.map((a) => {
    try {
      return a.getConnectorStatus();
    } catch {
      return {
        sourceId: a.sourceId,
        name: a.sourceId,
        status: "error" as const,
        accessMode: "manual_upload" as const,
        trustTier: "user_imported_structured_data" as const,
        requiresKey: false,
        envKeyNames: [],
        configured: false,
        reason: "Connector status unavailable.",
        fallbackTemplate: a.getFallbackTemplate(),
        coverageDomains: a.getCoverage(),
      };
    }
  });
}

async function safeSelect(table: string, companyId: string, limit = 200): Promise<Record<string, unknown>[]> {
  try {
    const { data } = await supabase.from(table).select("*").eq("company_id", companyId).order("created_at", { ascending: false }).limit(limit);
    return (data ?? []) as Record<string, unknown>[];
  } catch {
    return [];
  }
}

export async function loadMetrics(companyId: string) { return safeSelect("external_metrics", companyId); }
export async function loadShocks(companyId: string) { return safeSelect("verified_shocks", companyId); }
export async function loadClaims(companyId: string) { return safeSelect("article_metric_claims", companyId); }
export async function loadImports(companyId: string) { return safeSelect("manual_external_metric_imports", companyId); }
export async function loadRuns(companyId: string) { return safeSelect("source_fusion_runs", companyId); }

export async function loadCoverage(companyId: string): Promise<SourceFusionSummary> {
  return produceSourceFusionSummary(companyId);
}

export type SourceHubData = {
  connectors: ConnectorStatus[];
  metrics: Record<string, unknown>[];
  shocks: Record<string, unknown>[];
  claims: Record<string, unknown>[];
  imports: Record<string, unknown>[];
  runs: Record<string, unknown>[];
  coverage: SourceFusionSummary;
};

export async function loadSourceHubData(companyId: string): Promise<SourceHubData> {
  const [metrics, shocks, claims, imports, runs, coverage] = await Promise.all([
    loadMetrics(companyId),
    loadShocks(companyId),
    loadClaims(companyId),
    loadImports(companyId),
    loadRuns(companyId),
    loadCoverage(companyId),
  ]);
  return { connectors: loadConnectors(), metrics, shocks, claims, imports, runs, coverage };
}
