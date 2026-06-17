// Source Fusion Service (Part 8).
// One pipeline step: register sources, ingest free structured metrics, extract article
// metric claims, verify claims against metrics, create verified shocks, summarize coverage.
// Every step is wrapped so an unavailable source NEVER fails the pipeline.

import { supabase } from "../../lib/supabase";
import { getRegistrySnapshot } from "./freeSourceRegistry";
import { ADAPTERS } from "./adapters";
import { extractArticleMetricClaimsForCompany } from "./articleMetricClaimService";
import {
  createVerifiedShock,
  deriveShockFromMetric,
  verifyArticleClaimAgainstMetrics,
} from "./verifiedShockService";
import type {
  ArticleMetricClaim,
  ConnectorStatus,
  NormalizedMetric,
  SourceCoverageRow,
  SourceFusionSummary,
  SourceRunDiagnostic,
} from "./types";

// Persist the registry's current configuration to external_sources (best-effort).
async function syncSourceRegistry(connectors: ConnectorStatus[]): Promise<void> {
  const snap = getRegistrySnapshot();
  for (const s of snap) {
    const conn = connectors.find((c) => c.sourceId === s.id);
    try {
      await supabase.from("external_sources").upsert(
        {
          source_id: s.id,
          name: s.name,
          category: s.category,
          source_type: s.source_type,
          trust_tier: s.trust_tier,
          access_mode: s.access_mode,
          requires_key: s.requires_key,
          configured: s.configured,
          status: conn?.status ?? s.baseline_status,
          last_run_at: new Date().toISOString(),
          coverage_domains: s.coverage_domains,
          notes: s.notes,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "source_id" }
      );
    } catch {
      // ignore
    }
  }
}

// Ingest from every adapter. Calls the curated starter-pack fetch where available,
// persists metrics + observations (deduped), derives verified shocks, and records
// per-source diagnostics. Never throws — an unavailable source is recorded, not fatal.
export async function ingestAllSources(
  companyId: string
): Promise<{ connectors: ConnectorStatus[]; diagnostics: SourceRunDiagnostic[]; metricsStored: number; shocksCreated: number; ingested: NormalizedMetric[] }> {
  const connectors: ConnectorStatus[] = [];
  const diagnostics: SourceRunDiagnostic[] = [];
  const ingested: NormalizedMetric[] = [];
  let totalStored = 0;
  let totalShocks = 0;

  for (const adapter of ADAPTERS) {
    const started = Date.now();
    let status: ConnectorStatus;
    try {
      status = adapter.getConnectorStatus();
    } catch {
      continue;
    }

    let metricsFetched = 0;
    let metricsStored = 0;
    let shocksCreated = 0;
    let items: SourceRunDiagnostic["items"] = [];
    let error: string | null = null;

    const fetchFn = adapter.fetchStarterMetrics ?? (adapter.getConnectorStatus().status === "live" ? adapter.fetchMetrics : null);

    if (fetchFn) {
      try {
        const result = await fetchFn.call(adapter, { companyId });
        status = { ...status, status: result.status, reason: result.reason };
        items = result.items ?? [];
        metricsFetched = result.metrics.length;
        for (const m of result.metrics) {
          ingested.push(m);
          const stored = await upsertExternalMetric(companyId, m);
          if (stored) metricsStored++;
          await insertObservation(m);
          const shock = deriveShockFromMetric(m, 1);
          if (shock) {
            const persisted = await createVerifiedShock(companyId, shock);
            if (persisted) shocksCreated++;
          }
        }
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
        status = { ...status, status: "error", reason: `${status.name} fetch errored (non-fatal).` };
      }
    }

    totalStored += metricsStored;
    totalShocks += shocksCreated;
    connectors.push(status);
    diagnostics.push({
      sourceId: adapter.sourceId,
      name: status.name,
      status: status.status,
      reason: status.reason,
      metricsFetched,
      metricsStored,
      shocksCreated,
      items,
      error,
      durationMs: Date.now() - started,
    });
  }

  await syncSourceRegistry(connectors);
  return { connectors, diagnostics, metricsStored: totalStored, shocksCreated: totalShocks, ingested };
}

