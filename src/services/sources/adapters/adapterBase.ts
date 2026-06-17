// Shared helpers for source adapters. Every adapter degrades gracefully —
// network/CORS failures and missing keys NEVER throw to the pipeline.

import {
  getSourceById,
  hasConfiguredKey,
  readEnvKey,
  type FreeSource,
} from "../freeSourceRegistry";
import type { ConnectorStatus, MetricValidation, NormalizedMetric } from "../types";

export { readEnvKey };

export function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function pctChange(baseline: number | null, current: number | null): number | null {
  if (baseline === null || current === null || baseline === 0) return null;
  return Math.round(((current - baseline) / Math.abs(baseline)) * 1000) / 10;
}

// Build a ConnectorStatus from the registry entry + a resolved status/reason.
export function buildStatus(
  sourceId: string,
  status: ConnectorStatus["status"],
  reason: string
): ConnectorStatus {
  const src = getSourceById(sourceId) as FreeSource;
  return {
    sourceId,
    name: src.name,
    status,
    accessMode: src.access_mode,
    trustTier: src.trust_tier,
    requiresKey: src.requires_key,
    envKeyNames: src.env_key_names,
    configured: hasConfiguredKey(src),
    reason,
    fallbackTemplate: src.fallback_csv_template,
    coverageDomains: src.coverage_domains,
  };
}

// Default connector status for a key-aware source: not_configured when no key.
export function defaultKeyStatus(sourceId: string): ConnectorStatus {
  const src = getSourceById(sourceId) as FreeSource;
  if (hasConfiguredKey(src)) {
    return buildStatus(sourceId, "live", `${src.name} configured — live fetch available.`);
  }
  const keyList = src.env_key_names.join(" or ");
  return buildStatus(
    sourceId,
    "not_configured_key_required",
    `Not configured — free key/account required (${keyList}). Manual ${src.fallback_csv_template ?? "CSV"} fallback available.`
  );
}

// fetch with timeout; resolves to null on any failure (never throws).
export async function safeFetchJson(
  url: string,
  init?: RequestInit,
  timeoutMs = 8000
): Promise<unknown | null> {
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, { ...init, signal: controller.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// Generic normalizer: maps a loose record onto NormalizedMetric with a source's trust tier.
export function normalizeGeneric(sourceId: string, raw: Record<string, unknown>): NormalizedMetric {
  const src = getSourceById(sourceId) as FreeSource;
  const baseline = num(raw.baseline_value);
  const current = num(raw.current_value ?? raw.value);
  return {
    source_id: sourceId,
    metric_key: String(raw.metric_key ?? "").trim(),
    metric_name: String(raw.metric_name ?? raw.metric_key ?? "").trim(),
    category: String(raw.category ?? src.category),
    driver: String(raw.driver ?? "").trim(),
    commodity: raw.commodity != null ? String(raw.commodity) : null,
    geography: raw.geography != null ? String(raw.geography) : null,
    lane: raw.lane != null ? String(raw.lane) : null,
    hts_code: raw.hts_code != null ? String(raw.hts_code) : null,
    unit: String(raw.unit ?? "").trim(),
    value: current,
    baseline_value: baseline,
    current_value: current,
    percent_change: num(raw.percent_change) ?? pctChange(baseline, current),
    period_start: raw.period_start ? String(raw.period_start) : null,
    period_end: raw.period_end ? String(raw.period_end) : null,
    observed_at: raw.observed_at ? String(raw.observed_at) : null,
    published_at: raw.published_at ? String(raw.published_at) : null,
    source_url: raw.source_url ? String(raw.source_url) : null,
    source_name: raw.source_name ? String(raw.source_name) : src.name,
    source_record_id: raw.source_record_id ? String(raw.source_record_id) : null,
    trust_tier: src.trust_tier,
  };
}

// Generic validation shared by all adapters + the manual CSV importer.
export function validateGeneric(metric: NormalizedMetric): MetricValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!metric.metric_key) errors.push("metric_key is required");
  if (!metric.metric_name) errors.push("metric_name is required");
  if (!metric.driver) errors.push("driver is required");
  if (metric.current_value === null || metric.current_value === undefined) errors.push("current_value must be numeric");
  if (!metric.unit) warnings.push("unit is recommended");
  if (!metric.period_end) warnings.push("period_end is recommended");
  if (metric.baseline_value === null && metric.percent_change === null) {
    warnings.push("no baseline_value or percent_change — change cannot be computed");
  }
  return { valid: errors.length === 0, errors, warnings, normalized: metric };
}
