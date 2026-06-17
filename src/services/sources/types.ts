// Free Source Fusion — shared types. Pure types, no Supabase, no React.

import type { AccessMode, SourceStatus, TrustTier } from "./freeSourceRegistry";

// Canonical structured metric (maps to public.external_metrics).
export type NormalizedMetric = {
  source_id: string;
  metric_key: string;
  metric_name: string;
  category: string;
  driver: string;
  commodity?: string | null;
  geography?: string | null;
  lane?: string | null;
  hts_code?: string | null;
  unit: string;
  value?: number | null;
  baseline_value?: number | null;
  current_value?: number | null;
  percent_change?: number | null;
  period_start?: string | null;
  period_end?: string | null;
  observed_at?: string | null;
  published_at?: string | null;
  source_url?: string | null;
  source_name?: string | null;
  source_record_id?: string | null;
  trust_tier: string;
};

export type MetricValidation = {
  valid: boolean;
  errors: string[];
  warnings: string[];
  normalized: NormalizedMetric;
};

// Reported health of a connector (never throws; always returns this).
export type ConnectorStatus = {
  sourceId: string;
  name: string;
  status: SourceStatus;
  accessMode: AccessMode;
  trustTier: TrustTier;
  requiresKey: boolean;
  envKeyNames: string[];
  configured: boolean;
  reason: string;
  fallbackTemplate: string | null;
  coverageDomains: string[];
};

// Per-item (series/indicator) outcome inside a fetch.
export type ItemDiagnostic = {
  id: string;
  name: string;
  status: "ingested" | "skipped" | "error";
  reason: string;
};

export type FetchResult = {
  status: SourceStatus;
  reason: string;
  metrics: NormalizedMetric[];
  items?: ItemDiagnostic[];
};

// Diagnostics recorded per source per refresh run (Part 11).
export type SourceRunDiagnostic = {
  sourceId: string;
  name: string;
  status: SourceStatus;
  reason: string;
  metricsFetched: number;
  metricsStored: number;
  shocksCreated: number;
  items: ItemDiagnostic[];
  error?: string | null;
  durationMs?: number;
};

// Every adapter implements this shape.
export type SourceAdapter = {
  sourceId: string;
  getConnectorStatus: () => ConnectorStatus;
  fetchMetrics: (params?: Record<string, unknown>) => Promise<FetchResult>;
  // Public/no-key sources implement a curated starter-pack fetch used by Refresh.
  fetchStarterMetrics?: (params?: Record<string, unknown>) => Promise<FetchResult>;
  normalizeMetric: (raw: Record<string, unknown>) => NormalizedMetric;
  validateMetric: (metric: NormalizedMetric) => MetricValidation;
  getCoverage: () => string[];
  getFallbackTemplate: () => string | null;
};

// ── Verified shocks ───────────────────────────────────────────────────────────

export type ShockType =
  | "freight_rate_change"
  | "tariff_rate_change"
  | "commodity_price_change"
  | "import_volume_change"
  | "ppi_change"
  | "macro_indicator_change"
  | "company_financial_change"
  | "news_event_context";

export type VerificationStatus =
  | "verified_public_metric"
  | "verified_official_source"
  | "verified_manual_structured_metric"
  | "corroborated_by_multiple_sources"
  | "article_claim_only"
  | "conflicting_sources"
  | "rejected_contextual_number"
  | "scenario_assumption_only";

export type VerifiedShock = {
  id?: string;
  company_id?: string | null;
  driver: string;
  shock_type: ShockType;
  metric_key: string | null;
  baseline_value: number | null;
  current_value: number | null;
  absolute_change: number | null;
  percent_change: number | null;
  unit: string;
  period_start?: string | null;
  period_end?: string | null;
  source_count: number;
  primary_source_id: string | null;
  verification_status: VerificationStatus;
  confidence_score: number;
  source_agreement_score: number;
  notes: string;
};

export type ArticleMetricClaim = {
  id?: string;
  raw_event_id?: string | null;
  company_id?: string | null;
  claim_text: string;
  extracted_value: number | null;
  extracted_unit: string | null;
  metric_key: string | null;
  driver: string | null;
  period_text: string | null;
  verification_status: VerificationStatus;
  matched_verified_shock_id?: string | null;
  mismatch_reason?: string | null;
};

export type SourceFusionSummary = {
  sourcesChecked: ConnectorStatus[];
  metricsIngested: number;
  claimsExtracted: number;
  claimsVerified: number;
  claimsRejected: number;
  verifiedShocks: number;
  conflicts: number;
  sourceCoverage: SourceCoverageRow[];
};

export type SourceCoverageRow = {
  domain: string;
  label: string;
  status: "verified" | "manual" | "support" | "context" | "article_only" | "scenario_only" | "not_configured" | "needs_user_agent";
  source: string;
  latestObservation: string | null;
  usedInIssue: boolean;
  verifiedShockCount: number;
  gap: string | null;
};