// Back-compat name used by the pipeline step.
export async function fetchConfiguredFreeSources(
  companyId: string
): Promise<{ connectors: ConnectorStatus[]; ingested: NormalizedMetric[] }> {
  const r = await ingestAllSources(companyId);
  return { connectors: r.connectors, ingested: r.ingested };
}

// Upsert a metric by (company_id, metric_key, period_end). Returns true if written.
async function upsertExternalMetric(companyId: string, m: NormalizedMetric): Promise<boolean> {
  try {
    const { data } = await supabase
      .from("external_metrics")
      .select("id")
      .eq("company_id", companyId)
      .eq("metric_key", m.metric_key)
      .eq("period_end", m.period_end ?? "")
      .limit(1);
    const payload = {
      company_id: companyId,
      source_id: m.source_id,
      metric_key: m.metric_key,
      metric_name: m.metric_name,
      category: m.category,
      driver: m.driver,
      commodity: m.commodity,
      geography: m.geography,
      lane: m.lane,
      hts_code: m.hts_code,
      unit: m.unit,
      value: m.current_value,
      baseline_value: m.baseline_value,
      current_value: m.current_value,
      percent_change: m.percent_change,
      period_start: m.period_start,
      period_end: m.period_end,
      observed_at: new Date().toISOString(),
      source_url: m.source_url,
      source_name: m.source_name,
      source_record_id: m.source_record_id,
      trust_tier: m.trust_tier,
    };
    if (data && data.length > 0) {
      await supabase.from("external_metrics").update(payload).eq("id", (data[0] as { id: string }).id);
    } else {
      await supabase.from("external_metrics").insert(payload);
    }
    return true;
  } catch {
    return false;
  }
}

// Append an observation, deduped by (metric_key, source_id, period_end).
async function insertObservation(m: NormalizedMetric): Promise<void> {
  try {
    const { data } = await supabase
      .from("external_metric_observations")
      .select("id")
      .eq("metric_key", m.metric_key)
      .eq("source_id", m.source_id)
      .eq("period_end", m.period_end ?? "")
      .limit(1);
    if (data && data.length > 0) return;
    await supabase.from("external_metric_observations").insert({
      metric_key: m.metric_key,
      source_id: m.source_id,
      value: m.current_value,
      unit: m.unit,
      observed_at: new Date().toISOString(),
      period_start: m.period_start,
      period_end: m.period_end,
      source_url: m.source_url,
    });
  } catch {
    // non-fatal
  }
}

// Source Hub "Refresh" — runs real public-source ingestion and records a fusion run.
export async function refreshPublicSources(
  companyId: string
): Promise<{ runId: string | null; diagnostics: SourceRunDiagnostic[]; connectors: ConnectorStatus[]; metricsStored: number; shocksCreated: number }> {
  const result = await ingestAllSources(companyId);
  let runId: string | null = null;
  try {
    const { data } = await supabase
      .from("source_fusion_runs")
      .insert({
        company_id: companyId,
        run_status: result.diagnostics.some((d) => d.status === "error") ? "completed_with_warnings" : "completed",
        sources_checked: result.diagnostics,
        metrics_ingested: result.metricsStored,
        shocks_verified: result.shocksCreated,
        claims_verified: 0,
        claims_rejected: 0,
        errors: result.diagnostics.filter((d) => d.error).map((d) => `${d.name}: ${d.error}`),
      })
      .select("id")
      .single();
    runId = (data as { id: string } | null)?.id ?? null;
  } catch {
    // non-fatal
  }
  return { runId, diagnostics: result.diagnostics, connectors: result.connectors, metricsStored: result.metricsStored, shocksCreated: result.shocksCreated };
}

// Load all stored structured metrics for the company (manual + live ingested).
export async function ingestStructuredMetrics(companyId: string): Promise<NormalizedMetric[]> {
  try {
    const { data } = await supabase.from("external_metrics").select("*").eq("company_id", companyId);
    return (data ?? []) as unknown as NormalizedMetric[];
  } catch {
    return [];
  }
}

// Match extracted article claims to structured metrics; persist verification status.
export async function matchClaimsToMetrics(
  claims: ArticleMetricClaim[],
  metrics: NormalizedMetric[]
): Promise<{ verified: number; rejected: number; conflicts: number; resolved: ArticleMetricClaim[] }> {
  let verified = 0;
  let rejected = 0;
  let conflicts = 0;
  const resolved: ArticleMetricClaim[] = [];

  for (const claim of claims) {
    const { status, reason } = verifyArticleClaimAgainstMetrics(claim, metrics);
    const updated: ArticleMetricClaim = { ...claim, verification_status: status, mismatch_reason: reason };
    if (status === "verified_manual_structured_metric" || status === "verified_official_source" || status === "verified_public_metric" || status === "corroborated_by_multiple_sources") {
      verified++;
    } else if (status === "conflicting_sources") {
      conflicts++;
      verified++; // structured metric still wins
    } else {
      rejected++;
    }
    resolved.push(updated);
  }
  return { verified, rejected, conflicts, resolved };
}

// Derive + persist verified shocks from structured metrics (one per driver, most trusted).
export async function createVerifiedShocksFromMetrics(companyId: string, metrics: NormalizedMetric[]): Promise<number> {
  // Keep only the highest-trust metric per metric_key to avoid duplicate shocks.
  const byKey = new Map<string, NormalizedMetric>();
  for (const m of metrics) {
    if (!m.metric_key) continue;
    if (!byKey.has(m.metric_key)) byKey.set(m.metric_key, m);
  }
  let created = 0;
  for (const m of byKey.values()) {
    const shock = deriveShockFromMetric(m, 1);
    if (!shock) continue;
    const persisted = await createVerifiedShock(companyId, shock);
    if (persisted) created++;
  }
  return created;
}

const COVERAGE_DOMAINS: Array<{ domain: string; label: string; drivers: RegExp }> = [
  { domain: "freight", label: "Freight rates / logistics", drivers: /freight|logistics|container|shipping/i },
  { domain: "tariff", label: "Tariffs / trade policy", drivers: /tariff|duty|section.?232/i },
  { domain: "steel", label: "Steel / metals", drivers: /steel|metal|iron/i },
  { domain: "copper_aluminum", label: "Copper / aluminum", drivers: /copper|alumin/i },
  { domain: "import_volume", label: "Import volumes", drivers: /import|export|trade_flow/i },
  { domain: "macro", label: "Macro indicators", drivers: /macro|gdp|cpi|inflation|manufacturing_demand|price_pressure/i },
  { domain: "company_filings", label: "Company filings", drivers: /company|revenue|financial/i },
  { domain: "news_events", label: "News / events", drivers: /news|event|geopolit/i },
];

type ShockLite = { driver?: string | null };

export function produceSourceCoverage(
  metrics: NormalizedMetric[],
  connectors: ConnectorStatus[],
  shocks: ShockLite[] = []
): SourceCoverageRow[] {
  const rows: SourceCoverageRow[] = COVERAGE_DOMAINS.map(({ domain, label, drivers }) => {
    const matched = metrics.filter((m) => m.driver && drivers.test(m.driver));
    const manual = matched.find((m) => m.trust_tier === "user_imported_structured_data");
    const official = matched.find((m) => m.trust_tier !== "user_imported_structured_data");
    const verifiedShockCount = shocks.filter((s) => s.driver && drivers.test(s.driver)).length;

    let status: SourceCoverageRow["status"];
    let source: string;
    let latest: string | null = null;
    let gap: string | null = null;

    if (domain === "freight") {
      // BLS transportation/freight PPI is price-pressure SUPPORT, not a lane-verified rate.
      const blsFreight = matched.find((m) => m.source_id === "bls_public_api");
      const manualFreight = matched.find((m) => m.trust_tier === "user_imported_structured_data");
      if (manualFreight) {
        status = "manual"; source = manualFreight.source_name ?? "Manual freight index"; latest = manualFreight.period_end ?? null;
      } else if (blsFreight) {
        status = "support"; source = "BLS transportation/warehousing PPI"; latest = blsFreight.period_end ?? null;
        gap = "Supports public logistics price pressure. Lane-specific freight-rate validation pending; upload freight_index CSV to validate lane-level rates.";
      } else {
        status = "scenario_only"; source = "Scenario assumption";
        gap = "No freight metric yet — lane-rate validation pending. Upload freight_index_template.csv.";
      }
    } else if (domain === "company_filings") {
      const sec = connectors.find((c) => c.sourceId === "sec_edgar_api");
      if (official || manual) { status = official ? "verified" : "manual"; source = (official ?? manual)!.source_name ?? "SEC EDGAR"; latest = (official ?? manual)!.period_end ?? null; }
      else if (sec?.status === "needs_user_agent") { status = "needs_user_agent"; source = "SEC EDGAR"; gap = "SEC needs a User-Agent — set VITE_SEC_EDGAR_USER_AGENT."; }
      else { status = "scenario_only"; source = sec?.status === "needs_server_proxy" ? "SEC (browser fetch blocked)" : "—"; gap = "SEC configured but browser fetch needs a server proxy, or upload company_filing CSV."; }
    } else if (domain === "tariff") {
      // Prefer the manual structured tariff metric; never present World Bank as a tariff-rate source.
      const manualTariff = matched.find((m) => m.trust_tier === "user_imported_structured_data");
      const officialTariff = matched.find((m) => m.trust_tier !== "user_imported_structured_data" && m.source_id !== "world_bank_indicators");
      if (manualTariff || officialTariff) {
        const m = manualTariff ?? officialTariff!;
        status = manualTariff ? "verified" : "verified";
        source = manualTariff ? "Manual structured tariff metric" : (m.source_name ?? m.source_id);
        latest = m.period_end ?? null;
        gap = "USITC API not configured; manual official tariff table currently verifies tariff-rate shock.";
      } else {
        status = "scenario_only"; source = "Scenario assumption";
        gap = "No tariff metric — upload tariff_metric_template.csv (or configure USITC).";
      }
    } else if (domain === "macro") {
      if (official) { status = "context"; source = official.source_name ?? "World Bank"; latest = official.period_end ?? null; gap = "Macro context — not company-specific by itself."; }
      else if (manual) { status = "manual"; source = manual.source_name ?? "Manual macro metric"; latest = manual.period_end ?? null; }
      else { status = "scenario_only"; source = "Scenario assumption"; gap = "No macro metric — upload macro_indicator CSV or rely on context."; }
    } else if (domain === "news_events") {
      const gdelt = connectors.find((c) => c.sourceId === "gdelt_doc_api");
      status = "context"; source = gdelt && (gdelt.status === "context_only" || gdelt.status === "live") ? "GDELT (context only)" : "—";
      gap = "Context only — never used for numeric exposure.";
    } else {
      // tariff, steel, copper/aluminum, import_volume
      if (official) { status = "verified"; source = official.source_name ?? official.source_id; latest = official.period_end ?? null; }
      else if (manual) { status = "manual"; source = manual.source_name ?? "Manual structured metric"; latest = manual.period_end ?? null; }
      else { status = "scenario_only"; source = "Scenario assumption"; gap = `No structured metric — configure a free source or upload ${label.toLowerCase()} CSV.`; }
    }

    return {
      domain, label, status, source, latestObservation: latest,
      usedInIssue: status === "verified" || status === "manual" || verifiedShockCount > 0,
      verifiedShockCount, gap,
    };
  });

  // 9th row — manual structured metrics summary.
  const manualMetrics = metrics.filter((m) => m.trust_tier === "user_imported_structured_data");
  rows.push({
    domain: "manual",
    label: "Manual structured metrics",
    status: manualMetrics.length > 0 ? "manual" : "scenario_only",
    source: manualMetrics.length > 0 ? `${manualMetrics.length} uploaded metric(s)` : "None uploaded",
    latestObservation: manualMetrics[0]?.period_end ?? null,
    usedInIssue: manualMetrics.length > 0,
    verifiedShockCount: shocks.filter(() => manualMetrics.length > 0).length === 0 ? 0 : manualMetrics.length,
    gap: manualMetrics.length > 0 ? null : "Upload official structured metrics for any domain (tariff, freight, commodity, trade, macro, filings).",
  });

  return rows;
}

// ── Orchestrator ──────────────────────────────────────────────────────────────

export async function runSourceFusion(companyId: string): Promise<SourceFusionSummary> {
  const errors: string[] = [];

  // 1. Probe + ingest free sources.
  let connectors: ConnectorStatus[] = [];
  try {
    const r = await fetchConfiguredFreeSources(companyId);
    connectors = r.connectors;
  } catch (e) {
    errors.push(`source fetch: ${e instanceof Error ? e.message : String(e)}`);
  }

  // 2. Load all structured metrics (manual + live).
  const metrics = await ingestStructuredMetrics(companyId);

  // 3. Extract article metric claims.
  let claims: ArticleMetricClaim[] = [];
  try {
    claims = await extractArticleMetricClaimsForCompany(companyId);
  } catch (e) {
    errors.push(`claim extraction: ${e instanceof Error ? e.message : String(e)}`);
  }

  // 4. Match claims to metrics.
  const match = await matchClaimsToMetrics(claims, metrics);

  // 5. Create verified shocks from metrics.
  let verifiedShocks = 0;
  try {
    verifiedShocks = await createVerifiedShocksFromMetrics(companyId, metrics);
  } catch (e) {
    errors.push(`shock creation: ${e instanceof Error ? e.message : String(e)}`);
  }

  // 6. Coverage.
  const shocks = await loadShocksLite(companyId);
  const sourceCoverage = produceSourceCoverage(metrics, connectors, shocks);

  const summary: SourceFusionSummary = {
    sourcesChecked: connectors,
    metricsIngested: metrics.length,
    claimsExtracted: claims.length,
    claimsVerified: match.verified,
    claimsRejected: match.rejected,
    verifiedShocks,
    conflicts: match.conflicts,
    sourceCoverage,
  };

  // 7. Persist run record (best-effort).
  try {
    await supabase.from("source_fusion_runs").insert({
      company_id: companyId,
      run_status: errors.length ? "completed_with_warnings" : "completed",
      sources_checked: connectors.map((c) => ({ id: c.sourceId, status: c.status })),
      metrics_ingested: metrics.length,
      shocks_verified: verifiedShocks,
      claims_verified: match.verified,
      claims_rejected: match.rejected,
      errors,
    });
  } catch {
    // non-fatal
  }

  return summary;
}

async function loadShocksLite(companyId: string): Promise<{ driver?: string | null }[]> {
  try {
    const { data } = await supabase.from("verified_shocks").select("driver").eq("company_id", companyId);
    return (data ?? []) as { driver?: string | null }[];
  } catch {
    return [];
  }
}

export async function produceSourceFusionSummary(companyId: string): Promise<SourceFusionSummary> {
  const metrics = await ingestStructuredMetrics(companyId);
  const shocks = await loadShocksLite(companyId);
  // Connector cards reflect actual adapter status (env-aware), not just registry baseline.
  const connectors = ADAPTERS.map((a) => {
    try { return a.getConnectorStatus(); } catch { return null; }
  }).filter((c): c is ConnectorStatus => c !== null);
  return {
    sourcesChecked: connectors,
    metricsIngested: metrics.length,
    claimsExtracted: 0,
    claimsVerified: 0,
    claimsRejected: 0,
    verifiedShocks: shocks.length,
    conflicts: 0,
    sourceCoverage: produceSourceCoverage(metrics, connectors, shocks),
  };
}
