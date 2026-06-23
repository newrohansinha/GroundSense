import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { isDemoMode, canViewAdminControls, syncOperatorModeFromUrl, leaveOperatorMode } from "../services/companyService";
import { matchEventsToConnections } from "../services/eventConnectionMatcher";
import { fetchEventsForCompany } from "../services/eventFetcher";
import { scoreEventsForCompany } from "../services/eventScorer";
import { generateBriefForCompany } from "../services/briefService";
import { generateOpportunitiesForCompany } from "../services/opportunityGenerator";
import { buildExposureGraphForCompany } from "../services/exposureGraphService";
import { generateSpecificExplanationsForCompany } from "../services/specificExplanationService";
import { generateDynamicRisksForCompany } from "../services/dynamicRiskGenerator";
import {
  fetchFreshIntelligenceForCompany,
  stopFreshIntelligenceBatch,
  fetchArticleContentForCompany,
} from "../services/freshIntelligenceService";
import { buildConnectionsForCompany } from "../services/connectionService";
import {
  stopPipeline,
  resetPipeline,
  getInitialPipelineState,
  type PipelineState,
  type PipelineStepStatus,
} from "../services/intelligencePipelineService";

import "./DashboardPage.css";
import { attachConnectionsToRisks } from "../services/riskConnectionBackfill";
import { computeDriverPriority } from "../services/driverComparisonService";
import { getCalibrationForCompany, type CompanyCalibrationInput } from "../services/calibrationService";
import {
  getRiskSummary,
  getRiskWhatChanged,
  getRiskWhyNow,
  getRiskBusinessImpact,
  getDecisionTrigger as getTrustSafeDecisionTrigger,
  getOpportunityTitle,
  getOpportunitySummary,
  getOpportunityWhatChanged,
  getOpportunityWhyNow,
  getOperatingChangeSummary,
  getWatchlistSummary,
  getWatchlistUpgradeTrigger,
  getForecastSummary,
  getMemoLine,
  isManufacturingOpportunity,
  isFreightIssue,
  isTariffIssue,
} from "../services/trustSafeDisplayService";
import ScenarioEditor from "../components/ScenarioEditor";
import DriverPriorityMap from "../components/DriverPriorityMap";
import ForecastAccuracyPanel from "../components/ForecastAccuracyPanel";
import DecisionMemoryPanel from "../components/DecisionMemoryPanel";
import ActionRoiPanel, { type ActionRoiItem } from "../components/ActionRoiPanel";
import CandidateReviewQueue, { type CandidateQueueItem } from "../components/CandidateReviewQueue";
import { runQualityGateOnAll, type IssueGateResult } from "../services/issueQualityGateService";
import CalibrationSummaryCard from "../components/calibration/CalibrationSummaryCard";
import { useCalibrationWorkbench } from "../services/calibration/useCalibrationWorkbench";
import {
  freightCalibratedExposure,
  steelCalibratedExposure,
  type CalibratedExposure,
} from "../services/calibration/calibratedExposureService";
import {
  buildIssueProvenance,
  type IssueProvenance,
  type VerifiedShockRow,
} from "../services/sources/issueProvenanceService";
import {
  EXECUTIVE_POINT_ESTIMATE_MODE,
  getExecutiveImpactEstimate,
  formatExecutiveEstimate,
  formatFormulaForDisplay,
  sumExecutiveEstimates,
  type ExecutiveEstimate,
} from "../services/executive/executiveImpactViewModel";
import ExternalShockProvenance from "../components/sources/ExternalShockProvenance";
import SourceCoverageCard from "../components/sources/SourceCoverageCard";
import CompanyExposureGraph from "../components/exposure/CompanyExposureGraph";
import { buildExposureGraphViewModel } from "../services/exposure/exposureGraphViewModel";
import DashboardSidebar from "../components/shell/DashboardSidebar";
import SchedulerStatusCard from "../components/scheduler/SchedulerStatusCard";
import RunHistoryPanel from "../components/scheduler/RunHistoryPanel";
import {
  startIntelligenceRun,
  getRunProgress,
  getActiveRunForCompany,
  expireStaleRuns,
  checkEdgeHealth,
  getRunEvents,
  type RunProgressSnapshot,
  type StartRunErr,
  type EdgeHealth,
  type RunEvent,
} from "../services/schedulerService";
import { seedCompanySignals } from "../services/companySignalSeeder";
// Server-owned pipeline stages — mirrors _shared/intelligence-orchestrator.ts
// STAGES. The dashboard renders progress from the DB run, not from any in-browser
// pipeline execution.
const SERVER_STAGES: { id: string; label: string }[] = [
  { id: "fetch-fresh", label: "Fetching external intelligence" },
  { id: "score-events", label: "Scoring relevance" },
  { id: "detect-changes", label: "Detecting material change" },
  { id: "build-connections", label: "Building company connections" },
  { id: "generate-risks", label: "Generating risks" },
  { id: "generate-opportunities", label: "Generating opportunities" },
  { id: "quality-gate", label: "Running quality gate" },
  { id: "generate-brief", label: "Rebuilding leadership brief" },
  { id: "finalize", label: "Finalizing & consistency check" },
];

const TERMINAL_RUN_STATUSES = new Set([
  "completed", "completed_with_warnings", "failed", "expired", "skipped",
]);

// Counters surfaced in the live progress panel (DB-sourced).
const RUN_COUNTER_FIELDS: [keyof RunProgressSnapshot, string][] = [
  ["queries_executed", "queries run"],
  ["articles_fetched", "articles fetched"],
  ["articles_inserted", "new articles"],
  ["article_duplicates", "duplicates"],
  ["articles_rejected", "off-topic"],
  ["articles_failed_insert", "insert-failed"],
  ["verified_shocks_created", "numeric shocks"],
  ["candidates_generated", "candidates"],
  ["candidates_published", "published"],
  ["candidates_review", "review"],
  ["candidates_quarantined", "quarantined"],
  ["watch_items_created", "watch"],
  ["candidates_blocked", "blocked"],
  ["actions_created", "actions"],
  ["briefs_created", "brief"],
];

// Maps a structured start error_code → an actionable fix shown in the UI.
function suggestedFix(code: string): string {
  switch (code) {
    case "function_unreachable":
    case "network_error":
      return "The Edge Function isn't reachable — it's most likely not deployed. Deploy it (`supabase functions deploy start-intelligence-run` + `intelligence-healthcheck`) and confirm the app's Supabase URL matches the deployed project. Then click “Test Edge Function health”.";
    case "missing_auth":
      return "Your session is missing or expired. Sign out and sign back in, then retry.";
    case "demo_read_only":
      return "You're in the read-only demo workspace. Sign up or open your own workspace to run intelligence.";
    case "forbidden":
      return "Your account isn't a member of this company. Switch to a company you belong to.";
    case "missing_company":
      return "No company is selected. Finish onboarding or pick a workspace, then retry.";
    case "lock_active":
      return "A run is already active for this company. Wait for it to finish, or use “Expire stale runs” if it's stuck.";
    case "schema_migration_missing":
      return "The run table is missing required columns. Run `supabase db push` (applies 20260619000000_run_schema_repair.sql) and reload the PostgREST schema cache, then click “Test Edge Function health” and confirm run_schema_ready: true.";
    case "db_insert_failed":
      return "A database write failed. Confirm the run-table migrations are applied to this project.";
    case "consistency_warning":
      return "The run completed but counts didn't fully reconcile. Open “View run events” for the failing check.";
    default:
      return "Check the Supabase Edge Function logs, then click “Test Edge Function health” to localize the failure.";
  }
}

function formatAgo(iso: string | null | undefined): string {
  if (!iso) return "—";
  const secs = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.round(secs / 60)}m ago`;
  return `${Math.round(secs / 3600)}h ago`;
}

function formatElapsed(start: string | null | undefined, end: string | null | undefined): string {
  if (!start) return "—";
  const ms = (end ? new Date(end).getTime() : Date.now()) - new Date(start).getTime();
  const secs = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

// Projects a persisted run snapshot onto the existing pipeline-step UI. The DB
// is the single source of truth; this is a pure render mapping.
function snapshotToPipelineState(snap: RunProgressSnapshot): PipelineState {
  const idx = snap.current_stage_index ?? 0; // 1-based; 0 = queued
  const failed = snap.status === "failed" || snap.status === "expired";
  const done = snap.status === "completed" || snap.status === "completed_with_warnings";
  const steps = SERVER_STAGES.map((s, i) => {
    const n = i + 1;
    let status: PipelineStepStatus;
    if (done) status = "complete";
    else if (failed) status = n === idx ? "failed" : n < idx ? "complete" : "pending";
    else if (n < idx) status = "complete";
    else if (n === idx) status = "running";
    else status = "pending";
    return {
      id: s.id,
      label: s.label,
      status,
      error: n === idx && failed ? (snap.error_message ?? undefined) : undefined,
    };
  });
  return {
    running: snap.status === "running" || snap.status === "queued",
    steps,
    currentStepId: SERVER_STAGES[Math.max(0, idx - 1)]?.id ?? null,
    error: failed ? (snap.error_message || snap.note || "Run expired.") : null,
    completedAt: done ? new Date(snap.completed_at ?? Date.now()) : null,
  };
}

type Company = {
  id: string;
  name: string;
  industry: string | null;
  revenue_range: string | null;
};

type Entity = {
  id: string;
  entity_type: string;
  entity_value: string;
};

type RawEvent = {
  id: string;
  title: string;
  source_url: string | null;
  source_name: string | null;
  query_text: string | null;
  published_at: string | null;
  source_quality?: number | null;
  event_age_days?: number | null;
  relevance_seed_score?: number | null;
  freshness_bucket?: string | null;
  source_api?: string | null;
  source_tier?: string | null;
};

type Assessment = {
  id: string;
  raw_event_id: string;
  relevant: boolean;
  impact_level: string | null;
  impact_type: string | null;
  why_it_matters: string | null;
  affected_areas: string[] | null;
  confidence: number | null;
  strategic_score?: number | null;
};

type Brief = {
  id: string;
  company_id: string;
  title: string | null;
  brief_text: string | null;
  monitored_count: number | null;
  relevant_count: number | null;
  filtered_count: number | null;
  high_count: number | null;
  medium_count: number | null;
  created_at: string;
};

type EvidenceItem = {
  title: string;
  source: string;
  url: string | null;
  source_quality: number;
  source_tier: string;
  published_at: string | null;
  age_days: number | null;
  age_label?: string;

  strategic_score?: number | null;
  confidence?: number | null;
  evidence_score?: number | null;
  relevance_seed_score?: number | null;
  impact_level?: string | null;
  impact_type?: string | null;
  why_it_matters?: string | null;
};

type Methodology = {
  formula?: string;
  base_exposure_type?: string;
  base_exposure_value?: number;
  risk_rate_low?: number;
  risk_rate_high?: number;
  conversion_rate_low?: number;
  conversion_rate_high?: number;
  supporting_signal_count?: number;
  average_source_quality?: number;
  evidence_multiplier?: number;
  quality_multiplier?: number;
  final_low?: number;
  final_high?: number;
  margin_bps_low?: number;
  margin_bps_high?: number;
  hard_cap_applied?: boolean;
  calibration_status?: string;
  formula_status?: string;
  missing_inputs?: string[];
  calculation_inputs?: Record<string, unknown>;
  calculation_steps?: string[];
  honesty_note?: string;

  shock_source?: string;
  shock_label?: string;
  shock_basis?: string;
  shock_audit_basis?: string;
  shock_interpretation?: string;
  shock_interpretation_display?: string;
  issue_category_hint?: string;
  issue_direction_hint?: string;
  explicit_shocks?: unknown[];
  all_cluster_shocks?: unknown[];
};

type Risk = {
  id: string;
  risk_title: string;
  risk_type: string;
  probability: number;
  impact_low: number;
  impact_high: number;
  confidence: number;
  severity: string;
  owner: string | null;
  action_required: string | null;
  due_days: number | null;
  status: string | null;

  issue_category?: string | null;
  issue_direction?: string | null;
  display_section?: string | null;
  exposure_interpretation?: string | null;
  is_actionable_risk?: boolean | null;

  affected_suppliers: string[] | null;
  affected_customers: string[] | null;
  affected_products: string[] | null;
  affected_commodities: string[] | null;
  affected_facilities: string[] | null;
  supporting_event_count: number | null;
  executive_summary: string | null;
  business_impact: string | null;
  margin_impact_bps: number | null;
  priority_score?: number | null;
  risk_rank?: number | null;
  evidence_items?: EvidenceItem[] | null;
  methodology?: Methodology | null;
  exposure_path?: string[] | null;
  decision_required?: string | null;
  expected_benefit?: string | null;
  supporting_connection_ids?: string[] | null;
  supporting_connection_count?: number | null;
  what_happened?: string | null;
  why_now?: string | null;
  risk_interaction?: string | null;
  evidence_summary?: string | null;
  explanation_confidence?: number | null;
  explanation_items?: {
    title: string;
    source: string;
    why_it_matters: string;
    quality_note: string;
  }[] | null;
};

type Opportunity = {
  id: string;
  title: string;
  summary: string | null;
  probability: number | null;
  revenue_low: number | null;
  revenue_high: number | null;
  confidence: number | null;
  owner: string | null;
  action_required: string | null;
  due_days: number | null;
  affected_customers: string[] | null;
  affected_products: string[] | null;
  affected_segments: string[] | null;
  supporting_event_count: number | null;
  priority_score?: number | null;
  opportunity_rank?: number | null;
  evidence_items?: EvidenceItem[] | null;
  methodology?: Methodology | null;
  exposure_path?: string[] | null;
  decision_required?: string | null;
  expected_benefit?: string | null;
  supporting_connection_ids?: string[] | null;
supporting_connection_count?: number | null;
what_happened?: string | null;
why_now?: string | null;
opportunity_interaction?: string | null;
evidence_summary?: string | null;
explanation_confidence?: number | null;
explanation_items?: {
  title: string;
  source: string;
  why_it_matters: string;
  quality_note: string;
}[] | null;
};

type ActionItem = {
  id: string;
  company_id: string;
  risk_id: string | null;
  opportunity_id: string | null;
  title: string;
  owner: string | null;
  deadline: string | null;
  expected_benefit: string | null;
  status: string | null;
  source_type: string | null;
};

type ExposureEdge = {
  id: string;
  from_type: string;
  from_name: string;
  to_type: string;
  to_name: string;
  relationship: string;
  weight: number | null;
};

type Snapshot = {
  id: string;
  risk_title?: string;
  opportunity_title?: string;
  priority_score: number;
  probability: number;
  snapshot_week: string;
};

type CompanyConnection = {
  id: string;
  from_type: string;
  from_name: string;
  to_type: string;
  to_name: string;
  relationship_type: string;
  strength: number | null;
  exposure_value: number | null;
  metadata?: Record<string, any> | string | null;
};

type ImpactPath = {
  id: string;
  trigger_type: string;
  trigger_name: string;
  affected_type: string;
  affected_name: string;
  impact_category: string;
  impact_weight: number | null;
  exposure_low: number | null;
  exposure_high: number | null;
  priority_score: number | null;
  path_nodes: string[] | null;
  action_hint: string | null;
  metadata?: Record<string, any> | string | null;
  calibration_status?: string | null;
};

type MatchedConnectionPath = {
  id: string;
  trigger_name: string | null;
  affected_name: string | null;
  impact_category: string | null;
  path_nodes: string[] | null;
  impact_weight: number | null;
  priority_score: number | null;
};
type ExplanationInput =
  | string
  | {
      label: string;
      value: string;
    };

type NumberExplanation = {
  title: string;
  formula?: string;
  displayedValue?: string;
  bullets?: string[];
  source?: string;
  note?: string;
  inputs?: ExplanationInput[];
  inputsProvenance?: string;
  caveat?: string;
};

// Where the company inputs in a formula came from — never present demo/inferred
// figures as real company data.
function inputProvenanceLabel(risk: unknown): string {
  // Concise provenance for the company inputs in a formula (freight/metal spend,
  // spot %, unpassed %, fuel-exposed freight). Demo figures are never presented as
  // real company data.
  if (isDemoMode()) return "demo calibration (illustrative, not real company data)";
  const fi = (risk as any)?.formula_inputs;
  const hasCompanyInputs = fi && typeof fi === "object" && Object.keys(fi).length > 0;
  return hasCompanyInputs ? "calibration table" : "inferred assumption";
}

export default function DashboardPage({ view = "dashboard" }: { view?: "dashboard" | "risks" }) {
  // Sync operator mode from ?operator=1/0 once, before first paint, so admin
  // controls reflect the URL immediately (lazy initializer runs exactly once).
  useState(() => { syncOperatorModeFromUrl(); return null; });
  const [company, setCompany] = useState<Company | null>(null);
  const [entities, setEntities] = useState<Entity[]>([]);
  const [events, setEvents] = useState<RawEvent[]>([]);
  const [, setAssessments] = useState<Assessment[]>([]);
  const [brief, setBrief] = useState<Brief | null>(null);
  const [risks, setRisks] = useState<Risk[]>([]);
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [actions, setActions] = useState<ActionItem[]>([]);
  const [edges, setEdges] = useState<ExposureEdge[]>([]);
  const [riskSnapshots, setRiskSnapshots] = useState<Snapshot[]>([]);
  const [opportunitySnapshots, setOpportunitySnapshots] = useState<Snapshot[]>(
    []
  );
  const [, setConnections] = useState<CompanyConnection[]>([]);
const [impactPaths, setImpactPaths] = useState<ImpactPath[]>([]);
// DB-backed persisted calibration coverage (company_calibration_coverage). Buyer
// trust metric — NOT the localStorage workbench.
const [persistedCoverage, setPersistedCoverage] = useState<{ coverage_pct: number; domains_populated: number; domains_total: number; inputs_calibrated: number | null; inputs_required: number | null; source: string } | null>(null);
const [calibration, setCalibration] = useState<CompanyCalibrationInput | null>(null);
const [workbenchCalibration, setWorkbenchCalibration] = useState<CompanyCalibrationInput | null>(null);
const [verifiedShocks, setVerifiedShocks] = useState<VerifiedShockRow[]>([]);

const [matchedConnectionsByItemId, setMatchedConnectionsByItemId] = useState<
  Record<string, MatchedConnectionPath[]>
>({});

const [signalStats, setSignalStats] = useState({
  rawEvents: 0,
  assessedEvents: 0,
  relevantEvents: 0,
}); 
  const [expandedRiskIds, setExpandedRiskIds] = useState<Set<string>>(new Set());
  const [expandedOpportunityIds, setExpandedOpportunityIds] = useState<Set<string>>(new Set());
  const [showRawEvents, setShowRawEvents] = useState(false);
  const [showAdvancedPipeline, setShowAdvancedPipeline] = useState(false);
  const [schedulerRefresh, setSchedulerRefresh] = useState(0);
  const [pipelineState, setPipelineState] = useState<PipelineState>(getInitialPipelineState());
  // The summary_id of the run we're observing from the DB. While set, the
  // polling effect renders live progress. The browser does NOT execute the run.
  const [activeRunSummaryId, setActiveRunSummaryId] = useState<string | null>(null);
  const [runSnapshot, setRunSnapshot] = useState<RunProgressSnapshot | null>(null);
  // Last progress signature we printed to console — so we log on CHANGE, not on
  // every poll/render.
  const lastProgressSigRef = useRef<string>("");
  // Structured start-failure (error_code + stage) so the UI never shows a bare
  // "Failed to send a request to the Edge Function".
  const [startError, setStartError] = useState<StartRunErr | null>(null);
  const [edgeHealth, setEdgeHealth] = useState<EdgeHealth | null>(null);
  const [healthBusy, setHealthBusy] = useState(false);
  const [runEvents, setRunEvents] = useState<RunEvent[] | null>(null);

  function toggleRiskId(id: string) {
    setExpandedRiskIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleOpportunityId(id: string) {
    setExpandedOpportunityIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleAllRiskSection(ids: string[]) {
    const allExpanded = ids.length > 0 && ids.every(id => expandedRiskIds.has(id));
    setExpandedRiskIds(prev => {
      const n = new Set(prev);
      if (allExpanded) ids.forEach(id => n.delete(id)); else ids.forEach(id => n.add(id));
      return n;
    });
  }
  function toggleAllOpportunitySection(ids: string[]) {
    const allExpanded = ids.length > 0 && ids.every(id => expandedOpportunityIds.has(id));
    setExpandedOpportunityIds(prev => {
      const n = new Set(prev);
      if (allExpanded) ids.forEach(id => n.delete(id)); else ids.forEach(id => n.add(id));
      return n;
    });
  }

  const [loading, setLoading] = useState(true);
  const [dashError, setDashError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    loadDashboard();
  }, []);

  async function loadDashboard() {
    setLoading(true);

    const savedCompanyId = localStorage.getItem("groundsense_company_id");

let companyQuery = supabase.from("companies").select("*");

if (savedCompanyId) {
  companyQuery = companyQuery.eq("id", savedCompanyId);
} else {
  companyQuery = companyQuery.order("created_at", { ascending: false }).limit(1);
}

const { data: companies, error: companyError } = await companyQuery;

    if (companyError) {
      setDashError(companyError.message);
      setLoading(false);
      return;
    }

    const latestCompany = companies?.[0];
if (latestCompany) {
  localStorage.setItem("groundsense_company_id", latestCompany.id);
}
    if (!latestCompany) {
      setLoading(false);
      return;
    }

    setCompany(latestCompany);
const [rawEventCountResult, assessmentCountResult, relevantCountResult] =
  await Promise.all([
    supabase
      .from("raw_events")
      .select("id", { count: "exact", head: true })
      .eq("company_id", latestCompany.id),

    supabase
      .from("event_assessments")
      .select("id", { count: "exact", head: true })
      .eq("company_id", latestCompany.id),

    supabase
      .from("event_assessments")
      .select("id", { count: "exact", head: true })
      .eq("company_id", latestCompany.id)
      .eq("relevant", true),
  ]);

setSignalStats({
  rawEvents: rawEventCountResult.count || 0,
  assessedEvents: assessmentCountResult.count || 0,
  relevantEvents: relevantCountResult.count || 0,
});
    const [
      entityResult,
      eventResult,
      assessmentResult,
      riskResult,
      opportunityResult,
      briefResult,
      actionResult,
      edgeResult,
      riskSnapshotResult,
      opportunitySnapshotResult,
      connectionResult,
      impactPathResult,
    ] = await Promise.all([
      supabase
        .from("company_entities")
        .select("*")
        .eq("company_id", latestCompany.id),

      supabase
        .from("raw_events")
        .select("*")
        .eq("company_id", latestCompany.id)
        .order("relevance_seed_score", { ascending: false })
        .limit(250),

      supabase
        .from("event_assessments")
        .select("*")
        .eq("company_id", latestCompany.id)
        .order("strategic_score", { ascending: false })
        .limit(250),

      supabase
        .from("risk_register")
        .select("*")
        .eq("company_id", latestCompany.id)
        .order("priority_score", { ascending: false })
        .limit(20),

      supabase
        .from("opportunity_register")
        .select("*")
        .eq("company_id", latestCompany.id)
        .order("priority_score", { ascending: false })
        .limit(20),

      supabase
        .from("intelligence_briefs")
        .select("*")
        .eq("company_id", latestCompany.id)
        .order("created_at", { ascending: false })
        .limit(1),

      supabase
        .from("risk_actions")
        .select("*")
        .eq("company_id", latestCompany.id)
        .order("deadline", { ascending: true })
        .limit(20),

      supabase
        .from("company_exposure_edges")
        .select("*")
        .eq("company_id", latestCompany.id)
        .order("weight", { ascending: false })
        .limit(50),

      supabase
        .from("risk_snapshots")
        .select("*")
        .eq("company_id", latestCompany.id)
        .order("created_at", { ascending: false })
        .limit(100),

      supabase
        .from("opportunity_snapshots")
        .select("*")
        .eq("company_id", latestCompany.id)
        .order("created_at", { ascending: false })
        .limit(100),

      supabase
        .from("company_connections")
        .select("*")
        .eq("company_id", latestCompany.id)
        .order("strength", { ascending: false })
        .limit(100),

      supabase
        .from("impact_paths")
        .select("*")
        .eq("company_id", latestCompany.id)
        .order("priority_score", { ascending: false })
        .limit(50),
    ]);
const matchedConnectionMap = await loadMatchedConnectionsByItemId(
  latestCompany.id,
  [
    ...((riskResult.data || []) as Risk[]),
    ...((opportunityResult.data || []) as Opportunity[]),
  ]
);
setMatchedConnectionsByItemId(matchedConnectionMap);
    // DB-backed formula-input provenance + persisted calibration coverage (trust foundation).
    // Provenance is attached per issue so the UI reads persisted source data, not view heuristics.
    let provByIssue = new Map<string, any[]>();
    try {
      const [{ data: prov }, { data: cov }] = await Promise.all([
        supabase.from("formula_input_provenance").select("*").eq("company_id", latestCompany.id),
        supabase.from("company_calibration_coverage").select("*").eq("company_id", latestCompany.id).maybeSingle(),
      ]);
      for (const p of (prov ?? []) as any[]) {
        const a = provByIssue.get(p.issue_id) ?? [];
        a.push(p);
        provByIssue.set(p.issue_id, a);
      }
      setPersistedCoverage((cov as any) ?? null);
    } catch {
      setPersistedCoverage(null);
    }

    setEntities(entityResult.data || []);
    setEvents(eventResult.data || []);
    setAssessments(assessmentResult.data || []);
    setRisks(((riskResult.data || []) as any[]).map((r) => ({ ...r, formula_provenance: provByIssue.get(r.id) ?? [] })));
    setOpportunities(opportunityResult.data || []);
    setBrief(briefResult.data?.[0] || null);
    setActions(actionResult.data || []);
    setEdges(edgeResult.data || []);
    setRiskSnapshots(riskSnapshotResult.data || []);
    setOpportunitySnapshots(opportunitySnapshotResult.data || []);
    setConnections(connectionResult.data || []);
    setImpactPaths(impactPathResult.data || []);

    // Load calibration data for new moat components
    try {
      const cal = await getCalibrationForCompany(latestCompany.id);
      if (cal) setCalibration(cal as CompanyCalibrationInput);
    } catch {
      // calibration is non-critical — dashboard still works without it
    }

    // Load verified external shocks (Free Source Fusion). Non-critical.
    try {
      const { data: shocks } = await supabase
        .from("verified_shocks")
        .select("*")
        .eq("company_id", latestCompany.id)
        .order("confidence_score", { ascending: false })
        .limit(200);
      setVerifiedShocks((shocks ?? []) as VerifiedShockRow[]);
    } catch {
      // verified shocks are non-critical
    }

    setLoading(false);
  }

  async function run(label: string, action: () => Promise<void>) {
    if (!company) return;

    setBusy(label);

    try {
      await action();
      await loadDashboard();
    } finally {
      setBusy(null);
    }
  }

  // Core: starts a fully SERVER-OWNED run. The browser only (1) pre-seeds
  // tracking signals (fast, idempotent), (2) asks the edge function to start,
  // (3) hands the run_id to the polling effect. After this returns, closing the
  // tab, refreshing, losing network, or logging out does NOT stop/expire the run.
  async function beginServerRun(options: {
    force?: boolean;
    runMode?: string;
    debug?: boolean;
    dryRun?: boolean;
    queryCap?: number;
    maxArticlesPerQuery?: number;
    cleanupAfter?: boolean;
  }) {
    if (!company) return;
    if (isDemoMode()) {
      setStartError({ ok: false, errorCode: "demo_read_only", message: "The demo workspace is read-only.", httpStatus: 403 });
      return;
    }
    if (busy !== null || activeRunSummaryId || pipelineState.running) return;
    setBusy("pipeline");
    setStartError(null);
    setRunEvents(null);
    setRunSnapshot(null);
    lastProgressSigRef.current = "";
    setPipelineState({ ...getInitialPipelineState(), running: true });

    try {
      // Materialize tracking queries before the server fetch runs (idempotent,
      // fast — NOT the long pipeline loop).
      try {
        await seedCompanySignals(company.id);
      } catch (e) {
        console.warn("[GroundSense] signal pre-seed failed (continuing)", e);
      }

      const outcome = await startIntelligenceRun({
        companyId: company.id,
        runMode: options.runMode ?? "full",
        force: options.force,
        debug: options.debug,
        dryRun: options.dryRun,
        queryCap: options.queryCap,
        maxArticlesPerQuery: options.maxArticlesPerQuery,
        cleanupAfter: options.cleanupAfter,
      });

      if (!outcome.ok) {
        // Structured failure — show exact code + stage, and auto-probe health.
        setStartError(outcome);
        setPipelineState((p) => ({ ...p, running: false, error: `[${outcome.errorCode}] ${outcome.message}` }));
        setBusy(null);
        setSchedulerRefresh((k) => k + 1);
        void checkEdgeHealth().then(setEdgeHealth).catch(() => {});
        return;
      }

      console.info("[GroundSense run progress] started", { runId: outcome.runId, summaryId: outcome.summaryId, status: outcome.status });
      setActiveRunSummaryId(outcome.summaryId); // begins polling
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setStartError({ ok: false, errorCode: "client_exception", message: msg, httpStatus: null });
      setPipelineState((p) => ({ ...p, running: false, error: `Could not start run. ${msg}` }));
      setBusy(null);
      setSchedulerRefresh((k) => k + 1);
    }
  }

  function handleRunIntelligenceUpdate(force = false) {
    void beginServerRun({ force, runMode: "full" });
  }

  // Ultra Debug: full server stages, capped queries/articles, server keys only.
  function handleUltraDebugRun() {
    void beginServerRun({ runMode: "ultra_debug", force: true, debug: true, queryCap: 10, maxArticlesPerQuery: 10 });
  }
  // Dry run: fetch + normalize + score, but NO inserts/generation (quota-safe).
  function handleDryRun() {
    void beginServerRun({ runMode: "ultra_debug", force: true, debug: true, dryRun: true, queryCap: 3, maxArticlesPerQuery: 10 });
  }

  async function handleTestEdgeHealth() {
    setHealthBusy(true);
    try {
      const h = await checkEdgeHealth();
      setEdgeHealth(h);
    } finally {
      setHealthBusy(false);
    }
  }

  async function handleExpireStaleRuns() {
    if (!company) return;
    await expireStaleRuns(company.id);
    setActiveRunSummaryId(null);
    setBusy((b) => (b === "pipeline" ? null : b));
    setSchedulerRefresh((k) => k + 1);
    await loadDashboard();
  }

  async function handleViewRunEvents() {
    if (!company) return;
    let summaryId = runSnapshot?.id ?? activeRunSummaryId ?? null;
    if (!summaryId) {
      const { data } = await supabase
        .from("intelligence_run_summaries")
        .select("id")
        .eq("company_id", company.id)
        .order("started_at", { ascending: false })
        .limit(1);
      summaryId = (data?.[0] as { id: string } | undefined)?.id ?? null;
    }
    if (!summaryId) { setRunEvents([]); return; }
    setRunEvents(await getRunEvents(summaryId, 60));
  }

  // "Stop / Reset" now only DISMISSES the local progress view + stops the
  // browser from polling. It deliberately does NOT kill the server run — run
  // liveness is owned by the server worker's heartbeat, never the browser.
  function handleStopResetPipeline() {
    stopPipeline();
    resetPipeline();
    setActiveRunSummaryId(null);
    setRunSnapshot(null);
    setPipelineState(getInitialPipelineState());
    if (busy === "pipeline") setBusy(null);
  }

  // ── Poll the active run from the DB (the SOLE source of truth) ─────────────
  // Survives tab switches, refreshes, route changes, and auth refresh because
  // the state lives in the database, not in browser memory.
  useEffect(() => {
    if (!activeRunSummaryId) return;
    let cancelled = false;
    let timer: number | undefined;

    const poll = async () => {
      let snap: RunProgressSnapshot | null = null;
      try {
        snap = await getRunProgress(activeRunSummaryId);
      } catch (e) {
        console.warn("[GroundSense run progress] poll error", e);
      }
      if (cancelled) return;

      if (!snap) {
        // Run row vanished — stop cleanly.
        setActiveRunSummaryId(null);
        setBusy((b) => (b === "pipeline" ? null : b));
        return;
      }

      // Server-worker liveness: if the run still says running/queued but the
      // SERVER heartbeat has gone silent for >5 min, the worker died (NOT the
      // browser). Expire it so the run row + button never get stuck forever.
      const heartbeatMs = snap.heartbeat_at ? new Date(snap.heartbeat_at).getTime() : new Date(snap.started_at).getTime();
      const heartbeatStale = Date.now() - heartbeatMs > 5 * 60_000;
      if (!TERMINAL_RUN_STATUSES.has(snap.status) && heartbeatStale) {
        if (company) await expireStaleRuns(company.id);
        setActiveRunSummaryId(null);
        setBusy((b) => (b === "pipeline" ? null : b));
        setPipelineState((p) => ({ ...p, running: false, error: "Run expired: server worker heartbeat stopped for over 5 minutes." }));
        setSchedulerRefresh((k) => k + 1);
        await loadDashboard();
        return;
      }

      setRunSnapshot(snap);
      setPipelineState(snapshotToPipelineState(snap));

      // Console progress — print on CHANGE only, sourced from persisted DB state.
      const sig = [
        snap.status, snap.current_stage, snap.progress_pct,
        snap.articles_inserted, snap.candidates_generated, snap.candidates_published,
        snap.heartbeat_at,
      ].join("|");
      if (sig !== lastProgressSigRef.current) {
        lastProgressSigRef.current = sig;
        console.info("[GroundSense run progress]", {
          runId: snap.pipeline_run_id,
          status: snap.status,
          stage: snap.current_stage,
          stageLabel: snap.current_stage_label,
          progressPct: snap.progress_pct,
          counters: {
            queries_executed: snap.queries_executed,
            articles_fetched: snap.articles_fetched,
            articles_inserted: snap.articles_inserted,
            candidates_generated: snap.candidates_generated,
            candidates_published: snap.candidates_published,
            candidates_review: snap.candidates_review,
            candidates_quarantined: snap.candidates_quarantined,
            verified_shocks_created: snap.verified_shocks_created,
          },
          latestEvent: snap.latestEvent?.message,
          heartbeatAt: snap.heartbeat_at,
        });
        if (snap.run_mode === "ultra_debug") {
          console.info("[GroundSense UltraDebug]", {
            runId: snap.pipeline_run_id,
            stage: snap.current_stage,
            status: snap.status,
            progressPct: snap.progress_pct,
            counters: {
              queries_executed: snap.queries_executed,
              articles_fetched: snap.articles_fetched,
              articles_normalized: snap.articles_normalized,
              articles_inserted: snap.articles_inserted,
              company_evaluations_created: snap.company_evaluations_created,
              candidates_generated: snap.candidates_generated,
            },
            latestEvent: snap.latestEvent?.message,
          });
        }
      }

      if (TERMINAL_RUN_STATUSES.has(snap.status)) {
        setActiveRunSummaryId(null);
        setBusy((b) => (b === "pipeline" ? null : b));
        setSchedulerRefresh((k) => k + 1);
        await loadDashboard(); // refresh dashboard with the completed run's output
        return;
      }

      timer = window.setTimeout(poll, 3000);
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [activeRunSummaryId]);

  // ── On mount / company change: resume an already-running server run ───────
  // If a run is alive in the DB (server heartbeat fresh), reattach to it so a
  // refresh or browser reopen shows live progress instead of nothing.
  useEffect(() => {
    if (!company || isDemoMode()) return;
    let cancelled = false;
    (async () => {
      try {
        const snap = await getActiveRunForCompany(company.id);
        if (cancelled || !snap) return;
        setRunSnapshot(snap);
        setPipelineState(snapshotToPipelineState(snap));
        setBusy((b) => b ?? "pipeline");
        setActiveRunSummaryId(snap.id);
        console.info("[GroundSense run progress] resumed active run from DB", {
          runId: snap.pipeline_run_id, status: snap.status, stage: snap.current_stage,
        });
      } catch (e) {
        console.warn("[GroundSense] active-run resume check failed", e);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [company?.id]);

  async function updateActionStatus(actionId: string, status: string) {
    const { error } = await supabase
      .from("risk_actions")
      .update({ status })
      .eq("id", actionId);

    if (error) {
      alert(error.message);
      return;
    }

    await loadDashboard();
  }

  function getEntities(type: string) {
    return entities
      .filter((entity) => entity.entity_type === type)
      .map((entity) => entity.entity_value)
      .join(", ");
  }



  function getMovement(
    title: string,
    snapshots: Snapshot[],
    field: "risk_title" | "opportunity_title",
    createdAt?: string | null
  ) {
    const matching = snapshots
      .filter((snapshot) => snapshot[field] === title)
      .sort(
        (a, b) =>
          new Date(b.snapshot_week).getTime() -
          new Date(a.snapshot_week).getTime()
      );

    if (matching.length < 2) {
      // Age-aware: "New" only when first detected within the last 7 days; older
      // first-seen items are "Existing", never perpetually "New".
      if (createdAt) {
        const ageDays = (Date.now() - new Date(createdAt).getTime()) / 86_400_000;
        if (Number.isFinite(ageDays)) return ageDays <= 7 ? "New" : "Existing";
      }
      return "Existing";
    }

    const current = matching[0].priority_score || 0;
    const previous = matching[1].priority_score || 0;
    const delta = current - previous;

    if (delta === 0) return "Unchanged";
    return delta > 0 ? `+${delta}` : String(delta);
  }

  // Raw generated arrays (before quality gate)
  const _allRiskItems = risks.filter(
    (risk) => !risk.display_section || risk.display_section === "risk_register"
  );
  const _allOperatingChanges = risks.filter(
    (risk) => risk.display_section === "operating_changes"
  );
  const _allWatchlistItems = risks.filter(
    (risk) => risk.display_section === "watchlist"
  );

  // Risk ids backed by a verified external shock (source fusion) — additive gate signal.
  const _verifiedShockRiskIds = useMemo(() => {
    const ids = new Set<string>();
    for (const r of [..._allRiskItems, ..._allOperatingChanges, ..._allWatchlistItems]) {
      const prov = buildIssueProvenance({ title: r.risk_title, category: r.issue_category, hasCalibratedOverlay: false }, verifiedShocks);
      // Only a PRIMARY verified/manual shock boosts the gate — "support" (BLS PPI) does not.
      if (prov.hasVerifiedShock && prov.externalStatusTone !== "support") ids.add(r.id);
    }
    return ids;
  }, [risks, verifiedShocks]); // eslint-disable-line react-hooks/exhaustive-deps

  // Quality gate: evaluate all generated candidates
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const _gateResults = useMemo(
    () => runQualityGateOnAll(
      [..._allRiskItems, ..._allOperatingChanges, ..._allWatchlistItems],
      opportunities,
      _verifiedShockRiskIds
    ),
    [risks, opportunities, _verifiedShockRiskIds] // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Published (executive-facing): the SERVER gate_status is the single source of
  // truth (numeric-shock-ledger generator). The client gate is kept only as an
  // additive signal; it must never override the server decision, or dashboard /
  // risk-page / brief counts diverge. Published = gate_status 'published'.
  const riskItems = _allRiskItems.filter((r) => (r as any).gate_status === "published");
  const operatingChanges = _allOperatingChanges.filter((r) => (r as any).gate_status === "published");
  // Watchlist = active (non-published) watch items, excluding superseded/archived rows.
  const watchlistItems = _allWatchlistItems.filter(
    (r) => (r as any).gate_status !== "published" && !(r as any).archived_at
  );
  const publishedOpportunities = opportunities.filter((o) => {
    const d = _gateResults.get(o.id)?.decision;
    return !d || d === "publish";
  });

  // Items blocked by quality gate → Candidate Review Queue
  // Risks: quarantine or candidate_review | Opportunities: quarantine or candidate_review
  const candidateQueueItems: CandidateQueueItem[] = [
    ...[..._allRiskItems, ..._allOperatingChanges, ..._allWatchlistItems]
      .filter((r) => {
        // Canonical: the server gate_status decides. A published issue is never in
        // the review queue, and watch items live in the Watchlist — not "pending
        // review". Only items the server did NOT route to published/watch may be
        // re-evaluated by the (advisory) client gate.
        const gs = (r as any).gate_status;
        if (gs === "published" || gs === "watch") return false;
        const d = _gateResults.get(r.id)?.decision;
        return d === "quarantine" || d === "candidate_review";
      })
      .map((r) => ({
        id: r.id,
        type: "risk" as const,
        title: r.risk_title || "Unnamed risk",
        gateResult: _gateResults.get(r.id)!,
      })),
    ...opportunities
      .filter((o) => {
        const d = _gateResults.get(o.id)?.decision;
        return d === "quarantine" || d === "candidate_review";
      })
      .map((o) => ({
        id: o.id,
        type: "opportunity" as const,
        title: o.title || "Unnamed opportunity",
        gateResult: _gateResults.get(o.id)!,
      })),
  ];

  // Published issue IDs — used to filter actions so quarantined candidates don't generate actions
  const publishedIssueIds = new Set([
    ...riskItems.map(r => r.id),
    ...operatingChanges.map(r => r.id),
    ...watchlistItems.map(r => r.id),
    ...publishedOpportunities.map(o => o.id),
  ]);

  // Actions linked only to published issues — hides actions from quarantined/review candidates
  const publishedActions = actions.filter(action => {
    if (action.risk_id) return publishedIssueIds.has(action.risk_id);
    if (action.opportunity_id) return publishedIssueIds.has(action.opportunity_id);
    return true;
  });

  const blockedOpportunityCount = candidateQueueItems.filter(i => i.type === "opportunity").length;

  // Canonical candidate taxonomy — used consistently across KPI, Opportunity Pipeline,
  // Risks "Items not promoted", and Quality Gate so the counts never disagree.
  const candidateSummary = {
    approved: publishedOpportunities.length,
    pendingReview: candidateQueueItems.filter((i) => i.gateResult.decision === "candidate_review").length,
    quarantined: candidateQueueItems.filter((i) => i.gateResult.decision === "quarantine").length,
  };
  const candidateSummaryLine =
    `${candidateSummary.approved} approved · ${candidateSummary.pendingReview} pending review` +
    (candidateSummary.quarantined > 0 ? ` · ${candidateSummary.quarantined} quarantined` : "");

  // Calibration Center workbench — single shared instance (drives both the top
  // metric and the Calibration Center section). Derived overrides flow back into
  // the effective calibration used by Operating Model Completeness + Scenario Editor.
  const calibrationController = useCalibrationWorkbench(
    company?.id ?? null,
    calibration,
    blockedOpportunityCount,
    setWorkbenchCalibration
  );
  // Merge base calibration with workbench-derived overrides so BOTH survive: workbench
  // values (freight/steel spend, etc.) win, but base-only fields (pass_through_coverage_pct,
  // gross margin, …) are preserved. Picking one or the other dropped base fields and caused
  // the tariff estimate's pass-through lookup to come back null → false scenario fallback.
  const effectiveCalibration = (calibration || workbenchCalibration)
    ? ({ ...(calibration ?? {}), ...(workbenchCalibration ?? {}) } as CompanyCalibrationInput)
    : null;
  // ── Calibration: three distinct concepts (never conflated) ───────────────────
  // 1) Local workbench coverage — localStorage/import state ONLY (browser-specific).
  const calibrationCoverage = calibrationController.workbench.summary.modelReliability;
  const calInputsCalibrated = calibrationController.workbench.summary.inputsCalibrated;
  const calInputsRequired = calibrationController.workbench.summary.inputsRequired;
  const localWorkbenchLoaded = calInputsCalibrated > 0 || calibrationCoverage > 0;

  // 2) Published-issue INPUT coverage — DB-backed reality: do the published issues
  //    each carry a complete formula + company inputs? This is the buyer-facing
  //    calibration signal and does NOT depend on the local workbench.
  const publishedIssuesForCoverage = [...riskItems, ...operatingChanges];
  const publishedWithInputs = publishedIssuesForCoverage.filter((r) => {
    const fi = (r as any).formula_inputs;
    return Boolean(
      (r as any).formula ||
        ((r as any).methodology && (r as any).methodology.formula) ||
        (fi && typeof fi === "object" && Object.keys(fi).length > 0)
    );
  }).length;
  const publishedTotal = publishedIssuesForCoverage.length;

  // 3) Calibration data-source label for the buyer KPI. Prefer the PERSISTED,
  //    DB-backed coverage (company_calibration_coverage) — stable across browsers.
  //    Only fall back to demo / local-workbench labels when no persisted record
  //    exists. localStorage state is never presented as company-wide truth.
  const calibrationSourceLabel = persistedCoverage
    ? `All-model calibration coverage: ${persistedCoverage.coverage_pct}% · ${persistedCoverage.domains_populated}/${persistedCoverage.domains_total} domains (DB-backed)`
    : isDemoMode()
      ? "Demo calibration available"
      : localWorkbenchLoaded
        ? `Local workbench coverage: ${calibrationCoverage}% (${calInputsCalibrated}/${calInputsRequired} inputs)`
        : "Local calibration workbench not loaded in this browser";

  // Labeled calibrated-exposure overlay (Part 8) — recomputed from imported rows,
  // shown alongside (never replacing) the stored evidence-backed/scenario values.
  const freightRowCount = calibrationController.state.domains.freight?.rows.length ?? 0;
  const supplierRowCount = calibrationController.state.domains.supplier?.rows.length ?? 0;
  const freightCalibrated = freightRowCount > 0 ? freightCalibratedExposure(effectiveCalibration, freightRowCount) : null;
  const steelCalibrated = supplierRowCount > 0 ? steelCalibratedExposure(effectiveCalibration, supplierRowCount) : null;
  const calibratedKeys = Object.keys(calibrationController.workbench.derivedOverrides);

  // Executive Point-Estimate Mode — source-backed point estimates per issue (view-model only;
  // original risk_register ranges are never overwritten, only hidden behind methodology).
  const execMode = EXECUTIVE_POINT_ESTIMATE_MODE;
  // Computed fresh each render (like issue provenance) so it always reflects the latest
  // verified shocks + merged calibration — avoids memo staleness on async data loads.
  // Executive value/graph/driver derive from ALL active published issues (risks AND
  // operating changes), never only the risk_register section. A run that reclassifies the
  // tariff into the operating-changes section must NOT drop it from value at stake / exposure
  // graph / driver map — that was the regression where tariff vanished from exec but stayed
  // in outcome tracking (internal inconsistency).
  const execPublishedIssues = [...riskItems, ...operatingChanges];
  const execByIssueId = new Map<string, ExecutiveEstimate>();
  for (const r of execPublishedIssues) {
    execByIssueId.set(r.id, getExecutiveImpactEstimate(r, verifiedShocks, effectiveCalibration));
  }
  const execRiskEstimates = execPublishedIssues
    .map((r) => execByIssueId.get(r.id))
    .filter((e): e is ExecutiveEstimate => !!e);
  const execTotalRisk = sumExecutiveEstimates(execRiskEstimates);
  const execFreight = execRiskEstimates.find((e) => e.kind === "freight") ?? null;
  const execTariff = execRiskEstimates.find((e) => e.kind === "tariff") ?? null;
  // Section-scoped exec totals so the Risks page never attaches the full freight+tariff total
  // to the risk-only register: Risk Register shows risk-section only, Operating Changes shows
  // operating-change section only, and execTotalRisk remains the page-level value at stake.
  const execRiskSectionTotal = sumExecutiveEstimates(
    riskItems.map((r) => execByIssueId.get(r.id)).filter((e): e is ExecutiveEstimate => !!e)
  );
  const execChangeSectionTotal = sumExecutiveEstimates(
    operatingChanges.map((r) => execByIssueId.get(r.id)).filter((e): e is ExecutiveEstimate => !!e)
  );
  // Issue title -> executive point-estimate display (for the Driver Priority Map) — over all
  // active published issues so the tariff driver carries its estimate regardless of section.
  const execImpactByTitle: Record<string, string> = {};
  for (const r of execPublishedIssues) {
    const e = execByIssueId.get(r.id);
    if (e && r.risk_title) execImpactByTitle[r.risk_title] = e.value === null ? "Needs validation" : `${e.display} · ${e.sourceLabel}`;
  }

  // Real action owner/due per issue_key, so the Exposure Graph action nodes match the
  // Executive Actions card (same canonical risk_actions records — no hardcoded graph dates).
  // Formatted identically to ActionRoiPanel.formatDate so the displayed dates agree exactly.
  const fmtActionDue = (d: string | null | undefined) =>
    d ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";
  const actionByIssueKey = new Map<string, { owner: string; due: string }>();
  for (const a of actions as any[]) {
    if (a.issue_key && !actionByIssueKey.has(a.issue_key)) {
      actionByIssueKey.set(a.issue_key, { owner: a.owner ?? "", due: fmtActionDue(a.deadline) });
    }
  }

  // Company Exposure Graph — canonical 2D operating map. Consumes the same exec estimates
  // as the dashboard cards (never recomputes a different total).
  // Every published active issue (risk + operating change) must materialize an
  // exposure path. Canonical freight/tariff paths are deduped by driver inside
  // the view model, so demo behavior is unchanged; article-derived issues
  // (e.g. steel/supplier) now appear instead of yielding 0 active paths.
  // Real calibrated exposure basis + scenario formula for an issue's driver — so
  // the exposure path shows actual inputs ("$37.6M steel-linked spend × 20%
  // unpassed …") instead of placeholder text. Returns nulls when there's no
  // calibrated basis (the path then honestly says "calibration pending").
  const publishedIssuesForGraph = [...riskItems, ...operatingChanges].map((r) => {
    const est = execByIssueId.get(r.id) ?? null;
    // Canonical: dollar + formula + source all come from the stored numeric basis
    // (via the rewritten executive estimate), never recomputed from calibration.
    const impactDisplay = est && est.value !== null ? est.display : formatExecutiveEstimate(Number(r.impact_high || 0) || null);
    const action = publishedActions.find((a) => a.risk_id === r.id) ?? null;
    const meth = (r.methodology ?? {}) as Record<string, unknown>;
    const driver = String(meth.driver_template || "")
      || (String(r.risk_type || "").includes("freight") ? "freight"
        : String(r.risk_type || "").includes("fuel") ? "fuel"
        : String(r.risk_type || "").includes("commodity") ? "metals" : "supply");
    const nbType = (r as any).numeric_basis_type ?? "no_numeric_basis";
    const evidenceBacked = ["official_structured_metric", "manual_structured_metric", "company_structured_metric"].includes(nbType);
    const articleBacked = nbType === "article_numeric_claim";
    const calculation = est?.calculation ?? (typeof meth.formula === "string" ? (meth.formula as string) : null);
    const exposureText = String(r.exposure_interpretation || "") || null;
    const isChange = r.display_section === "operating_changes";
    return {
      id: r.id,
      title: r.risk_title,
      driver,
      issueType: isChange ? "Operating Change" : "Operating Risk",
      impactDisplay,
      calculation,
      exposureText,
      evidenceStatus: evidenceBacked ? "evidence_backed" : articleBacked ? "article_claimed" : "scenario_modeled",
      sourceLabel: (r as any).numeric_basis_source_label ?? null,
      action: action
        ? { title: action.title, owner: action.owner || "Unassigned", due: fmtActionDue(action.deadline), nextStep: null }
        : null,
    };
  });

  const exposureGraphModel = buildExposureGraphViewModel({
    execFreight,
    execTariff,
    verifiedShocks,
    calibration: effectiveCalibration,
    blockedCandidateTitles: candidateQueueItems.filter((i) => i.type === "opportunity").map((i) => i.title),
    valueAtStakeDisplay: formatExecutiveEstimate(execTotalRisk),
    // Direction-split totals — downside risk and favorable relief are never merged into one figure.
    downsideAtStakeDisplay: formatExecutiveEstimate(execRiskSectionTotal),
    favorableReliefDisplay: execChangeSectionTotal > 0 ? formatExecutiveEstimate(execChangeSectionTotal) : undefined,
    freightAction: actionByIssueKey.get("freight_logistics_pressure"),
    tariffAction: actionByIssueKey.get("tariff_trade_policy_relief"),
    publishedIssues: publishedIssuesForGraph,
  });

  // Canonical issue taxonomy: tariff items are Operating Changes, not downside risks.
  const pluralize = (n: number, s: string) => `${n} ${s}${n === 1 ? "" : "s"}`;

const totalRiskHigh = riskItems.reduce(
  (sum, risk) => sum + Number(risk.impact_high || 0),
  0
);

const totalRiskLow = riskItems.reduce(
  (sum, risk) => sum + Number(risk.impact_low || 0),
  0
);
// Use numeric_basis_type as the canonical source of truth for issue model status (FIX 3/6).
// "Evidence-backed" = official government/BLS/manual structured metric.
// "Article-claimed" = extracted from article body text (lower trust, validation required).
// "Scenario-modeled" = no verified external number — calibration scenario only.
const evidenceBackedRiskItems = riskItems.filter(
  (risk) => ["official_structured_metric", "manual_structured_metric"].includes(
    (risk as any).numeric_basis_type ?? "no_numeric_basis"
  )
);

const articleClaimRiskItems = riskItems.filter(
  (risk) => (risk as any).numeric_basis_type === "article_numeric_claim"
);

const scenarioRiskItems = riskItems.filter(
  (risk) => ((risk as any).numeric_basis_type ?? "no_numeric_basis") === "no_numeric_basis"
    && getIssueModelStatus(risk.methodology).status !== "needs_calibration"
);

const needsCalibrationRiskItems = riskItems.filter(
  (risk) => getIssueModelStatus(risk.methodology).status === "needs_calibration"
);

function riskExposureSubtitle() {
  if (riskItems.length === 0) return "No modeled downside";

  if (evidenceBackedRiskItems.length > 0 && scenarioRiskItems.length > 0) {
    return "Official metric-backed + scenario downside";
  }

  if (evidenceBackedRiskItems.length > 0) {
    return "Official metric-backed downside";
  }

  if (scenarioRiskItems.length > 0) {
    return "Scenario-modeled downside";
  }

  if (needsCalibrationRiskItems.length > 0) {
    return "Needs calibration";
  }

  return "Modeled downside";
}
  const totalOpportunityHigh = publishedOpportunities.reduce(
    (sum, opportunity) => sum + Number(opportunity.revenue_high || 0),
    0
  );

  const totalOpportunityLow = publishedOpportunities.reduce(
    (sum, opportunity) => sum + Number(opportunity.revenue_low || 0),
    0
  );

  // All evidence (including from rejected items) for the Evidence Sources metric
  const allEvidenceItems: any[] = [
    ...riskItems.flatMap((r) => r.evidence_items || []),
    ...operatingChanges.flatMap((r) => r.evidence_items || []),
    ...opportunities.flatMap((o) => o.evidence_items || []),
  ];
  const uniqueEvidenceSources = new Set(
    allEvidenceItems.map((e) => String(e.source || e.source_name || "")).filter(Boolean)
  ).size;
  const avgEvidenceQuality =
    allEvidenceItems.length > 0
      ? Math.round(
          allEvidenceItems.reduce((s, e) => s + (Number(e.source_quality) || 50), 0) /
            allEvidenceItems.length
        )
      : 0;

  // Official numeric-ledger coverage for the Evidence Sources KPI: each published
  // metric-backed issue is one official metric observation, sourced from a distinct
  // official source (BLS, EIA, …). Derived from the numeric basis on each published
  // issue — NOT from evidence_items.source — so it always matches the published set.
  const officialMetricIssues = [...riskItems, ...operatingChanges].filter((r) =>
    ["official_structured_metric", "manual_structured_metric", "company_structured_metric"].includes(
      (r as any).numeric_basis_type ?? "no_numeric_basis"
    )
  );
  const officialMetricObservations = officialMetricIssues.length;
  const officialSourceCount = new Set(
    officialMetricIssues
      .map((r) => String((r as any).numeric_basis_source_label || ""))
      // Normalize "Official metric · BLS …" / raw labels down to the issuing agency.
      .map((s) => (/\bBLS\b/i.test(s) ? "BLS" : /\bEIA\b/i.test(s) ? "EIA" : /\bFRED\b/i.test(s) ? "FRED" : /\bUSITC\b/i.test(s) ? "USITC" : /\bcensus\b/i.test(s) ? "Census" : s.trim()))
      .filter(Boolean)
  ).size;

  const actionRoiItems = useMemo((): ActionRoiItem[] => {
    const items: ActionRoiItem[] = publishedActions.map((action) => {
      const linkedRisk = action.risk_id
        ? risks.find((r) => r.id === action.risk_id)
        : null;
      const linkedOpp = action.opportunity_id
        ? opportunities.find((o) => o.id === action.opportunity_id)
        : null;

      // Derive workflow fields from the linked issue
      const derivedFields = deriveActionRoiFields(action, linkedRisk ?? null, linkedOpp ?? null);

      const safeTitle = isFreightIssue({ risk_title: linkedRisk?.risk_title, issue_category: (linkedRisk as any)?.issue_category })
        ? "Validate spot-exposed freight lanes and surcharge exposure"
        : isTariffIssue({ risk_title: linkedRisk?.risk_title, issue_category: (linkedRisk as any)?.issue_category })
        ? "Validate tariff relief — confirm supplier landed-cost updates and remaining exposure"
        : action.title;

      // Executive point-estimate benefit/protected value from the linked issue (no ranges).
      const execEst = linkedRisk ? execByIssueId.get(linkedRisk.id) ?? null : null;
      const isFavorableIssue = (linkedRisk as any)?.display_section === "operating_changes" || (linkedRisk as any)?.issue_direction === "favorable";
      const execBenefit = execEst
        ? execEst.value === null
          ? "Needs validation"
          : isFavorableIssue
          ? `${execEst.display} relief opportunity under review`
          : `${execEst.display} exposure under review`
        : null;
      const execProtected = execEst && execEst.value !== null
        ? execEst.kind === "tariff"
          ? `${execEst.display} tariff relief validation opportunity`
          : `${formatExecutiveEstimate(execEst.value * 0.2)} if action reduces impact by 20%`
        : null;

      return {
        id: action.id,
        title: safeTitle,
        linkedIssueTitle: linkedRisk?.risk_title || linkedOpp?.title || null,
        owner: action.owner || derivedFields.owner,
        deadline: action.deadline || derivedFields.deadline,
        status: action.status || "open",
        expectedBenefitLow: linkedRisk ? linkedRisk.impact_low : (linkedOpp ? linkedOpp.revenue_low : null),
        expectedBenefitHigh: linkedRisk ? linkedRisk.impact_high : (linkedOpp ? linkedOpp.revenue_high : null),
        effortLevel: derivedFields.effortLevel,
        protectedValue: linkedRisk ? linkedRisk.impact_low : null,
        execBenefit,
        execProtected,
        successCondition: derivedFields.successCondition,
        nextStep: derivedFields.nextStep,
        decisionTrigger: derivedFields.decisionTrigger,
        outcomeStatus: action.status === "completed" ? "Completed" : "Open — awaiting validation",
      };
    });

    // Derive a validation action for active published operating changes that have no real
    // action row (the generator only creates actions for risk-section issues, so the tariff
    // relief operating change otherwise loses its action). Keeps actions in sync with the
    // active published executive issues, regardless of which section a run placed them in.
    const linkedIssueIds = new Set(publishedActions.map((a) => a.risk_id).filter(Boolean));
    for (const oc of operatingChanges) {
      if (linkedIssueIds.has(oc.id)) continue;
      const execEst = execByIssueId.get(oc.id) ?? null;
      const tariff = isTariffIssue(oc);
      if (!tariff && !(execEst && execEst.value !== null)) continue; // only actionable, dollarized changes
      const dl = new Date();
      dl.setUTCDate(dl.getUTCDate() + 25);
      items.push({
        id: `derived-action-${oc.id}`,
        title: tariff
          ? "Validate tariff relief — confirm supplier landed-cost updates and remaining exposure"
          : `Validate ${oc.risk_title}`,
        linkedIssueTitle: oc.risk_title,
        owner: tariff ? "Head of Procurement" : "Operating Owner",
        deadline: dl.toISOString().slice(0, 10),
        status: "open",
        expectedBenefitLow: oc.impact_low,
        expectedBenefitHigh: oc.impact_high,
        effortLevel: "Medium",
        protectedValue: oc.impact_low,
        execBenefit: execEst && execEst.value !== null ? `${execEst.display} relief opportunity under review` : null,
        execProtected: null,
        successCondition: "Supplier landed-cost updates confirmed; affected SKUs and open-PO exposure validated.",
        nextStep:
          "Pull supplier country-of-origin list and validate steel-linked import exposure; flag aluminum/copper separately if additional tariff metrics or supplier evidence are available.",
        decisionTrigger: "Treat modeled relief as realized only after procurement validates supplier landed costs.",
        outcomeStatus: "Open — awaiting validation",
      });
    }
    // Sort by business relevance: largest dollar impact first (freight → diesel →
    // steel → copper → aluminum), favorable value-capture included.
    return [...items].sort(
      (a, b) =>
        Math.abs(Number(b.expectedBenefitHigh ?? b.protectedValue ?? 0)) -
        Math.abs(Number(a.expectedBenefitHigh ?? a.protectedValue ?? 0))
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publishedActions, risks, opportunities, execByIssueId, operatingChanges]);

  // Open actions = active (non-completed) actions across the full action list, including
  // the derived operating-change validation actions above.
  const openActions = actionRoiItems.filter((a) => a.status !== "completed").length;

  const driverPriorityReport = useMemo(
    () => computeDriverPriority(
      riskItems,
      publishedOpportunities,
      effectiveCalibration as Record<string, number | null> | null,
      operatingChanges
    ),
    [riskItems, publishedOpportunities, effectiveCalibration, operatingChanges]
  );

  const forecastRows = useMemo(() => {
    return [
      ...riskItems.map((r) => {
        const safeStatus = getForecastSummary(r as any);
        const modelStatus = getIssueModelStatus(r.methodology);
        const metricBacked = ["official_structured_metric", "manual_structured_metric", "company_structured_metric", "article_numeric_claim"].includes((r as any).numeric_basis_type ?? "no_numeric_basis");
        return {
          issueId: r.id,
          // Canonical taxonomy: tariff items render as Operating Change, not Risk.
          issueType: (isTariffIssue(r) ? "operating_change" : "risk") as "risk" | "operating_change",
          title: r.risk_title,
          forecastDate: null as string | null,
          predictedLow: r.impact_low,
          predictedHigh: r.impact_high,
          currentStatus: safeStatus,
          outcomeStatus: "open" as const,
          actualImpact: null as number | null,
          execEstimate: execByIssueId.get(r.id)?.display ?? "Needs validation",
          outcomeNotes: metricBacked
            ? `${(r as any).numeric_basis_source_label ?? "Official metric"} — tracking realized vs modeled`
            : modelStatus.status === "scenario_fallback"
            ? "Scenario-modeled — awaiting validation"
            : "Validation pending",
        };
      }),
      ...operatingChanges.map((r) => {
        const safeStatus = getForecastSummary(r as any);
        return {
          issueId: r.id,
          issueType: "operating_change" as const,
          title: r.risk_title,
          forecastDate: null as string | null,
          predictedLow: r.impact_low,
          predictedHigh: r.impact_high,
          currentStatus: safeStatus,
          outcomeStatus: "awaiting_data" as const,
          actualImpact: null as number | null,
          execEstimate: execByIssueId.get(r.id)?.display ?? "Needs validation",
          outcomeNotes: "Awaiting procurement validation",
        };
      }),
      ...publishedOpportunities.map((o) => {
        const safeStatus = getForecastSummary({
          title: o.title,
          summary: o.summary,
          issue_category: null,
          methodology: o.methodology as Record<string, unknown> | null,
        });
        const quality = getOpportunityQuality(o);
        return {
          issueId: o.id,
          issueType: "opportunity" as const,
          title: isManufacturingOpportunity(o) ? "Manufacturing Demand Opportunity Candidate" : quality === "needs_validation"
            ? o.title.replace(/opportunity/i, "Opportunity Candidate")
            : o.title,
          forecastDate: null as string | null,
          predictedLow: o.revenue_low,
          predictedHigh: o.revenue_high,
          currentStatus: safeStatus,
          outcomeStatus: quality === "needs_validation"
            ? ("awaiting_data" as const)
            : quality === "candidate"
            ? ("monitoring_only" as const)
            : ("open" as const),
          actualImpact: null as number | null,
          execEstimate: "Needs validation",
          outcomeNotes: quality === "needs_validation"
            ? "Not eligible for accuracy scoring until validated"
            : quality === "candidate"
            ? "Candidate upside — validate before treating as forecast"
            : null,
        };
      }),
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [riskItems, operatingChanges, publishedOpportunities, execByIssueId]);

  if (loading) {
    return (
      <main className="dashboard-page">
        <div className="dashboard-container" aria-label="Loading dashboard" aria-busy="true">
          <div className="skeleton-grid">
            {[...Array(6)].map((_, i) => <div key={i} className="skeleton-metric" aria-hidden="true" />)}
          </div>
          <div className="skeleton-card" aria-hidden="true" />
          <div className="skeleton-card skeleton-card--short" aria-hidden="true" />
        </div>
      </main>
    );
  }

  return (
    <main className="dashboard-page">
      <div className="dashboard-container">
        {dashError && (
          <div className="dash-error-banner" role="alert">
            <strong>Error loading dashboard:</strong> {dashError}
          </div>
        )}
        <header className="dashboard-header">
          <div>
            <h1 className="dashboard-title">{view === "risks" ? "Risks" : "Executive Intelligence"}</h1>
            <p className="dashboard-subtitle">
              {view === "risks"
                ? "Published issues, operating changes, candidate review, and evidence quality."
                : `Official numeric signals mapped to ${company?.name ?? "your company's"} exposure, P&L impact, and actions.`}
            </p>
            {view === "risks" && (
              <p className="dashboard-subtitle" style={{ marginTop: 6, fontWeight: 600, color: "var(--text-secondary)" }}>
                {pluralize(riskItems.length + operatingChanges.length, "published item")} · Downside {formatExecutiveEstimate(execRiskSectionTotal)}{execChangeSectionTotal > 0 ? ` · Favorable relief ${formatExecutiveEstimate(execChangeSectionTotal)}` : ""} · {pluralize(riskItems.length, "operating risk")} · {pluralize(operatingChanges.length, "operating change")}
              </p>
            )}
          </div>

        </header>

        {!isDemoMode() &&
          riskItems.length === 0 &&
          operatingChanges.length === 0 &&
          watchlistItems.length === 0 &&
          candidateQueueItems.length === 0 && (
            <section className="gs-empty-state">
              <h2 className="gs-empty-title">No published issues yet</h2>
              <p className="gs-empty-body">
                {view === "risks"
                  ? "Once you run an intelligence update, verified risks and operating changes will appear here, scoped to your company."
                  : "Add your operating data, then run your first intelligence update to turn external shocks into company-specific exposure."}
              </p>
              <ul className="gs-empty-steps">
                <li>Upload supplier data to validate tariff exposure.</li>
                <li>Upload freight lanes to quantify logistics risk.</li>
                <li>Run an intelligence update to generate your first issues.</li>
              </ul>
              <div className="gs-empty-actions">
                <Link to="/calibration" className="secondary-button">Add calibration data</Link>
              </div>
            </section>
          )}

        <div className="gs-dash-layout">
        {view === "dashboard" && <DashboardSidebar />}
        <div className="gs-dash-main">

        {/* Demo workspace banner — read-only sample data. */}
        {view === "dashboard" && isDemoMode() && (
          <section className="gs-demo-banner">
            <span><b>Demo workspace</b> · read-only sample data (Fastenal). Sign up to build your own.</span>
            <Link to="/sign-up"><button className="primary-button">Get started</button></Link>
          </section>
        )}

        {/* Operator mode badge + one-click exit (so operator view can never get stuck). */}
        {canViewAdminControls() && (
          <section className="gs-operator-banner">
            <span className="gs-operator-badge">● Operator Mode</span>
            <span className="gs-operator-note">Admin / pipeline / source-audit controls are visible. Buyers never see these.</span>
            <button className="gs-operator-leave" onClick={leaveOperatorMode}>Leave operator mode →</button>
          </section>
        )}

        {/* ── Primary toolbar (dashboard only; Risks is a read/review surface) ── */}
        {view === "dashboard" && (
        <>
        <section className="toolbar toolbar-primary">
          {canViewAdminControls() && (
            <>
              <button
                className="primary-button toolbar-run-btn"
                onClick={() => handleRunIntelligenceUpdate(false)}
                disabled={busy !== null}
              >
                {busy === "pipeline"
                  ? `Updating Intelligence…`
                  : "Run Intelligence Update"}
              </button>

              <button
                className="primary-button"
                onClick={() => run("brief", () => generateBriefForCompany(company!.id))}
                disabled={busy !== null}
              >
                {busy === "brief" ? "Generating…" : "Generate Executive Brief"}
              </button>
            </>
          )}

          {canViewAdminControls() && (!execMode || showAdvancedPipeline) && (
            <button
              className="toolbar-stop-btn"
              onClick={handleStopResetPipeline}
              disabled={!pipelineState.running && busy !== "pipeline"}
              title="Stop / Reset Pipeline"
            >
              ■ Stop / Reset
            </button>
          )}

          <div className="toolbar-secondary-group">
            {canViewAdminControls() && (
              <Link to="/calibration">
                <button className="secondary-button" disabled={busy !== null}>Calibrate Model</button>
              </Link>
            )}
            <Link to="/sources">
              <button className="secondary-button" disabled={busy !== null}>Source Hub</button>
            </Link>
            {canViewAdminControls() && (
              <button className="secondary-button" disabled title="Generate an Executive Brief first to enable export">Export Memo</button>
            )}
            {/* Internal/admin controls — hidden from the default executive view. */}
            {canViewAdminControls() && (!execMode || showAdvancedPipeline) && (
              <>
                <button
                  className="secondary-button"
                  onClick={() => handleRunIntelligenceUpdate(true)}
                  disabled={busy !== null}
                  title="Re-seed signals and force a full company-scoped run (bypasses no-change shortcuts)"
                >
                  Force full run
                </button>
                <Link to="/onboarding">
                  <button className="secondary-button" disabled={busy !== null}>Add Company</button>
                </Link>
                <Link to="/calibration">
                  <button className="secondary-button" disabled={busy !== null}>Approve Assumptions</button>
                </Link>
              </>
            )}
          </div>

          {canViewAdminControls() && (
            <button
              className="text-button toolbar-advanced-toggle"
              onClick={() => setShowAdvancedPipeline((v) => !v)}
            >
              {showAdvancedPipeline ? "▲ Hide advanced / admin controls" : "▼ Advanced / admin controls"}
            </button>
          )}
        </section>

        {/* ── Structured start-failure + diagnostics ── */}
        {startError && (
          <section className="run-start-error-card">
            <div className="run-start-error-head">
              <span className="run-start-error-title">Could not start run</span>
              <code className="run-start-error-code">{startError.errorCode}</code>
              {startError.httpStatus != null && <span className="run-start-error-http">HTTP {startError.httpStatus}</span>}
              {startError.stage && <span className="run-start-error-stage">stage: {startError.stage}</span>}
              <button className="pipeline-dismiss-btn" onClick={() => { setStartError(null); setEdgeHealth(null); }} title="Dismiss">✕</button>
            </div>
            <p className="run-start-error-message">{startError.message}</p>
            <p className="run-start-error-fix">{startError.suggestedFix ?? suggestedFix(startError.errorCode)}</p>
            <div className="run-start-error-actions">
              <button className="secondary-button" onClick={handleTestEdgeHealth} disabled={healthBusy}>
                {healthBusy ? "Testing…" : "Test Edge Function health"}
              </button>
              <button className="primary-button" onClick={() => handleRunIntelligenceUpdate(false)} disabled={busy !== null}>Retry</button>
              <button className="secondary-button" onClick={handleViewRunEvents}>Run diagnostics</button>
            </div>
            {edgeHealth && (
              <div className={`edge-health edge-health-${edgeHealth.reachable ? (edgeHealth.ok ? "ok" : "warn") : "down"}`}>
                <b>Healthcheck @ {edgeHealth.host}:</b>{" "}
                {!edgeHealth.reachable
                  ? `unreachable (${edgeHealth.error ?? "no response"}) — function not deployed or CORS/network blocked.`
                  : edgeHealth.ok
                    ? `ok · db_reachable=${String(edgeHealth.body?.db_reachable)} · run_schema_ready=${String(edgeHealth.body?.run_schema_ready)} · ${JSON.stringify(edgeHealth.body?.secrets_present ?? {})}`
                    : `reachable but NOT ready (HTTP ${edgeHealth.httpStatus}) · run_schema_ready=${String(edgeHealth.body?.run_schema_ready)} · missing=${JSON.stringify(edgeHealth.body?.missing_columns ?? [])}`}
              </div>
            )}
          </section>
        )}

        {/* ── Run events drawer (diagnostics) ── */}
        {runEvents && (
          <section className="run-events-drawer">
            <div className="run-events-head">
              <span>Run events ({runEvents.length})</span>
              <button className="pipeline-dismiss-btn" onClick={() => setRunEvents(null)} title="Close">✕</button>
            </div>
            <ol className="run-events-list">
              {runEvents.length === 0 && <li className="run-event-empty">No events recorded for the latest run.</li>}
              {runEvents.map((ev) => (
                <li key={ev.id} className={`run-event run-event-${ev.level}`}>
                  <span className="run-event-stage">{ev.stage}</span>
                  <span className="run-event-msg">{ev.message}</span>
                  <span className="run-event-time">{formatAgo(ev.created_at)}</span>
                </li>
              ))}
            </ol>
          </section>
        )}

        {/* ── Pipeline progress card ── */}
        {(pipelineState.running || pipelineState.completedAt !== null || (pipelineState.error !== null && !startError)) && (
          <section className="pipeline-progress-card">
            <div className="pipeline-progress-header">
              {pipelineState.running && (
                <span className="pipeline-progress-title">Running intelligence update…</span>
              )}
              {!pipelineState.running && pipelineState.error && (
                <span className="pipeline-progress-title pipeline-error-title">
                  Pipeline stopped — {pipelineState.error}
                </span>
              )}
              {!pipelineState.running && !pipelineState.error && pipelineState.completedAt && (
                <span className="pipeline-progress-title pipeline-complete-title">
                  Intelligence update complete
                </span>
              )}
              <button
                className="pipeline-dismiss-btn"
                onClick={() => { setActiveRunSummaryId(null); setRunSnapshot(null); setPipelineState(getInitialPipelineState()); }}
                title="Dismiss"
              >
                ✕
              </button>
            </div>

            {/* Live, DB-sourced run telemetry — survives tab close/refresh. */}
            {runSnapshot && (
              <div className="run-progress-meta">
                <div className="run-progress-bar">
                  <div
                    className="run-progress-bar-fill"
                    style={{ width: `${Math.max(0, Math.min(100, runSnapshot.progress_pct ?? 0))}%` }}
                  />
                </div>
                <div className="run-progress-meta-row">
                  <span className="run-progress-stage">
                    {runSnapshot.current_stage_label ?? "Working…"}
                    {runSnapshot.current_stage_index != null && runSnapshot.total_stages
                      ? ` (${runSnapshot.current_stage_index}/${runSnapshot.total_stages})`
                      : ""}
                  </span>
                  <span className={`run-progress-status run-progress-status-${runSnapshot.status}`}>
                    {runSnapshot.status}
                  </span>
                  <span>{runSnapshot.run_mode ?? "full"}{runSnapshot.force ? " · force" : ""}</span>
                  <span title="Server worker heartbeat">♥ {formatAgo(runSnapshot.heartbeat_at)}</span>
                  <span>elapsed {formatElapsed(runSnapshot.started_at, runSnapshot.completed_at)}</span>
                </div>
                {runSnapshot.latestEvent && (
                  <p className="run-progress-event">{runSnapshot.latestEvent.message}</p>
                )}
                <div className="run-progress-counters">
                  {RUN_COUNTER_FIELDS.map(([key, label]) => (
                    <span key={String(key)} className="run-counter">
                      <b>{Number((runSnapshot as Record<string, unknown>)[key as string] ?? 0)}</b> {label}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <ol className="pipeline-steps-list">
              {pipelineState.steps.map((step) => (
                <li key={step.id} className={`pipeline-step pipeline-step-${step.status}`}>
                  <span className="pipeline-step-icon">
                    {step.status === "complete" && "✓"}
                    {step.status === "running" && <span className="pipeline-spinner" />}
                    {step.status === "failed" && "✗"}
                    {step.status === "skipped" && "–"}
                    {step.status === "pending" && "·"}
                  </span>
                  <span className="pipeline-step-label">{step.label}</span>
                  {step.status === "failed" && step.error && (
                    <span className="pipeline-step-error">{step.error.slice(0, 100)}</span>
                  )}
                </li>
              ))}
            </ol>
          </section>
        )}

        {/* ── Advanced pipeline controls (collapsed by default) ── */}
        {showAdvancedPipeline && (
          <section className="toolbar toolbar-advanced">
            <p className="toolbar-advanced-note">
              Advanced controls are for debugging individual pipeline stages. Most users should use <strong>Run Intelligence Update</strong>.
            </p>
            {/* ── Ultra Debug / run diagnostics (server-owned) ── */}
            <div className="ultra-debug-group">
              <button className="secondary-button" onClick={handleTestEdgeHealth} disabled={healthBusy}>
                {healthBusy ? "Testing…" : "Test Edge Function health"}
              </button>
              <button className="secondary-button" onClick={handleUltraDebugRun} disabled={busy !== null} title="Full server stages, capped queries/articles, server keys only">
                Start ultra debug run
              </button>
              <button className="secondary-button" onClick={handleDryRun} disabled={busy !== null} title="Fetch + normalize + score only — no inserts/generation (quota-safe)">
                Dry run
              </button>
              <button className="secondary-button" onClick={handleExpireStaleRuns} disabled={busy === "pipeline"} title="Expire stale server-heartbeat runs and release locks">
                Expire stale runs
              </button>
              <button className="secondary-button" onClick={handleViewRunEvents}>
                View run events
              </button>
            </div>
            <button
              className="secondary-button"
              onClick={() => run("fresh", () => fetchFreshIntelligenceForCompany(company!.id))}
              disabled={busy !== null}
            >
              {busy === "fresh" ? "Fetching…" : "Refresh Intelligence (Currents)"}
            </button>
            <button
              className="secondary-button"
              onClick={() => stopFreshIntelligenceBatch()}
            >
              Stop Fresh Batch
            </button>
            <button
              className="secondary-button"
              onClick={() => run("article-bodies", () => fetchArticleContentForCompany(company!.id))}
              disabled={busy !== null}
            >
              {busy === "article-bodies" ? "Fetching…" : "Fetch Article Bodies"}
            </button>
            <button
              className="secondary-button"
              onClick={() => run("fetch", () => fetchEventsForCompany(company!.id))}
              disabled={busy !== null}
            >
              {busy === "fetch" ? "Fetching…" : "Fetch Events"}
            </button>
            <button
              className="secondary-button"
              onClick={() =>
                run("score", async () => {
                  await scoreEventsForCompany(company!.id);
                  await matchEventsToConnections(company!.id);
                })
              }
              disabled={busy !== null}
            >
              {busy === "score" ? "Scoring…" : "Score Events"}
            </button>
            <button
              className="secondary-button"
              onClick={() => run("connections", () => buildConnectionsForCompany(company!.id))}
              disabled={busy !== null}
            >
              {busy === "connections" ? "Building…" : "Build Connections"}
            </button>
            <button
              className="secondary-button"
              onClick={() => run("match-connections", async () => { await matchEventsToConnections(company!.id); })}
              disabled={busy !== null}
            >
              {busy === "match-connections" ? "Matching…" : "Match Events to Connections"}
            </button>
            <button
              className="secondary-button"
              onClick={() =>
                run("risks", async () => {
                  await generateDynamicRisksForCompany(company!.id);
                  await matchEventsToConnections(company!.id);
                  await attachConnectionsToRisks(company!.id);
                })
              }
              disabled={busy !== null}
            >
              {busy === "risks" ? "Generating…" : "Generate Risks"}
            </button>
            <button
              className="secondary-button"
              onClick={() =>
                run("opportunities", async () => {
                  await generateOpportunitiesForCompany(company!.id);
                  await matchEventsToConnections(company!.id);
                  await attachConnectionsToRisks(company!.id);
                  await generateSpecificExplanationsForCompany(company!.id);
                })
              }
              disabled={busy !== null}
            >
              {busy === "opportunities" ? "Generating…" : "Generate Opportunities"}
            </button>
            <button
              className="secondary-button"
              onClick={() => run("specific-explanations", () => generateSpecificExplanationsForCompany(company!.id))}
              disabled={busy !== null}
            >
              {busy === "specific-explanations" ? "Explaining…" : "Generate Specific Explanations"}
            </button>
            <button
              className="secondary-button"
              onClick={() => run("graph", () => buildExposureGraphForCompany(company!.id))}
              disabled={busy !== null}
            >
              {busy === "graph" ? "Building…" : "Build Exposure Graph"}
            </button>
          </section>
        )}
        </>
        )}

        {view === "dashboard" && (
        <section className="metrics-grid" id="overview">
          <Metric
  title="Active decisions"
  value={String(riskItems.length + operatingChanges.length)}
  subtitle={`${watchlistItems.length} on watchlist${publishedOpportunities.length > 0 ? ` · ${publishedOpportunities.length} opportunit${publishedOpportunities.length === 1 ? "y" : "ies"}` : ""}`}
            explanation={explainDashboardMetric("executive_issues", {
  riskCount: riskItems.length,
  operatingChangeCount: operatingChanges.length,
  watchlistCount: watchlistItems.length,
  opportunityCount: publishedOpportunities.length,
})}
          />

          <Metric
  title={execMode ? "Downside Exposure" : "Risk Exposure"}
  value={execMode ? formatExecutiveEstimate(execRiskSectionTotal) : `${formatMoney(totalRiskLow)}–${formatMoney(totalRiskHigh)}`}
  subtitle={
    execMode
      ? `${evidenceBackedRiskItems.length > 0
          ? "Official metric-backed downside"
          : articleClaimRiskItems.length > 0
            ? "Article-claimed · validation required"
            : "Company-calibrated estimate"}${execChangeSectionTotal > 0 ? ` · Favorable relief ${formatExecutiveEstimate(execChangeSectionTotal)}` : ""}`
      : riskExposureSubtitle()
  }
  explanation={explainDashboardMetric("risk_exposure", {
    downside: execRiskSectionTotal,
    downsideCount: riskItems.length,
    favorable: execChangeSectionTotal,
    favorableCount: operatingChanges.length,
    watchCount: watchlistItems.length,
    metricBackedCount: evidenceBackedRiskItems.length,
    articleBackedCount: articleClaimRiskItems.length,
  })}
/>

          {/* Candidate Upside hidden entirely when there is nothing to show
              (no approved upside and no pending/quarantined candidates). */}
          {(publishedOpportunities.length > 0 || candidateSummary.pendingReview > 0 || candidateSummary.quarantined > 0) && (
          <Metric
            title="Candidate Upside"
            value={
              execMode
                ? publishedOpportunities.length === 0
                  ? "—"
                  : formatExecutiveEstimate((totalOpportunityLow + totalOpportunityHigh) / 2)
                : `${formatMoney(totalOpportunityLow)}–${formatMoney(totalOpportunityHigh)}`
            }
            subtitle={
              execMode && publishedOpportunities.length === 0
                ? "Needs validation · no approved upside yet"
                : candidateSummary.pendingReview > 0 || candidateSummary.quarantined > 0
                ? candidateSummaryLine
                : "Needs CRM/customer validation"
            }
            explanation={explainDashboardMetric("opportunity_upside", {
              low: totalOpportunityLow,
              high: totalOpportunityHigh,
              count: publishedOpportunities.length,
            })}
          />
          )}

          

          <Metric
  title="Evidence Sources"
  value={officialMetricObservations > 0 ? `${pluralize(officialSourceCount, "official source")}` : String(uniqueEvidenceSources)}
  subtitle={officialMetricObservations > 0
    ? `${pluralize(officialMetricObservations, "metric observation")} · quality High (official government metrics)`
    : `${allEvidenceItems.length} items · quality ${avgEvidenceQuality >= 70 ? "High" : avgEvidenceQuality >= 50 ? "Medium" : "Low"} (avg ${avgEvidenceQuality}/100)`}
  explanation={explainDashboardMetric("supporting_signals", {
    relevant: signalStats.relevantEvents,
    events: signalStats.rawEvents,
    assessed: signalStats.assessedEvents,
  })}
/>

          <Metric
            title="Open Actions"
            value={String(openActions)}
            subtitle={actions.length > publishedActions.length
              ? `${openActions} active action${openActions === 1 ? "" : "s"} · blocked candidates excluded`
              : `${openActions} active action${openActions === 1 ? "" : "s"}`}
            explanation={explainDashboardMetric("open_actions", {
              open: openActions,
              total: publishedActions.length,
            })}
          />

          <Metric
            title="Published issue coverage"
            value={`${publishedWithInputs}/${publishedTotal}`}
            subtitle={`${publishedWithInputs === publishedTotal ? "All published issues have complete formula inputs" : `${publishedWithInputs} of ${publishedTotal} published issues have complete formula inputs`} · ${calibrationSourceLabel}${watchlistItems.length > 0 ? ` · ${watchlistItems.length} watchlist item${watchlistItems.length === 1 ? "" : "s"} blocked by missing data` : ""}`}
            explanation={{
              title: "Published issue input coverage (three distinct concepts)",
              displayedValue: `${publishedWithInputs}/${publishedTotal} published issues have a complete formula + company inputs`,
              formula: "Published issue input coverage = published issues with a complete formula and company inputs. It is NOT the local calibration workbench score.",
              inputs: [
                { label: "Published issue input coverage", value: `${publishedWithInputs}/${publishedTotal} (DB-backed)` },
                { label: "Calibration source", value: calibrationSourceLabel },
                { label: "Local workbench coverage", value: localWorkbenchLoaded ? `${calibrationCoverage}% · ${calInputsCalibrated}/${calInputsRequired} inputs` : "not loaded in this browser" },
                { label: "Watchlist blocked by missing data", value: String(watchlistItems.length) },
              ],
              source: "Published issue inputs come from the published issues' stored formula inputs (DB). Local workbench coverage is a browser-specific import state in the Calibration Center.",
              note: "Published issue input coverage reflects the issues you see; it does not depend on the local browser workbench. Local workbench coverage only rises when you import data in this browser.",
            }}
          />
        </section>
        )}

        {/* 2. Leadership Memo — compact structured preview */}
        {view === "dashboard" && (
        <div id="brief"><CompactMemoSection
          brief={brief}
          company={company}
          riskItems={riskItems}
          operatingChanges={operatingChanges}
          watchlistItems={watchlistItems}
          opportunities={publishedOpportunities}
          openActions={openActions}
          totalRiskLow={totalRiskLow}
          totalRiskHigh={totalRiskHigh}
          totalOpportunityLow={totalOpportunityLow}
          totalOpportunityHigh={totalOpportunityHigh}
          candidateQueueCount={candidateQueueItems.length}
          quarantineCount={candidateQueueItems.filter(i => i.gateResult.decision === "quarantine").length}
          reviewCount={candidateQueueItems.filter(i => i.gateResult.decision === "candidate_review").length}
          execMode={execMode}
          execTotalRisk={execTotalRisk}
          actions={publishedActions}
          execByIssueId={execByIssueId}
        /></div>
        )}

        {/* 3. Company Exposure Graph — directly after the brief */}
        {view === "dashboard" && (
          <section className="card" id="exposure">
            <div className="card-header">
              <div>
                <p className="eyebrow">Exposure graph</p>
                <h2 className="section-title">Company Exposure Graph</h2>
                <p className="dashboard-subtitle" style={{ marginTop: 4, marginBottom: 0 }}>
                  External signal → company exposure → calculation → business impact → action.
                </p>
              </div>
            </div>
            <CompanyExposureGraph
              model={exposureGraphModel}
              auditContent={
                impactPaths.length > 0 || edges.length > 0 ? (
                  <GroupedExposurePaths paths={impactPaths} edges={edges} />
                ) : undefined
              }
            />
          </section>
        )}

        {/* 4. Executive Actions + ROI */}
        {view === "dashboard" && (
          <div id="actions"><ActionRoiPanel actions={actionRoiItems} onStatusChange={updateActionStatus} execMode={execMode} /></div>
        )}

        {/* 4b. Driver Priority Map — compact, below the graph */}
        {view === "dashboard" && driverPriorityReport.drivers.length > 0 && (
          <DriverPriorityMap
            /* Watch count reflects the global watchlist, not just published-issue drivers,
               so the map never shows "0 Watch" while the watchlist has items. */
            drivers={driverPriorityReport.drivers}
            topDriver={driverPriorityReport.topDriver}
            watchCount={watchlistItems.length}
            publishedIssueCount={riskItems.length + operatingChanges.length}
            execMode={execMode}
            execImpactByTitle={execImpactByTitle}
          />
        )}

        {/* Dashboard: compact Issue Register preview — full register lives on /risks */}
        {view === "dashboard" && (
          <section className="card" id="register">
            <div className="card-header">
              <div>
                <h2 className="section-title">Issue Register</h2>
              </div>
              <Link to="/risks"><button className="secondary-button">Open Risks →</button></Link>
            </div>
            <p className="dashboard-subtitle" style={{ marginTop: 0 }}>
              {pluralize(riskItems.length + operatingChanges.length, "published item")} · Downside {formatExecutiveEstimate(execRiskSectionTotal)} · Favorable relief {formatExecutiveEstimate(execChangeSectionTotal)} · {pluralize(riskItems.length, "operating risk")} · {pluralize(operatingChanges.length, "operating change")}
            </p>
            <ul className="gs-register-preview">
              {[...riskItems, ...operatingChanges].slice(0, 5).map((risk) => {
                // Issue type from the canonical section/direction — never title heuristics.
                const isChange = risk.display_section === "operating_changes" || (risk as any).issue_category === "operating_change";
                const favorable = (risk as any).issue_direction === "favorable" || (risk as any).issue_direction === "favorable_with_residual_exposure";
                const typeLabel = isChange ? (favorable ? "Favorable Change" : "Operating Change") : "Risk";
                return (
                  <li key={risk.id} className="gs-register-preview-row">
                    <span className="gs-register-preview-title">{risk.risk_title}</span>
                    <span className="badge">{typeLabel}</span>
                    <span className="gs-register-preview-val">{execByIssueId.get(risk.id)?.display ?? "Needs validation"}</span>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {/* 4b. Candidate Review Queue — items blocked by quality gate (Risks page) */}
        {view === "risks" && <CandidateReviewQueue items={candidateQueueItems} />}

        {/* 4. Risk Register (full — Risks page) */}
        {view === "risks" && (
        <section className="card">
          <div className="card-header">
            <div>
              <h2 className="section-title">Risk Register</h2>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span className="badge">{execMode ? `${pluralize(riskItems.length, "risk")} · ${formatExecutiveEstimate(execRiskSectionTotal)}` : `${riskItems.length} risks · ${formatMoney(totalRiskLow)}–${formatMoney(totalRiskHigh)}`}</span>
              {riskItems.length > 0 && (
                <button className="text-button" onClick={() => toggleAllRiskSection(riskItems.map(r => r.id))}>
                  {riskItems.every(r => expandedRiskIds.has(r.id)) ? "Collapse all" : "Expand all"}
                </button>
              )}
            </div>
          </div>
          {riskItems.length === 0 ? (
            <p className="muted">No downside risks generated yet.</p>
          ) : (
            riskItems.map((risk, index) => {
              const linkedRawAction = publishedActions.find((pa) => pa.risk_id === risk.id);
              const ownerFromAction = linkedRawAction
                ? (actionRoiItems.find((item) => item.id === linkedRawAction.id)?.owner ?? null)
                : null;
              return (
                <RiskCard
                  key={risk.id}
                  risk={risk}
                  displayRank={index + 1}
                  expanded={expandedRiskIds.has(risk.id)}
                  onToggle={() => toggleRiskId(risk.id)}
                  movement={getMovement(risk.risk_title, riskSnapshots, "risk_title", (risk as any).created_at)}
                  matchedConnections={matchedConnectionsByItemId[risk.id] || []}
                  calibration={effectiveCalibration}
                  calibratedKeys={calibratedKeys}
                  calibratedOverlay={
                    isFreightIssue(risk)
                      ? freightCalibrated
                      : isTariffIssue(risk) || risk.issue_category?.includes("commodity")
                      ? steelCalibrated
                      : null
                  }
                  provenance={buildIssueProvenance(
                    {
                      title: risk.risk_title,
                      category: risk.issue_category,
                      hasCalibratedOverlay: isFreightIssue(risk)
                        ? !!freightCalibrated
                        : isTariffIssue(risk) || risk.issue_category?.includes("commodity")
                        ? !!steelCalibrated
                        : false,
                    },
                    verifiedShocks
                  )}
                  execMode={execMode}
                  execEstimate={execByIssueId.get(risk.id) ?? null}
                  gateResult={_gateResults.get(risk.id)}
                  ownerFromAction={ownerFromAction}
                />
              );
            })
          )}
        </section>
        )}

        {/* 5. Opportunity Pipeline (dashboard — one coherent section).
            Hidden when there is nothing to show (0 approved + 0 pending) to keep the
            demo/customer dashboard focused. */}
        {view === "dashboard" && (publishedOpportunities.length > 0 || candidateQueueItems.length > 0) && (
        <section className="card" id="opportunities">
          <div className="card-header">
            <div>
              <p className="eyebrow">Commercial upside</p>
              <h2 className="section-title">Opportunity Pipeline</h2>
              <p className="dashboard-subtitle" style={{ marginTop: 4, marginBottom: 0 }}>
                {candidateSummaryLine}
              </p>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span className="badge">{candidateSummary.approved} approved</span>
              {publishedOpportunities.length > 0 && (
                <button className="text-button" onClick={() => toggleAllOpportunitySection(publishedOpportunities.map(o => o.id))}>
                  {publishedOpportunities.every(o => expandedOpportunityIds.has(o.id)) ? "Collapse all" : "Expand all"}
                </button>
              )}
            </div>
          </div>
          {publishedOpportunities.length === 0 ? (
            <div>
              <p className="muted">No approved opportunities this cycle. Candidates below remain in review until company-specific capture evidence is provided.</p>
              {candidateQueueItems.length > 0 && (
                <ul className="gs-register-preview" style={{ marginTop: 8 }}>
                  {candidateQueueItems.map((c) => (
                    <li key={c.id} className="gs-register-preview-row">
                      <span className="gs-register-preview-title">{c.title}</span>
                      <span className="badge">{c.gateResult.decision === "quarantine" ? "Quarantined" : "Pending review"}</span>
                      <span className="gs-register-preview-val" style={{ color: "var(--text-muted)", whiteSpace: "normal" }}>
                        {c.gateResult.requiredToPromote?.[0] ?? "Needs company-specific capture evidence."}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            publishedOpportunities.map((opportunity) => (
              <OpportunityCard
                key={opportunity.id}
                opportunity={opportunity}
                expanded={expandedOpportunityIds.has(opportunity.id)}
                onToggle={() => toggleOpportunityId(opportunity.id)}
                movement={getMovement(opportunity.title, opportunitySnapshots, "opportunity_title", (opportunity as any).created_at)}
                matchedConnections={matchedConnectionsByItemId[opportunity.id] || []}
              />
            ))
          )}
        </section>
        )}

        {/* 6. Operating Changes (Risks page) */}
        {view === "risks" && operatingChanges.length > 0 && (
          <section className="card">
            <div className="card-header">
              <div>
                <h2 className="section-title">Operating Changes</h2>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span className="badge">{execMode ? `${pluralize(operatingChanges.length, "item")} · ${formatExecutiveEstimate(execChangeSectionTotal)}` : `${operatingChanges.length} items`}</span>
                <button className="text-button" onClick={() => toggleAllRiskSection(operatingChanges.map(r => r.id))}>
                  {operatingChanges.every(r => expandedRiskIds.has(r.id)) ? "Collapse all" : "Expand all"}
                </button>
              </div>
            </div>
            {operatingChanges.map((item) => (
              <OperatingChangeCard
                key={item.id}
                risk={item}
                expanded={expandedRiskIds.has(item.id)}
                onToggle={() => toggleRiskId(item.id)}
                matchedConnections={matchedConnectionsByItemId[item.id] || []}
                execMode={execMode}
                execEstimate={execByIssueId.get(item.id) ?? null}
              />
            ))}
          </section>
        )}

        {/* 7. Watchlist (Risks page) */}
        {view === "risks" && watchlistItems.length > 0 && (
          <section className="card">
            <div className="card-header">
              <div>
                <h2 className="section-title">Watchlist</h2>
              </div>
              <span className="badge">{watchlistItems.length} items</span>
            </div>
            {watchlistItems.map((item) => (
              <WatchlistCard
                key={item.id}
                risk={item}
                expanded={expandedRiskIds.has(item.id)}
                onToggle={() => toggleRiskId(item.id)}
                matchedConnections={matchedConnectionsByItemId[item.id] || []}
              />
            ))}
          </section>
        )}

        {/* 6–9. Compact calibration / source / outcome summaries (dashboard) */}
        {view === "dashboard" && (
        <>
          <div id="support">
            {/* Calibration Summary — compact status; full workbench lives at /calibration */}
            <CalibrationSummaryCard controller={calibrationController} publishedCount={riskItems.length + operatingChanges.length} watchlistBlocked={watchlistItems.length} dbCoverage={persistedCoverage} />

            {/* Source Coverage — free/public external data powering verified shocks */}
            <SourceCoverageCard companyId={company?.id ?? null} />
          </div>

          <div id="outcomes">
            {/* Forecast Accuracy / Outcome Tracking — only once at least one forecast
                has a resolved actual outcome; otherwise it's empty noise on the demo. */}
            {forecastRows.some((r) => r.actualImpact !== null) && (
              <ForecastAccuracyPanel rows={forecastRows} execMode={execMode} />
            )}

            {/* Company Model — compact with expandable sections */}
            <CompanyModelSection company={company} entities={entities} getEntities={getEntities} />
          </div>

          {/* Automatic intelligence updates — schedule status + run history.
              Operator/admin only: the schedule + run-history surface is a dev/ops
              console, hidden entirely from the buyer/demo dashboard. */}
          {canViewAdminControls() && (
            <SchedulerStatusCard
              companyId={company?.id ?? null}
              onRunNow={handleRunIntelligenceUpdate}
              running={busy === "pipeline" || pipelineState.running}
              refreshKey={schedulerRefresh}
              canWrite={canViewAdminControls()}
              currentRegister={{
                published: riskItems.length + operatingChanges.length,
                pending: candidateQueueItems.filter(i => i.gateResult.decision === "candidate_review").length,
                quarantined: candidateQueueItems.filter(i => i.gateResult.decision === "quarantine").length,
              }}
            />
          )}
        </>
        )}

        {/* Raw events — advanced/developer view (hidden until Advanced controls are expanded) */}
        {view === "dashboard" && showAdvancedPipeline && (
        <section className="card">
          <button className="secondary-button" onClick={() => setShowRawEvents(!showRawEvents)}>
            {showRawEvents ? "Hide Raw Events" : "Show Raw Events"}
          </button>
          {showRawEvents && (
            <div className="raw-events-list">
              {events.map((event) => (
                <div key={event.id} className="raw-event">
                  <p className="action-title">{event.title}</p>
                  <p className="muted">
                    {event.source_name || "Unknown"} · {event.source_api || "source"} ·{" "}
                    {event.freshness_bucket || "freshness unknown"} · Age {event.event_age_days ?? "?"} days · Quality {event.source_quality ?? 50}
                  </p>
                  <p className="small-text">{event.query_text}</p>
                  {event.source_url && (
                    <a href={event.source_url} target="_blank" rel="noreferrer" className="link">Open source</a>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
        )}

        {/* Risks page: quality-gate summary footer */}
        {view === "risks" && (
          <section className="card">
            <div className="card-header">
              <div>
                <h2 className="section-title">{canViewAdminControls() ? "Quality Gate" : "Publishing criteria"}</h2>
              </div>
              <span className="badge">{candidateQueueItems.length} in review</span>
            </div>
            <p className="dashboard-subtitle" style={{ marginTop: 0 }}>
              {riskItems.length + operatingChanges.length} published · {candidateQueueItems.filter(i => i.gateResult.decision === "candidate_review").length} pending review · {candidateQueueItems.filter(i => i.gateResult.decision === "quarantine").length} quarantined. Blocked candidates are excluded from executive estimates, actions, and forecasts until promoted.
            </p>
          </section>
        )}

        {/* Risks page: full intelligence run history (manual + scheduled).
            Operator/admin-only — it exposes historical/debug run rows (including old
            scenario-modeled runs) that should not appear in the normal customer/demo
            view. Gated behind the Advanced / admin controls toggle. */}
        {view === "risks" && showAdvancedPipeline && canViewAdminControls() && (
          <section className="card">
            <div className="card-header">
              <div>
                <h2 className="section-title">Intelligence Run History</h2>
                <p className="dashboard-subtitle" style={{ marginTop: 4, marginBottom: 0 }}>
                  Operator view · every manual and scheduled intelligence update, with counts and outcomes.
                </p>
              </div>
            </div>
            <RunHistoryPanel companyId={company?.id ?? null} limit={25} refreshKey={schedulerRefresh} />
          </section>
        )}
        </div>
        </div>
      </div>
    </main>
  );
}

// Executive memo lines — derived from the company's ACTUAL published issues and
// actions (not a canonical freight/tariff template), so the brief always matches
// the published risk register and its owner/action. Point estimates, no ranges
// when an executive estimate exists.
function buildExecMemoLines(opts: {
  execTotalRisk: number;
  riskItems: Risk[];
  operatingChanges: Risk[];
  watchlistItems: Risk[];
  actions: ActionItem[];
  execByIssueId: Map<string, ExecutiveEstimate>;
  companyName: string;
}): { prefix: string; className: string; text: string }[] {
  const { riskItems, operatingChanges, watchlistItems, actions, execByIssueId, companyName } = opts;
  if (riskItems.length === 0 && operatingChanges.length === 0) return [];

  const co = companyName || "your company";
  const issueValue = (r: Risk): string => {
    const est = execByIssueId.get(r.id);
    if (est && est.value !== null) return est.display.replace("~", "");
    const lo = Number(r.impact_low || 0);
    const hi = Number(r.impact_high || 0);
    return lo || hi
      ? `${formatExecutiveEstimate(lo).replace("~", "")}–${formatExecutiveEstimate(hi).replace("~", "")}`
      : "an amount pending validation";
  };
  const actionFor = (r: Risk) => actions.find((a) => a.risk_id === r.id) ?? null;

  const activeCount = riskItems.length + operatingChanges.length;
  const lines: { prefix: string; className: string; text: string }[] = [];

  const allIssues = [...riskItems, ...operatingChanges];
  // Direction-split totals — downside risk and favorable relief are reported separately,
  // never merged into one "value at stake" figure. Same section basis as the dashboard
  // execRiskSectionTotal / execChangeSectionTotal.
  const downsideTotal = sumExecutiveEstimates(
    riskItems.map((r) => execByIssueId.get(r.id)).filter((e): e is ExecutiveEstimate => !!e)
  );
  const favorableTotal = sumExecutiveEstimates(
    operatingChanges.map((r) => execByIssueId.get(r.id)).filter((e): e is ExecutiveEstimate => !!e)
  );
  const downsideStr = formatExecutiveEstimate(downsideTotal).replace("~", "");
  const favorableStr = formatExecutiveEstimate(favorableTotal).replace("~", "");
  const hasOfficialMetrics = allIssues.some(r =>
    ["official_structured_metric", "manual_structured_metric"].includes((r as any).numeric_basis_type ?? "")
  );
  const hasArticleClaims = allIssues.some(r => (r as any).numeric_basis_type === "article_numeric_claim");
  const sourcePhrase = hasOfficialMetrics
    ? "official BLS/EIA numeric metrics"
    : hasArticleClaims
      ? "article-extracted numeric claims (validation required)"
      : "company calibration estimates";
  const reliefClause = favorableTotal > 0
    ? ` and approximately ${favorableStr} of favorable fuel-surcharge relief`
    : "";
  lines.push({
    prefix: "SUMMARY",
    className: "memo-act",
    text: `GroundSense mapped ${sourcePhrase} to ${co} calibration data, identifying approximately ${downsideStr} of downside exposure${reliefClause} across ${activeCount} active operating issue${activeCount === 1 ? "" : "s"}.`,
  });

  // ACT NOW — top published risk (Act-triaged first, then largest impact).
  const topRisk = [...riskItems].sort((a, b) => {
    const aw = getTriageBadge(a).label === "Act" ? 1 : 0;
    const bw = getTriageBadge(b).label === "Act" ? 1 : 0;
    if (aw !== bw) return bw - aw;
    return Number(b.impact_high || 0) - Number(a.impact_high || 0);
  })[0] ?? null;
  if (topRisk) {
    const topBtype = (topRisk as any).numeric_basis_type ?? "no_numeric_basis";
    const evidence = ["official_structured_metric", "manual_structured_metric"].includes(topBtype)
      ? "Official metric-backed"
      : topBtype === "article_numeric_claim"
        ? "Secondary article/context signal"
        : "Scenario-modeled";
    const act = actionFor(topRisk);
    lines.push({
      prefix: `1. ACT NOW — ${topRisk.risk_title}`,
      className: "memo-act",
      text: `${evidence} exposure of approximately ${issueValue(topRisk)}.${act ? ` Owner action: ${act.owner || "assign an owner"} to ${(act.title || "validate the exposure").replace(/\.$/, "")}.` : " Assign an owner and a validation action."}`,
    });
  }

  // VALIDATE — top operating change.
  const topChange = operatingChanges[0] ?? null;
  if (topChange) {
    const act = actionFor(topChange);
    lines.push({
      prefix: `2. VALIDATE — ${topChange.risk_title}`,
      className: "memo-validate",
      text: `Operating change with approximately ${issueValue(topChange)} pending validation.${act ? ` Owner: ${act.owner || "unassigned"}.` : ""}`,
    });
  }

  // WATCH — monitored, not dollarized.
  if (watchlistItems.length > 0) {
    lines.push({
      prefix: "3. WATCH",
      className: "memo-validate",
      text: `${watchlistItems.length} item${watchlistItems.length === 1 ? "" : "s"} on watch — monitored without a dollar estimate until evidence supports sizing.`,
    });
  }

  // Only mention scenario-modeled issues if any PUBLISHED issue actually lacks a
  // numeric (metric or article-claim) basis. With an all-metric-backed register
  // the scenario caveat is stale and erodes trust, so it is omitted.
  const METRIC_OR_CLAIM = ["official_structured_metric", "manual_structured_metric", "company_structured_metric", "article_numeric_claim"];
  const hasScenarioPublished = allIssues.some(r => !METRIC_OR_CLAIM.includes((r as any).numeric_basis_type ?? "no_numeric_basis"));
  lines.push({
    prefix: "MODEL BASIS",
    className: "memo-caveat",
    text: hasScenarioPublished
      ? "Estimates derive from verified external metrics and company calibration. Scenario-modeled issues are labeled and require company-specific validation before realization."
      : "Estimates derive from official external metrics (BLS/EIA) mapped to company calibration data.",
  });
  return lines;
}

function CompactMemoSection({
  brief,
  company,
  riskItems,
  operatingChanges,
  watchlistItems,
  opportunities,
  openActions,
  totalRiskLow,
  totalRiskHigh,
  totalOpportunityLow,
  totalOpportunityHigh,
  candidateQueueCount = 0,
  quarantineCount = 0,
  reviewCount = 0,
  execMode = false,
  execTotalRisk = 0,
  actions = [],
  execByIssueId = new Map<string, ExecutiveEstimate>(),
}: {
  brief: Brief | null;
  company: Company | null;
  riskItems: Risk[];
  operatingChanges: Risk[];
  watchlistItems: Risk[];
  opportunities: Opportunity[];
  openActions: number;
  totalRiskLow: number;
  totalRiskHigh: number;
  totalOpportunityLow: number;
  totalOpportunityHigh: number;
  candidateQueueCount?: number;
  quarantineCount?: number;
  reviewCount?: number;
  execMode?: boolean;
  execTotalRisk?: number;
  actions?: ActionItem[];
  execByIssueId?: Map<string, ExecutiveEstimate>;
}) {
  const [briefExpanded, setBriefExpanded] = useState(false);

  // Canonical counts — the brief MUST agree with the dashboard & risk page.
  // Published = active risk + operating-change rows (gate_status published).
  const publishedCount = riskItems.length + operatingChanges.length;
  const watchCount = watchlistItems.length;
  const generatedShown = publishedCount + watchCount + candidateQueueCount;

  // Brief staleness: any issue updated after the brief was generated means the brief
  // may no longer reflect the register. Buyers see the warning; only operators can regenerate.
  const briefStale = (() => {
    if (!brief?.created_at) return false;
    const briefTime = new Date(brief.created_at).getTime();
    return [...riskItems, ...operatingChanges, ...watchlistItems].some((r) => {
      const u = (r as any).last_updated || (r as any).updated_at || (r as any).created_at;
      return u && new Date(u).getTime() > briefTime + 60_000;
    });
  })();

  // Executive memo lines — derived from this company's actual published rows.
  const execMemoLines = buildExecMemoLines({
    execTotalRisk,
    riskItems,
    operatingChanges,
    watchlistItems,
    actions,
    execByIssueId,
    companyName: company?.name ?? "",
  });

  const memoStructure = execMode && execMemoLines.length > 0 ? execMemoLines : getMemoLine({
    actNowRisks: riskItems.filter(r => getTriageBadge(r).label === "Act"),
    validateRisks: riskItems.filter(r => getTriageBadge(r).label === "Validate"),
    topOpp: opportunities[0] || null,
    watchlistItems,
    topChange: operatingChanges[0] || null,
    openActions,
    scenarioCount: riskItems.filter(r => getIssueModelStatus(r.methodology).status === "scenario_fallback").length,
    needsCalibCount: riskItems.filter(r => getIssueModelStatus(r.methodology).status === "needs_calibration").length,
    totalRiskLow,
    totalRiskHigh,
    totalOppLow: totalOpportunityLow,
    totalOppHigh: totalOpportunityHigh,
  });

  const summaryLines = memoStructure.map(m => ({ ...m }));

  return (
    <section className="card memo-section">
      <div className="card-header">
        <div>
          <h2 className="section-title">{brief ? (briefStale ? "Last generated brief" : (brief.title || "Intelligence Summary")) : "Intelligence Summary"}</h2>
          {brief && briefStale && <p className="dashboard-subtitle" style={{ margin: "2px 0 0" }}>Not the current live summary — see warning below.</p>}
        </div>
        {brief ? (
          <span className="badge">Last generated: {new Date(brief.created_at).toLocaleString()}</span>
        ) : (
          <span className="badge">Executive brief preview</span>
        )}
      </div>

      {brief && briefStale && (
        <p className="memo-stale-note">
          ⚠ Brief may be stale — issues changed after it was generated.{canViewAdminControls() ? " Regenerate it from the toolbar." : " Regenerate in operator mode."}
        </p>
      )}

      {!briefExpanded ? (
        <div className="memo-compact memo-coo-format">
          {summaryLines.map((line, i) => (
            <div key={i} className={`memo-summary-line ${line.className}`}>
              <span className="memo-line-prefix">{line.prefix}</span>
              <span className="memo-line-body">{line.text}</span>
            </div>
          ))}
          {candidateQueueCount > 0 && (
            <div className="memo-summary-line memo-gate-line">
              <span className="memo-line-prefix">QUALITY GATE</span>
              <span className="memo-line-body">
                GroundSense reviewed {generatedShown} candidate{generatedShown !== 1 ? "s" : ""}.{" "}
                {publishedCount} published, {watchCount} watch
                {reviewCount > 0 ? `, ${reviewCount} sent to review` : ""}
                {quarantineCount > 0 ? `, ${quarantineCount} quarantined` : ""}.{" "}
                Blocked candidates are excluded from actions, forecasts, metrics, and executive brief until promoted.
              </span>
            </div>
          )}
          {(brief || summaryLines.length > 0) && (
            <button className="text-button memo-expand-btn" onClick={() => setBriefExpanded(true)}>
              Open full brief →
            </button>
          )}
        </div>
      ) : (
        <div>
          <button className="text-button memo-expand-btn" onClick={() => setBriefExpanded(false)}>
            ▲ Collapse brief
          </button>
          <div className="memo-expanded-structured">
            <p className="memo-expanded-header">GroundSense Operating Brief — {company?.name || "Company"}</p>
            {summaryLines.map((line, i) => (
              <div key={i} className={`memo-expanded-line ${line.className}`}>
                <span className="memo-expanded-prefix">{line.prefix}</span>
                <p className="memo-expanded-body">{line.text}</p>
              </div>
            ))}
            <div className="memo-expanded-line memo-caveat">
              <span className="memo-expanded-prefix">QUALITY GATE</span>
              <p className="memo-expanded-body">
                GroundSense reviewed {generatedShown} candidate{generatedShown !== 1 ? "s" : ""}.{" "}
                {publishedCount} published ({watchCount} watch)
                {candidateQueueCount > 0 ? (
                  <>
                    {", "}
                    {reviewCount > 0 ? `${reviewCount} sent to review` : ""}
                    {reviewCount > 0 && quarantineCount > 0 ? ", " : ""}
                    {quarantineCount > 0 ? `${quarantineCount} quarantined` : ""}
                    {" due to weak or misaligned evidence."}
                  </>
                ) : "."}
                {" "}Blocked candidates are excluded from actions, forecasts, metrics, and executive brief until promoted. See Candidate Review Queue for details.
              </p>
            </div>
            <div className="memo-expanded-line memo-caveat">
              <span className="memo-expanded-prefix">LEARNING LOOP</span>
              <p className="memo-expanded-body">Forecast records are open for quality-approved issues only. Realized outcomes will calibrate future company-specific exposure models.</p>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function CompanyModelSection({
  company,
  entities,
  getEntities,
}: {
  company: Company | null;
  entities: Entity[];
  getEntities: (type: string) => string;
}) {
  return (
    <section className="card company-model-compact">
      <div className="company-compact-header">
        <div className="company-compact-profile">
          <h2 className="company-compact-name">{company?.name || "No company"}</h2>
          <div className="company-compact-meta">
            <span className="company-compact-industry">{company?.industry || "Industry not set"}</span>
            {company?.revenue_range && (
              <span className="company-compact-revenue">Revenue: {company.revenue_range}</span>
            )}
          </div>
        </div>
      </div>
      <div className="company-compact-sections">
        {[
          { label: "Suppliers", type: "supplier" },
          { label: "Competitors", type: "competitor" },
          { label: "Customer Segments", type: "customer_segment" },
          { label: "Commodities", type: "commodity" },
        ].map(({ label, type }) => {
          const value = getEntities(type);
          if (!value || value === "None") return null;
          return (
            <details key={type} className="company-detail-group">
              <summary className="company-detail-summary">
                <span className="company-detail-label">{label}</span>
                <span className="company-detail-count">
                  {entities.filter(e => e.entity_type === type).length}
                </span>
              </summary>
              <p className="company-detail-value">{value}</p>
            </details>
          );
        })}
      </div>
    </section>
  );
}

const GROUP_LABELS: Record<string, { label: string; description: string }> = {
  cost: { label: "Cost exposure", description: "Input cost, freight, commodity, or tariff pressures" },
  supplier: { label: "Supplier / input exposure", description: "Supply chain disruption or vendor risk" },
  customer: { label: "Customer revenue exposure", description: "Demand, segment, or customer revenue risk" },
  competitor: { label: "Competitor / share-shift", description: "Competitive pressure or market share loss" },
  service: { label: "Service-level exposure", description: "Fill rate, fulfillment, or backorder risk" },
  opportunity: { label: "Opportunity paths", description: "Revenue upside or demand capture" },
  other: { label: "Other exposure", description: "Additional operating path exposure" },
};

function GroupedExposurePaths({
  paths,
  edges,
  limit,
}: {
  paths: ImpactPath[];
  edges: ExposureEdge[];
  limit?: number;
}) {
  const [showAll, setShowAll] = useState(false);
  // Build unified path list from impact paths first, fall back to edges
  type UnifiedPath = {
    id: string;
    group: "cost" | "supplier" | "customer" | "competitor" | "service" | "opportunity" | "other";
    trigger: string;
    affected: string;
    category: string;
    pathChain: string;
    direction: string;
    exposureHigh: number | null;
    actionHint: string | null;
    calibration: string | null;
    source: "impact_path" | "edge";
  };

  const unified: UnifiedPath[] = [];

  paths.slice(0, 20).forEach((p) => {
    const group = classifyPathGroup(p.impact_category, p.trigger_name, p.trigger_type || "");
    const nodes = Array.isArray(p.path_nodes) && p.path_nodes.length >= 2 ? p.path_nodes : null;
    const pathChain = nodes ? nodes.join(" → ") : `${p.trigger_name} → ${cleanImpactCategoryLabel(p.impact_category, p.trigger_name)} → ${p.affected_name}`;
    unified.push({
      id: p.id,
      group,
      trigger: p.trigger_name,
      affected: p.affected_name,
      category: cleanImpactCategoryLabel(p.impact_category, p.trigger_name),
      pathChain,
      direction: p.impact_weight != null ? (p.impact_weight < 0 ? "negative" : "positive") : "unknown",
      exposureHigh: p.exposure_high,
      actionHint: p.action_hint,
      calibration: p.calibration_status || null,
      source: "impact_path",
    });
  });

  // If no impact paths, show edges grouped
  if (unified.length === 0) {
    edges.slice(0, 16).forEach((e) => {
      const group = classifyPathGroup(e.relationship || "", e.from_name);
      unified.push({
        id: e.id,
        group,
        trigger: e.from_name,
        affected: e.to_name,
        category: cleanLabel(e.relationship || ""),
        pathChain: `${e.from_name} → ${cleanLabel(e.relationship || "")} → ${e.to_name}`,
        direction: "unknown",
        exposureHigh: null,
        actionHint: null,
        calibration: null,
        source: "edge",
      });
    });
  }

  if (unified.length === 0) {
    return <p className="muted">Build the exposure graph to see operating paths.</p>;
  }

  // Group
  const grouped: Record<string, UnifiedPath[]> = {};
  unified.forEach((p) => {
    if (!grouped[p.group]) grouped[p.group] = [];
    grouped[p.group].push(p);
  });

  const groupOrder = ["cost", "supplier", "customer", "competitor", "service", "opportunity", "other"] as const;
  const activeGroups = groupOrder.filter((g) => grouped[g] && grouped[g].length > 0);
  const visibleGroups = limit && !showAll ? activeGroups.slice(0, limit) : activeGroups;
  const hasMore = limit ? activeGroups.length > limit : false;

  return (
    <div className="grouped-exposure-paths">
      {visibleGroups.map((groupKey) => (
        <div key={groupKey} className="exposure-path-group">
          <div className="exposure-path-group-header">
            <span className="exposure-path-group-label">{GROUP_LABELS[groupKey].label}</span>
            <span className="exposure-path-group-count">{grouped[groupKey].length}</span>
          </div>
          <div className="exposure-path-cards">
            {grouped[groupKey].map((p) => (
              <div key={p.id} className={`exposure-path-card direction-${p.direction}`}>
                <div className="exposure-path-chain">{p.pathChain}</div>
                <div className="exposure-path-meta">
                  {p.exposureHigh != null && p.exposureHigh > 0 && (
                    <span className="exposure-path-amount">
                      {p.group === "competitor"
                        ? `${formatMoney(p.exposureHigh)} revenue base potentially influenced`
                        : `${formatMoney(p.exposureHigh)} exposure`}
                    </span>
                  )}
                  {p.calibration && (
                    <span className="exposure-path-calibration">{p.calibration.replace(/_/g, " ")}</span>
                  )}
                  {p.actionHint && (
                    <span className="exposure-path-action">{p.actionHint}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
      {hasMore && (
        <button
          className="text-button exposure-show-all-btn"
          onClick={() => setShowAll((v) => !v)}
        >
          {showAll ? "Show top 3 ▲" : `View all ${activeGroups.length} exposure groups ▼`}
        </button>
      )}
    </div>
  );
}

function QualityGateReport({ gateResult, confidence = 0, metricBacked = false }: { gateResult: IssueGateResult; confidence?: number; metricBacked?: boolean }) {
  const [open, setOpen] = useState(false);
  const score = gateResult.qualityScore;
  let qualityLabel = score >= 70 ? "High" : score >= 45 ? "Medium" : "Low";
  // A published, metric-backed issue with high model confidence must not read
  // "Quality: Low" — the evidence-alignment heuristic understates quality for
  // numeric-shock issues (their evidence is one official metric, not articles).
  // Floor to Medium and surface the reason rather than contradict the publish status.
  const floored = qualityLabel === "Low" && metricBacked && confidence > 70;
  if (floored) qualityLabel = "Medium";
  const labelColor = qualityLabel === "High" ? "var(--success)" : qualityLabel === "Medium" ? "var(--warning)" : "var(--danger)";
  // Note: deliberately NO numeric confidence here — the card already shows the
  // issue's confidence, and a second number on this line read as a contradicting
  // "model confidence" value.
  const why = floored
    ? "official metric-backed estimate; alignment heuristic understates numeric-shock issues"
    : gateResult.forecastEligible
    ? "official metric source + company exposure + actionability"
    : "evidence aligned and company-relevant; forecast pending validation";
  return (
    <div style={{ borderTop: "1px solid var(--border-default)", marginTop: 12, paddingTop: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{canViewAdminControls() ? "Quality Gate" : "Publishing criteria"}</span>
        <span style={{ fontSize: 11, background: "var(--success-bg)", color: "var(--success)", fontWeight: 650, padding: "1px 7px", borderRadius: 4 }}>Published ✓</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: labelColor }}>Quality: {qualityLabel}</span>
        <button className="text-button" style={{ fontSize: 12, marginLeft: "auto" }} onClick={() => setOpen(v => !v)}>
          {open ? "Hide quality details" : "Show quality details"}
        </button>
      </div>
      <p style={{ fontSize: 12, color: "var(--text-secondary)", margin: "5px 0 0" }}>
        <span style={{ fontWeight: 650, color: "var(--text-muted)" }}>Why: </span>{why}
      </p>
      {open && (
        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
          {[
            { label: "Evidence alignment", value: gateResult.evidenceAlignmentScore },
            { label: "Company relevance", value: gateResult.companyRelevanceScore },
            { label: "Overall quality (weighted)", value: gateResult.qualityScore },
          ].map(({ label, value }) => {
            const c = value >= 60 ? "var(--success)" : value >= 35 ? "var(--warning)" : "var(--danger)";
            return (
              <div key={label} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                <span style={{ color: "var(--text-muted)", width: 140, flexShrink: 0 }}>{label}</span>
                <div style={{ flex: 1, height: 6, background: "var(--border-default)", borderRadius: 3, maxWidth: 120 }}>
                  <div style={{ width: `${value}%`, height: "100%", background: c, borderRadius: 3 }} />
                </div>
                <span style={{ color: "var(--text-secondary)", fontWeight: 600 }}>{value}%</span>
              </div>
            );
          })}
          <div style={{ fontSize: 11, color: "var(--text-muted)", fontStyle: "italic", marginTop: 2 }}>
            Overall quality is a weighted score (evidence alignment, company relevance, source credibility, external-shock verification, and actionability) — not the average of alignment and relevance.
          </div>
          <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 4 }}>
            <span style={{ fontWeight: 650, color: "var(--text-muted)" }}>Forecast eligible: </span>
            {gateResult.forecastEligible ? "Yes" : "No — requires calibration or validation"}
          </div>
          <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
            <span style={{ fontWeight: 650, color: "var(--text-muted)" }}>Evidence reviewed: </span>
            {gateResult.evidenceCount} items · {gateResult.alignedCount} aligned · {gateResult.irrelevantCount} unrelated
          </div>
          {gateResult.requiredToPromote.length > 0 && (
            <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
              <span style={{ fontWeight: 650, color: "var(--text-muted)" }}>What would improve: </span>
              {gateResult.requiredToPromote[0]}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RiskCard({
  risk,
  displayRank,
  expanded,
  onToggle,
  movement,
  matchedConnections,
  calibration,
  calibratedKeys,
  calibratedOverlay,
  provenance,
  execMode,
  execEstimate,
  gateResult,
  ownerFromAction,
}: {
  risk: Risk;
  displayRank: number;
  expanded: boolean;
  onToggle: () => void;
  movement: string;
  matchedConnections: MatchedConnectionPath[];
  calibration?: CompanyCalibrationInput | null;
  calibratedKeys?: string[];
  calibratedOverlay?: CalibratedExposure | null;
  provenance?: IssueProvenance | null;
  execMode?: boolean;
  execEstimate?: ExecutiveEstimate | null;
  gateResult?: IssueGateResult | null;
  ownerFromAction?: string | null;
}) {
  const modelStatus = getIssueModelStatus(risk.methodology);
  const [showMethod, setShowMethod] = useState(false);
  const rawTakeaway = getRiskSummary(risk).slice(0, 280);
  const takeaway = execMode ? stripExecRanges(rawTakeaway) : rawTakeaway;
  const movementLabel = formatMovementLabel(movement);
  const rawDecisionTrigger = getTrustSafeDecisionTrigger(risk);
  const decisionTrigger = execMode ? stripExecRanges(rawDecisionTrigger) : rawDecisionTrigger;

  return (
    <div className="record-card">
      <div className="record-top">
        <div>
          <div className="record-badge-row">
            <span className="orange-badge">
              #{displayRank} {execMode
                ? ((risk.display_section === "operating_changes" || (risk as any).issue_category === "operating_change")
                    ? (((risk as any).issue_direction === "favorable" || (risk as any).issue_direction === "favorable_with_residual_exposure") ? "Favorable Change" : "Operating Change")
                    : "Operating Risk")
                : ((risk as any).numeric_basis_type === "no_numeric_basis" && modelStatus.status === "scenario_fallback" ? "Scenario Risk" : "Risk")}
            </span>
            {execMode ? (
              execEstimate && execEstimate.value !== null && (
                <span className="model-status model-status-evidence">{execEstimate.sourceLabel}</span>
              )
            ) : (
              <ModelStatusBadge methodology={risk.methodology} risk={risk} />
            )}
            {movementLabel && movementLabel !== "Unchanged" && (
              <span className="movement-chip">{movementLabel}</span>
            )}
          </div>
          <h3 className="record-title">{risk.risk_title}</h3>
        </div>
        <button className="text-button" onClick={onToggle}>
          {expanded ? "Hide analysis" : "View analysis →"}
        </button>
      </div>

      <div className="mini-grid mini-grid-3">
        <Mini
          label="Priority"
          value={`${risk.priority_score || 0}/100`}
          explanation={explainRiskPriority(risk)}
        />
        <Mini
          label={execMode ? "Confidence" : "Scenario confidence"}
          value={`${clampPercent(risk.probability)}%`}
          explanation={{
            title: "Scenario confidence",
            formula: "Stored risk_register.probability",
            inputs: [
              `Estimate: ${clampPercent(risk.probability)}%`,
              `Confidence: ${clampPercent(risk.confidence)}% (${formatConfidenceLabel(risk.confidence)})`,
              `Supporting events: ${risk.supporting_event_count || 0}`,
            ],
            source: "Generated by Generate Risks from relevant event assessments.",
            caveat:
              "This is a model confidence estimate, not a historically calibrated or actuarial probability.",
          }}
        />
        <Mini
          label={execMode ? "Business estimate" : modelStatus.exposureLabel}
          value={execMode && execEstimate ? execEstimate.display : getRiskExposureDisplay(risk)}
          explanation={explainRiskExposure(risk)}
        />
      </div>

      {execMode && execEstimate ? (
        <div className="exec-estimate">
          <div className="exec-estimate-head">
            <span className="exec-estimate-source">{execEstimate.sourceLabel}</span>
            <span className="exec-estimate-conf">Confidence: {execEstimate.confidence}</span>
          </div>
          {execEstimate.calculation && <p className="exec-estimate-calc"><strong>Calculation:</strong> {execEstimate.calculation}</p>}
          {inlineProvenanceText(risk) && <p className="exec-estimate-calc" style={{ color: "var(--text-muted)" }}><strong>Input provenance:</strong> {inlineProvenanceText(risk)}</p>}
          {execEstimate.sources.length > 0 && (
            <p className="exec-estimate-sources"><strong>Sources:</strong> {execEstimate.sources.map((s) => `${s.label} — ${s.value}`).join(" · ")}</p>
          )}
          {execEstimate.caveat && <p className="exec-estimate-caveat">{execEstimate.caveat}</p>}
          <div className="exec-methodology">
            <button type="button" className="exec-methodology-toggle" onClick={() => setShowMethod((v) => !v)}>
              {showMethod ? "▲ Hide methodology / sensitivity" : "▼ Show methodology / sensitivity"}
            </button>
            {showMethod && (
              <div className="exec-methodology-body">
                <p>Original pipeline scenario exposure: {getRiskExposureDisplay(risk)}</p>
                {calibratedOverlay && (
                  <p>Company-calibrated sensitivity: {calibratedOverlay.rangeLabel} ({calibratedOverlay.basisLabel} from {calibratedOverlay.rowCount} rows)</p>
                )}
                <p className="exec-methodology-note">Original ranges are retained for audit and are not used in executive-facing figures.</p>
              </div>
            )}
          </div>
        </div>
      ) : calibratedOverlay ? (
        <div className="calibrated-overlay">
          <div className="calibrated-overlay-head">
            <span className="calibrated-overlay-badge">Company-calibrated</span>
            <span className="calibrated-overlay-range">{calibratedOverlay.rangeLabel}</span>
            <span className="calibrated-overlay-basis">
              {calibratedOverlay.basisLabel} from {calibratedOverlay.rowCount} imported row{calibratedOverlay.rowCount === 1 ? "" : "s"}
            </span>
          </div>
          <div className="calibrated-overlay-inputs">
            {calibratedOverlay.inputs.map((inp) => (
              <span key={inp.label} className="calibrated-overlay-input">
                {inp.label}: <strong>{inp.value}</strong>
              </span>
            ))}
          </div>
          <p className="calibrated-overlay-note">
            Recomputed from imported data using the same shock model. The {modelStatus.exposureLabel.toLowerCase()} above is the published value; this overlay shows what the company's own data implies.
          </p>
        </div>
      ) : null}

      {takeaway && (
        <p className="card-takeaway">{takeaway}</p>
      )}

      <div className="card-action-line">
        <span className="card-action-label">Decision trigger</span>
        <span className="card-action-text">{decisionTrigger}</span>
      </div>

      {expanded && (
        <>
          <DetailPanel
            methodology={risk.methodology}
            evidence={risk.evidence_items || []}
            exposurePath={risk.exposure_path || []}
            expectedBenefit={risk.expected_benefit}
            matchedConnections={matchedConnections}
            overviewContent={{
              whatChanged: getRiskWhatChanged(risk),
              whyNow: getRiskWhyNow(risk),
              businessImpact: getRiskBusinessImpact(risk),
            }}
            issueForPath={risk}
            pathShockLabel={pathShockLabelFor(risk)}
          />
          {/* Legacy verified_shocks provenance (scenario tone) only applies to
              non-metric-backed issues. Metric/article issues show their real
              basis via the methodology section — never the "scenario assumption /
              no verified external metric" provenance card. */}
          {provenance && (((risk as any).numeric_basis_type ?? "no_numeric_basis") === "no_numeric_basis") && <ExternalShockProvenance prov={provenance} />}
          {/* Scenario Editor (low/mid/high) is hidden by default in executive mode — it only
              appears when the user opens "Show methodology / sensitivity". */}
          {(!execMode || showMethod) && (isFreightIssue(risk) || isTariffIssue(risk) || risk.issue_category?.includes("commodity")) && (
            <ScenarioEditor
              mode={isFreightIssue(risk) ? "freight" : "commodity"}
              calibration={calibration ?? undefined}
              calibratedKeys={calibratedKeys}
            />
          )}
          <DecisionMemoryPanel
            issueId={risk.id}
            issueTitle={risk.risk_title}
            issueType="risk"
            ownerFromAction={ownerFromAction}
            issueCreatedAt={(risk as any).created_at ?? null}
            issueUpdatedAt={(risk as any).last_updated ?? (risk as any).updated_at ?? null}
          />
          {gateResult && (
            <QualityGateReport
              gateResult={gateResult}
              confidence={Number(risk.confidence ?? 0)}
              metricBacked={["official_structured_metric", "manual_structured_metric", "company_structured_metric", "article_numeric_claim"].includes(String((risk as any).numeric_basis_type ?? ""))}
            />
          )}
        </>
      )}
    </div>
  );
}

function OperatingChangeCard({
  risk,
  expanded,
  onToggle,
  matchedConnections,
  execMode = false,
  execEstimate = null,
}: {
  risk: Risk;
  expanded: boolean;
  onToggle: () => void;
  matchedConnections: MatchedConnectionPath[];
  execMode?: boolean;
  execEstimate?: ExecutiveEstimate | null;
}) {
  const safeExplanation = getOperatingChangeSummary(risk);
  const safeDecisionTrigger = getTrustSafeDecisionTrigger(risk);
  const isCompetitor = /competitor|competition|market.?share/i.test(risk.issue_category || risk.risk_title || "");
  const opChangeLabel = isCompetitor ? "Competitive Exposure Base" : "Operating Change";
  // Canonical executive estimate is the source of truth (same as Dashboard/Exposure Graph).
  // It supersedes any stale stored residual / article-extracted methodology.
  const useExec = execMode && !!execEstimate && execEstimate.value !== null;
  // Operating changes are FAVORABLE (e.g. diesel/fuel-surcharge relief, tariff relief).
  // Never describe them as downside "value at stake".
  const execBusinessImpact = useExec
    ? `Approximately ${execEstimate!.display} of favorable impact under review on the calibrated exposure base. ${execEstimate!.caveat ?? ""}`.trim()
    : (risk.risk_interaction || risk.business_impact);

  return (
    <div className="record-card operating-change-card">
      <div className="record-top">
        <div>
          <div className="record-badge-row">
            <span className="blue-badge">{opChangeLabel}</span>
            <span className="direction-chip">{formatIssueDirection(risk.issue_direction)}</span>
          </div>
          <h3 className="record-title">{risk.risk_title}</h3>
        </div>
        <button className="text-button" onClick={onToggle}>
          {expanded ? "Hide analysis" : "View analysis →"}
        </button>
      </div>

      <div className="mini-grid mini-grid-2">
        <Mini
          label={useExec ? "Favorable impact" : "Residual exposure"}
          value={useExec ? execEstimate!.display : getResidualExposureDisplay(risk)}
          explanation={explainRiskExposure(risk)}
        />
        <Mini
          label="Confidence"
          value={useExec ? execEstimate!.confidence : `${clampPercent(risk.confidence)}% · ${formatConfidenceLabel(risk.confidence)}`}
        />
      </div>

      {useExec && (
        <div className="exec-estimate">
          <div className="exec-estimate-head">
            <span className="exec-estimate-source">{execEstimate!.sourceLabel}</span>
            <span className="exec-estimate-conf">Confidence: {execEstimate!.confidence}</span>
          </div>
          {execEstimate!.calculation && (
            <p className="exec-estimate-calc"><strong>Calculation:</strong> {execEstimate!.calculation}</p>
          )}
          {inlineProvenanceText(risk) && (
            <p className="exec-estimate-calc" style={{ color: "var(--text-muted)" }}><strong>Input provenance:</strong> {inlineProvenanceText(risk)}</p>
          )}
          {/fuel-exposed freight|diesel|fuel-surcharge/i.test(`${execEstimate!.calculation ?? ""} ${risk.risk_title}`) && (
            <p className="exec-estimate-calc" style={{ color: "var(--text-muted)" }}>
              <strong>Base note:</strong> fuel-exposed freight includes surchargeable fuel-sensitive lanes and may differ from the spot-exposed freight used in the Freight PPI issue. Source: demo calibration assumption.
            </p>
          )}
          {execEstimate!.sources.length > 0 && (
            <p className="exec-estimate-sources"><strong>Sources:</strong> {execEstimate!.sources.map((s) => `${s.label} — ${s.value}`).join(" · ")}</p>
          )}
          {execEstimate!.caveat && <p className="exec-estimate-caveat">{execEstimate!.caveat}</p>}
        </div>
      )}

      {safeExplanation && (
        <p className="card-takeaway">{safeExplanation}</p>
      )}

      <div className="card-action-line">
        <span className="card-action-label">Decision trigger</span>
        <span className="card-action-text">{safeDecisionTrigger}</span>
      </div>

      {expanded && (
        <DetailPanel
          methodology={risk.methodology}
          evidence={risk.evidence_items || []}
          exposurePath={risk.exposure_path || []}
          expectedBenefit={risk.expected_benefit}
          matchedConnections={matchedConnections}
          sectionType="operating_changes"
          overviewContent={{
            whatChanged: getOperatingChangeSummary(risk),
            whyNow: risk.why_now,
            businessImpact: execBusinessImpact,
          }}
          issueForPath={risk}
          pathShockLabel={pathShockLabelFor(risk)}
        />
      )}
    </div>
  );
}

// Canonical external-shock label for a risk's exposure path — derived from the
// stored numeric basis (source + exact %), never hardcoded. Returns undefined
// when there is no numeric basis (watch items).
function pathShockLabelFor(risk: any): string | undefined {
  const v = risk?.numeric_basis_value;
  const src = risk?.numeric_basis_source_label;
  if (v == null || !src) return undefined;
  const u = risk.numeric_basis_unit === "pct" ? "%" : (risk.numeric_basis_unit ?? "");
  return `${src} · ${v > 0 ? "+" : ""}${v}${u}`;
}

function WatchlistCard({
  risk,
  expanded,
  onToggle,
  matchedConnections,
}: {
  risk: Risk;
  expanded: boolean;
  onToggle: () => void;
  matchedConnections: MatchedConnectionPath[];
}) {
  const watchlistExplanation = getWatchlistSummary(risk);
  const upgradeText = getWatchlistUpgradeTrigger(risk);

  return (
    <div className="record-card watchlist-card-compact">
      <div className="watchlist-compact-row">
        <div className="watchlist-compact-left">
          <div className="record-badge-row">
            <span className="gray-badge">Watchlist</span>
            {/* Source-signal confidence — NOT business-impact confidence (item is unsized). */}
            <span className="watchlist-confidence-chip">Source signal confidence {clampPercent(risk.confidence)}%</span>
            <span className="direction-chip direction-chip-sm">{formatIssueDirection(risk.issue_direction || "uncertain")}</span>
            <span className="watchlist-unsized-chip">Unsized directional signal</span>
          </div>
          <p className="watchlist-signal-note">Not impact confidence; this signal is unsized until required company inputs are calibrated.</p>
          <h3 className="watchlist-compact-title">{risk.risk_title}</h3>
          <p className="watchlist-compact-body">{watchlistExplanation}</p>
          {upgradeText && !expanded && (
            <p className="watchlist-upgrade-hint">
              <span className="watchlist-upgrade-label">Upgrade trigger:</span> {upgradeText}
            </p>
          )}
        </div>
        <button className="text-button watchlist-toggle" onClick={onToggle}>
          {expanded ? "Collapse" : "Details"}
        </button>
      </div>

      {expanded && (
        <div className="watchlist-expanded">
          <DetailPanel
            methodology={risk.methodology}
            evidence={risk.evidence_items || []}
            exposurePath={risk.exposure_path || []}
            expectedBenefit={risk.expected_benefit}
            matchedConnections={matchedConnections}
            sectionType="watchlist"
            overviewContent={{
              whatChanged: risk.what_happened || risk.executive_summary,
              whyNow: risk.why_now,
              businessImpact: risk.risk_interaction || risk.business_impact,
            }}
            issueForPath={risk}
          />
          <div className="card-action-line" style={{ marginTop: 10 }}>
            <span className="card-action-label">Upgrade trigger</span>
            <span className="card-action-text">{upgradeText}</span>
          </div>
        </div>
      )}
    </div>
  );
}
function getOpportunityQuality(opportunity: Opportunity): "validated" | "candidate" | "needs_validation" {
  const evidence: any[] = opportunity.evidence_items || [];
  const summary = String(opportunity.summary || opportunity.title || "").toLowerCase();
  const modelStatus = getIssueModelStatus(opportunity.methodology);

  if (evidence.length === 0) return "needs_validation";

  // Unknown model status = no methodology data = cannot validate
  if (modelStatus.status === "unknown") return "needs_validation";

  const hasCompanySpecific = evidence.some((item: any) => {
    const text = [item.title, item.source, item.why_it_matters, item.impact_type]
      .filter(Boolean).join(" ").toLowerCase();
    return (
      /\b(earnings|guidance|management|segment|customer|backlog|pipeline|order|sales|revenue)\b/.test(text) &&
      /\b(call|report|filing|transcript|investor|company)\b/.test(text)
    );
  });

  const allBroadMarket = evidence.length > 0 && evidence.every((item: any) => {
    const text = [item.title, item.source].filter(Boolean).join(" ").toLowerCase();
    return /\b(industry|market|sector|economy|gdp|pmi|index|manufacturing|national)\b/.test(text) &&
      !/\b(fastenal|fast|fastn)\b/.test(text);
  });

  if (allBroadMarket && evidence.length <= 2) return "needs_validation";

  if (allBroadMarket || (!hasCompanySpecific && evidence.length <= 3)) {
    return "candidate";
  }

  if (summary.includes("generic") || summary.includes("broad") || summary.includes("macro")) {
    return "candidate";
  }

  return "validated";
}

function OpportunityCard({
  opportunity,
  expanded,
  onToggle,
  movement,
  matchedConnections,
}: {
  opportunity: Opportunity;
  expanded: boolean;
  onToggle: () => void;
  movement: string;
  matchedConnections: MatchedConnectionPath[];
}) {
  const quality = getOpportunityQuality(opportunity);
  const movementLabel = formatMovementLabel(movement);
  const decisionTrigger = getTrustSafeDecisionTrigger(opportunity);

  const qualityLabel =
    quality === "validated" ? "Validated Opportunity"
    : quality === "candidate" ? "Opportunity Candidate"
    : "Needs Validation";

  const qualityBadgeClass =
    quality === "validated" ? "green-badge"
    : quality === "candidate" ? "amber-badge"
    : "gray-badge";

  return (
    <div className="record-card">
      <div className="record-top">
        <div>
          <div className="record-badge-row">
            <span className={qualityBadgeClass}>
              {quality === "validated" ? `#${opportunity.opportunity_rank || "-"} ` : ""}{qualityLabel}
            </span>
            {movementLabel && movementLabel !== "Unchanged" && (
              <span className="movement-chip">{movementLabel}</span>
            )}
          </div>
          <h3 className="record-title">{getOpportunityTitle(opportunity)}</h3>
        </div>
        <button className="text-button" onClick={onToggle}>
          {expanded ? "Hide analysis" : "View analysis →"}
        </button>
      </div>

      <div className="mini-grid mini-grid-3">
        <Mini
          label={quality === "validated" ? "Potential upside" : isManufacturingOpportunity(opportunity) ? "Candidate upside range" : "Directional upside"}
          value={`${formatMoney(opportunity.revenue_low)}–${formatMoney(opportunity.revenue_high)}`}
          explanation={explainOpportunityExposure(opportunity)}
        />
        <Mini
          label="Confidence"
          value={
            quality === "needs_validation"
              ? "Needs validation"
              : quality === "candidate"
              ? `${formatConfidenceLabel(opportunity.confidence)} (directional)`
              : `${clampPercent(opportunity.confidence)}% · ${formatConfidenceLabel(opportunity.confidence)}`
          }
        />
        <Mini
          label="Priority"
          value={`${opportunity.priority_score || 0}/100`}
          explanation={explainOpportunityPriority(opportunity)}
        />
      </div>

      {(opportunity.summary || isManufacturingOpportunity(opportunity)) && (
        <p className="card-takeaway">
          {getOpportunitySummary(opportunity).slice(0, 280)}
        </p>
      )}

      {quality === "candidate" && (
        <p className="candidate-note">Candidate — broad market signals, not company-specific. Upgrade requires earnings confirmation or segment data.</p>
      )}
      {quality === "needs_validation" && (
        <p className="candidate-note candidate-note-warn">Needs validation — insufficient evidence to size upside. Add company-specific data before acting.</p>
      )}

      <div className="card-action-line">
        <span className="card-action-label">Decision trigger</span>
        <span className="card-action-text">{decisionTrigger}</span>
      </div>

      {expanded && (
        <DetailPanel
          methodology={opportunity.methodology}
          evidence={opportunity.evidence_items || []}
          exposurePath={opportunity.exposure_path || []}
          expectedBenefit={opportunity.expected_benefit}
          matchedConnections={matchedConnections}
          sectionType="opportunity"
          overviewContent={{
            whatChanged: getOpportunityWhatChanged(opportunity),
            whyNow: getOpportunityWhyNow(opportunity),
            businessImpact: (opportunity as any).business_impact,
          }}
          issueForPath={opportunity}
        />
      )}
    </div>
  );
}
function getEvidenceScore(item: any) {
  return clampScore(
    Math.max(
      Number(item.evidence_score || 0),
      Number(item.strategic_score || 0),
      Number(item.relevance_seed_score || 0),
      Number(item.confidence || 0),
      Number(item.source_quality || 0)
    )
  );
}

function formatFreshnessFromPublishedAt(
  publishedAt: string | null | undefined,
  fallbackAgeDays: number | null | undefined,
  fallbackLabel: string | null | undefined
) {
  if (publishedAt) {
    const publishedMs = new Date(publishedAt).getTime();
    const nowMs = Date.now();

    if (Number.isFinite(publishedMs)) {
      const diffMs = Math.max(0, nowMs - publishedMs);
      const diffMinutes = Math.floor(diffMs / (1000 * 60));
      const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

      if (diffMinutes < 60) {
        return `${Math.max(1, diffMinutes)}m ago`;
      }

      if (diffHours < 24) {
        return `${Math.max(1, diffHours)}h ago`;
      }

      return `${diffDays}d ago`;
    }
  }

  if (fallbackAgeDays !== null && fallbackAgeDays !== undefined) {
    const days = Number(fallbackAgeDays);

    if (Number.isFinite(days)) {
      if (days < 1) return "<24h ago";
      return `${Math.round(days)}d ago`;
    }
  }

  return fallbackLabel || "Unknown date";
}
function DetailPanel({
  methodology,
  evidence,
  exposurePath,
  expectedBenefit,
  matchedConnections = [],
  sectionType,
  overviewContent,
  issueForPath,
  pathShockLabel,
}: {
  methodology?: Methodology | null;
  evidence: EvidenceItem[];
  exposurePath: any;
  expectedBenefit?: string | null;
  matchedConnections?: MatchedConnectionPath[];
  sectionType?: "risk_register" | "operating_changes" | "watchlist" | "opportunity";
  overviewContent?: {
    whatChanged?: string | null;
    whyNow?: string | null;
    businessImpact?: string | null;
    modelNote?: string | null;
  } | null;
  issueForPath?: Risk | Opportunity | null;
  // Canonical shock label to replace generic stored placeholders (e.g. "1% price move")
  // in the qualitative impact path, so the path reflects the verified shock.
  pathShockLabel?: string;
}) {
  const [activeTab, setActiveTab] = useState<"path" | "evidence" | "audit">("path");
  const [showAllEvidence, setShowAllEvidence] = useState(false);

  function pickNumber(values: any[], fallback = 0) {
    for (const value of values) {
      const n = Number(value);
      if (Number.isFinite(n) && n > 0) return n;
    }
    return fallback;
  }

  const normalizedEvidence = Array.isArray(evidence)
    ? evidence
        .map((item: any) => {
          const normalized = {
            ...item,
            title: item.title || item.event_title || "Untitled evidence",
            source: item.source || item.source_name || item.publisher || "",
            url: item.url || item.source_url || "",
            source_tier: item.source_tier || item.tier || "unknown",
            source_quality: pickNumber(
              [item.source_quality, item.quality, item.evidence_quality_score],
              0
            ),
            published_at: item.published_at || item.publishedAt || null,
            strategic_score: Number(item.strategic_score || 0),
            confidence: Number(item.confidence || 0),
            evidence_score: Number(item.evidence_score || 0),
            relevance_seed_score: Number(item.relevance_seed_score || 0),
            age_days: item.age_days ?? item.event_age_days ?? item.ageDays ?? null,
            age_label: item.age_label || item.ageLabel || null,
          };
          return {
            ...normalized,
            display_score: getEvidenceScore(normalized),
            display_age_label: formatFreshnessFromPublishedAt(
              normalized.published_at,
              normalized.age_days,
              normalized.age_label
            ),
          };
        })
        .sort((a: any, b: any) => {
          const scoreDiff = Number(b.display_score || 0) - Number(a.display_score || 0);
          if (scoreDiff !== 0) return scoreDiff;
          const bTime = b.published_at ? new Date(b.published_at).getTime() : 0;
          const aTime = a.published_at ? new Date(a.published_at).getTime() : 0;
          return bTime - aTime;
        })
    : [];

  const safeExposurePath = Array.isArray(exposurePath)
    ? exposurePath
    : exposurePath
    ? [exposurePath]
    : [];

  // Build the best available path nodes for display
  const bestPathNodes = (() => {
    if (matchedConnections.length > 0) {
      const conn = matchedConnections[0];
      if (conn.path_nodes && conn.path_nodes.length >= 2) return conn.path_nodes;
    }
    if (safeExposurePath.length >= 2) return safeExposurePath;
    if (issueForPath) {
      const text = buildPrimaryPathText(issueForPath, matchedConnections);
      if (text) return text.split(" → ");
    }
    return null;
  })();

  // Replace generic stored shock placeholders (e.g. "1% price move", "1% move") in the
  // qualitative impact path with the canonical verified-shock label for this issue.
  const issueNBType = (issueForPath as any)?.numeric_basis_type ?? "no_numeric_basis";
  const issueNBValue = (issueForPath as any)?.numeric_basis_value;
  const issueNBUnit = (issueForPath as any)?.numeric_basis_unit ?? "pct";
  const issueNBSnippet = (issueForPath as any)?.numeric_basis_snippet;
  const articleShockLabel = issueNBType === "article_numeric_claim" && issueNBValue != null
    ? `${issueNBValue}${issueNBUnit === "pct" ? "%" : ` ${issueNBUnit}`} article-claimed signal${issueNBSnippet ? ` ("${String(issueNBSnippet).slice(0, 40)}…")` : ""}`
    : null;
  const sanitizedPathNodes = bestPathNodes
    ? bestPathNodes.map((n: any) =>
        /\b1%\s*(price\s*)?move\b|\bprice move\b/i.test(String(n))
          ? (pathShockLabel || articleShockLabel || "External price signal")
          : n
      )
    : null;

  // Canonical operating paths for known issues — overrides generic stored connection nodes
  // (e.g. "Manufacturing Customers") so executive impact paths are accurate. Unknown issues
  // fall back to the sanitized stored path.
  const CANONICAL_IMPACT_PATHS: Record<string, string[]> = {
    freight: [
      "Freight",
      "BLS freight/logistics PPI +0.8%",
      "Spot-exposed freight spend",
      "Current-period logistics cost pressure",
      "Customer pricing / contract pass-through",
      "Margin exposure",
    ],
    tariff: [
      "Tariff 25% → 15%",
      "Steel-linked import exposure",
      "Unpassed landed-cost exposure",
      "Supplier landed-cost validation",
      "COGS relief / margin impact",
    ],
  };
  // Metric-backed issues render their REAL stored exposure_path (each node's
  // detail carries the true source + exact %), never the hardcoded canonical
  // scenario path. The canonical freight/tariff paths apply ONLY to legacy
  // scenario-backed issues.
  const issueMetricBacked = ["official_structured_metric", "manual_structured_metric", "company_structured_metric", "article_numeric_claim"].includes(issueNBType);
  const exposurePathDetails = issueMetricBacked && safeExposurePath.length > 0
    && safeExposurePath.every((p: any) => p && typeof p === "object" && "detail" in p)
    ? safeExposurePath.map((p: any) => String(p.detail))
    : null;
  const canonicalPath =
    !issueMetricBacked && issueForPath && "risk_title" in issueForPath
      ? isFreightIssue(issueForPath as Risk)
        ? CANONICAL_IMPACT_PATHS.freight
        : isTariffIssue(issueForPath as Risk)
        ? CANONICAL_IMPACT_PATHS.tariff
        : null
      : null;
  const cleanPathNodes = exposurePathDetails ?? canonicalPath ?? sanitizedPathNodes;

  return (
    <div className="analysis-panel">
      <div className="analysis-tabs">
        <button
          className={`analysis-tab${activeTab === "path" ? " active" : ""}`}
          onClick={() => setActiveTab("path")}
        >
          Impact Path
        </button>
        <button
          className={`analysis-tab${activeTab === "evidence" ? " active" : ""}`}
          onClick={() => setActiveTab("evidence")}
        >
          Evidence{normalizedEvidence.length > 0 ? ` (${normalizedEvidence.length})` : ""}
        </button>
        <button
          className={`analysis-tab${activeTab === "audit" ? " active" : ""}`}
          onClick={() => setActiveTab("audit")}
        >
          {canViewAdminControls() ? "Model Audit" : "Methodology"}
        </button>
      </div>

      {activeTab === "path" && (
        <div className="analysis-tab-content">
          {overviewContent?.modelNote && (
            <div className="analysis-model-note">
              <strong>Model note:</strong> Values found in evidence (e.g., {overviewContent.modelNote}) were classified as cumulative or contextual. Exposure uses scenario assumptions. See Model Audit for detail.
            </div>
          )}

          {overviewContent?.whatChanged && (
            <div className="analysis-overview-row">
              <span className="analysis-ov-label">{overviewContent.modelNote ? "Market context" : "What changed"}</span>
              <span className="analysis-ov-text">{officializeText(overviewContent.whatChanged)}</span>
            </div>
          )}
          {overviewContent?.whyNow && (
            <div className="analysis-overview-row">
              <span className="analysis-ov-label">Why now</span>
              <span className="analysis-ov-text">{officializeText(overviewContent.whyNow)}</span>
            </div>
          )}
          {overviewContent?.businessImpact && (
            <div className="analysis-overview-row">
              <span className="analysis-ov-label">Business impact</span>
              <span className="analysis-ov-text">{officializeText(overviewContent.businessImpact)}</span>
            </div>
          )}

          <div className="analysis-path-section">
            <p className="analysis-path-label">How Impact Reaches Fastenal</p>
            {cleanPathNodes && cleanPathNodes.length >= 2 ? (
              <LayeredPath nodes={cleanPathNodes} />
            ) : (
              <p className="muted">No impact path available. Run Build Exposure Graph to generate paths.</p>
            )}
          </div>

          {(() => {
            if (!issueForPath || !("risk_title" in issueForPath)) return null;
            // Buyer: "Exposure driver" with a useful driver label (risk_type / driver_template),
            // never the bare "risk" category. Operator keeps the raw "Driver category".
            const raw = String(
              (issueForPath as any).risk_type ||
              ((issueForPath as any).methodology && (issueForPath as any).methodology.driver_template) ||
              (issueForPath as Risk).issue_category || ""
            ).replace(/_/g, " ").trim();
            if (!raw || raw.toLowerCase() === "risk" || raw.toLowerCase() === "operating change") return null;
            return (
              <div className="analysis-overview-row" style={{ marginTop: 8 }}>
                <span className="analysis-ov-label">{canViewAdminControls() ? "Driver category" : "Exposure driver"}</span>
                <span className="analysis-ov-text">{raw}</span>
              </div>
            );
          })()}

          <div className="analysis-placeholder-row">
            <div className="analysis-placeholder">
              <span className="placeholder-title">Directional P&amp;L Bridge</span>
              <span className="placeholder-body">{getIssuePLBridge(issueForPath)}</span>
            </div>
          </div>
        </div>
      )}

      {activeTab === "evidence" && (
        <div className="analysis-tab-content">
          <EvidenceSummaryHeader evidence={normalizedEvidence} methodology={methodology} />
          {normalizedEvidence.length === 0 ? (
            <p className="muted">No paired evidence available.</p>
          ) : (
            <>
              <button
                className="text-button analysis-ev-toggle"
                onClick={() => setShowAllEvidence((v) => !v)}
              >
                {showAllEvidence
                  ? "Hide sources ▲"
                  : `View sources (${normalizedEvidence.length}) ▼`}
              </button>
              {showAllEvidence && (
                <div className="evidence-source-list">
                  {normalizedEvidence.slice(0, 6).map((item: any, index: number) => (
                    <div key={`${item.title}-${index}`} className="evidence-row">
                      <div className="evidence-row-header">
                        <p className="action-title">{item.title}</p>
                        <EvidenceTierBadge item={item} />
                      </div>
                      <p className="muted">
                        {item.source || "Unknown source"} · {item.display_age_label}
                      </p>
                      {item.url && (
                        <a href={item.url} target="_blank" rel="noreferrer" className="link">
                          Open source
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
          {expectedBenefit && (
            <div className="analysis-overview-row" style={{ marginTop: 12 }}>
              <span className="analysis-ov-label">Expected benefit</span>
              <span className="analysis-ov-text">{expectedBenefit}</span>
            </div>
          )}
        </div>
      )}

      {activeTab === "audit" && (
        <div className="analysis-tab-content">
          <TrustAuditPanel
            methodology={methodology}
            evidence={normalizedEvidence}
            sectionType={sectionType}
            issue={issueForPath}
          />
        </div>
      )}
    </div>
  );
}
function normalizePathNodes(input: any): string[] {
  if (!input) return [];

  if (Array.isArray(input)) {
    return input
      .map((item) => {
        if (typeof item === "string") return item;
        if (typeof item === "number") return String(item);

        if (item && typeof item === "object") {
          return (
            item.label ||
            item.name ||
            item.title ||
            item.step ||
            item.node ||
            JSON.stringify(item)
          );
        }

        return "";
      })
      .filter(Boolean);
  }

  if (typeof input === "string") {
    try {
      const parsed = JSON.parse(input);
      return normalizePathNodes(parsed);
    } catch {
      return [input];
    }
  }

  if (typeof input === "object") {
    if (Array.isArray(input.nodes)) return normalizePathNodes(input.nodes);
    if (Array.isArray(input.path)) return normalizePathNodes(input.path);
    if (Array.isArray(input.steps)) return normalizePathNodes(input.steps);

    const fallbackNodes = [
      input.title,
      input.type || input.risk_type,
      input.base_type,
      input.formula,
      input.exposure_high
        ? `$${Math.round(Number(input.exposure_high) / 1000000).toFixed(
            1
          )}M modeled exposure`
        : null,
      input.impact_high
        ? `$${Math.round(Number(input.impact_high) / 1000000).toFixed(
            1
          )}M modeled exposure`
        : null,
      input.evidence_count ? `${input.evidence_count} supporting signals` : null,
    ];

    return fallbackNodes.map(String).filter((value) => value && value !== "null" && value !== "undefined");
  }

  return [];
}

function LayeredPath({ nodes }: { nodes: any }) {
  const safeNodes = normalizePathNodes(nodes);

  if (safeNodes.length === 0) {
    return (
      <div className="layered-path">
        <div className="path-node">
          <div className="path-node-index">1</div>
          <div className="path-node-label">No exposure path available</div>
        </div>
      </div>
    );
  }

  return (
    <div className="layered-path">
      {safeNodes.map((node, index) => (
        <div key={`${node}-${index}`} className="path-step">
          <div className="path-node">
            <div className="path-node-index">{index + 1}</div>
            <div className="path-node-label">{node}</div>
          </div>

          {index < safeNodes.length - 1 && (
            <div className="path-arrow">↓</div>
          )}
        </div>
      ))}
    </div>
  );
}
function ExplanationTooltipContent({
  explanation,
}: {
  explanation: NumberExplanation;
}) {
  const sectionStyle = {
    display: "flex",
    flexDirection: "column" as const,
    gap: "4px",
    color: "var(--tooltip-text-muted)",
  };

  const labelStyle = {
    color: "var(--tooltip-accent)",
    fontSize: "10px",
    fontWeight: 900,
    letterSpacing: "0.06em",
    textTransform: "uppercase" as const,
  };

  const lineStyle = {
    color: "var(--tooltip-text-muted)",
    fontSize: "12px",
    lineHeight: 1.45,
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "10px",
        color: "var(--tooltip-text)",
        fontFamily: "var(--app-font)",
        fontSize: "12px",
        lineHeight: 1.45,
        textAlign: "left",
      }}
    >
      <strong
        style={{
          display: "block",
          color: "var(--tooltip-heading)",
          fontFamily: "var(--app-font)",
          fontSize: "13px",
          fontWeight: 850,
          paddingBottom: "6px",
          borderBottom: "1px solid var(--tooltip-border)",
        }}
      >
        {explanation.title}
      </strong>

      {explanation.formula && (
        <div style={sectionStyle}>
          <span style={labelStyle}>Formula</span>
          <span style={lineStyle}>{explanation.formula}</span>
        </div>
      )}

      {explanation.displayedValue && (
        <div style={sectionStyle}>
          <span style={labelStyle}>Displayed value</span>
          <span style={lineStyle}>{explanation.displayedValue}</span>
        </div>
      )}

      {Array.isArray(explanation.inputs) && explanation.inputs.length > 0 && (
        <div style={sectionStyle}>
          <span style={labelStyle}>Inputs</span>
          {explanation.inputs.map((input, index) => {
            const text =
              typeof input === "string"
                ? input
                : `${input.label}: ${input.value}`;

            return (
              <span key={`${text}-${index}`} style={lineStyle}>
                • {text}
              </span>
            );
          })}
          {explanation.inputsProvenance && (
            <span style={{ ...lineStyle, marginTop: 4, color: "var(--text-muted)", fontStyle: "italic" }}>
              Source: {explanation.inputsProvenance}
            </span>
          )}
        </div>
      )}

      {Array.isArray(explanation.bullets) && explanation.bullets.length > 0 && (
        <div style={sectionStyle}>
          {explanation.bullets.map((bullet, index) => (
            <span key={`${bullet}-${index}`} style={lineStyle}>
              • {bullet}
            </span>
          ))}
        </div>
      )}

      {explanation.source && (
        <div style={sectionStyle}>
          <span style={labelStyle}>Source</span>
          <span style={lineStyle}>{explanation.source}</span>
        </div>
      )}

      {(explanation.note || explanation.caveat) && (
        <div style={sectionStyle}>
          <span style={labelStyle}>Note</span>
          <span style={lineStyle}>
            {explanation.note || explanation.caveat}
          </span>
        </div>
      )}
    </div>
  );
}
function SmartTooltip({
  className,
  children,
  content,
}: {
  className: string;
  children: React.ReactNode;
  content: React.ReactNode;
}) {
  const triggerRef = useRef<HTMLSpanElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);

  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const [position, setPosition] = useState({
    left: 16,
    top: 16,
  });

  function updatePosition() {
    const trigger = triggerRef.current;
    const tooltip = tooltipRef.current;

    if (!trigger || !tooltip) return;

    const triggerRect = trigger.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();

    const padding = 16;
    const gap = 10;

    let left =
      triggerRect.left + triggerRect.width / 2 - tooltipRect.width / 2;

    left = Math.max(
      padding,
      Math.min(left, window.innerWidth - tooltipRect.width - padding)
    );

    const belowTop = triggerRect.bottom + gap;
    const aboveTop = triggerRect.top - tooltipRect.height - gap;

    let top = belowTop;

    if (belowTop + tooltipRect.height + padding > window.innerHeight) {
      top = aboveTop;
    }

    top = Math.max(
      padding,
      Math.min(top, window.innerHeight - tooltipRect.height - padding)
    );

    setPosition({ left, top });
    setReady(true);
  }

  useLayoutEffect(() => {
    if (!open) {
      setReady(false);
      return;
    }

    const frameOne = requestAnimationFrame(() => {
      updatePosition();
      requestAnimationFrame(updatePosition);
    });

    return () => cancelAnimationFrame(frameOne);
  }, [open, content]);

  useEffect(() => {
    if (!open) return;

    function handleUpdate() {
      updatePosition();
    }

    window.addEventListener("resize", handleUpdate);
    window.addEventListener("scroll", handleUpdate, true);

    return () => {
      window.removeEventListener("resize", handleUpdate);
      window.removeEventListener("scroll", handleUpdate, true);
    };
  }, [open]);

  return (
    <>
      <span
        ref={triggerRef}
        className={className}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        tabIndex={0}
      >
        {children}
      </span>

      {open &&
        createPortal(
          <div
            ref={tooltipRef}
            style={{
              position: "fixed",
              left: `${position.left}px`,
              top: `${position.top}px`,
              zIndex: 2147483647,
              visibility: ready ? "visible" : "hidden",

              width: "390px",
              maxWidth: "calc(100vw - 32px)",
              maxHeight: "calc(100vh - 32px)",
              overflowY: "auto",
              overflowX: "hidden",

              padding: "14px",
              borderRadius: "14px",
              border: "1px solid var(--tooltip-border)",
              background: "var(--tooltip-bg)",
              color: "var(--tooltip-text)",
              boxShadow: "var(--tooltip-shadow)",

              fontFamily: "var(--app-font)",
              fontSize: "12px",
              lineHeight: 1.45,
              whiteSpace: "normal",
              textAlign: "left",
              pointerEvents: "none",
              animation: "gs-tooltip-in 160ms cubic-bezier(0.25, 1, 0.5, 1) both",
            }}
          >
            {content}
          </div>,
          document.body
        )}
    </>
  );
}
function ExplainableValue({
  value,
  explanation,
  className,
}: {
  value: string;
  explanation?: NumberExplanation | null;
  className?: string;
}) {
  if (!explanation) {
    return <span className={className}>{value}</span>;
  }

  return (
    <SmartTooltip
      className="gs-explain-wrap"
      content={<ExplanationTooltipContent explanation={explanation} />}
    >
      <span className={className || "gs-explain-value"}>{value}</span>
      <span className="gs-explain-icon">?</span>
    </SmartTooltip>
  );
}
function Metric({
  title,
  value,
  subtitle,
  explanation,
}: {
  title: string;
  value: string;
  subtitle: string;
  explanation?: NumberExplanation | null;
}) {
  return (
    <div className="metric">
      <p className="metric-label">{title}</p>

      <h3 className="metric-value">
        <ExplainableValue value={value} explanation={explanation} />
      </h3>

      <p className="metric-subtitle">{subtitle}</p>
    </div>
  );
}

function Mini({
  label,
  value,
  explanation,
}: {
  label: string;
  value: string;
  explanation?: NumberExplanation | null;
}) {
  return (
    <div className="mini-card">
      <div className="mini-label">
        <span>{label}</span>

        {explanation && (
          <SmartTooltip
            className="mini-help"
            content={<ExplanationTooltipContent explanation={explanation} />}
          >
            ?
          </SmartTooltip>
        )}
      </div>

      <div className="mini-value">{value}</div>
    </div>
  );
}
function clampScore(value: unknown) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function clampPercent(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function formatConfidenceLabel(value: unknown): "High" | "Medium" | "Low" | "Needs validation" {
  const n = clampPercent(value);
  if (n >= 75) return "High";
  if (n >= 50) return "Medium";
  if (n >= 25) return "Low";
  return "Needs validation";
}

function formatMovementLabel(raw: string): string {
  if (!raw || raw === "—" || raw === "null" || raw === "undefined") return "";
  if (raw === "New") return "New";
  if (raw === "Unchanged") return "Unchanged";
  const n = Number(raw);
  if (!Number.isFinite(n)) return "";
  if (n === 0) return "Unchanged";
  return n > 0 ? `▲${n}` : `▼${Math.abs(n)}`;
}

function formatEstimateQuality(methodology?: Methodology | null): string {
  const status = getIssueModelStatus(methodology);
  if (status.status === "evidence_backed") return "Article-verified";
  if (status.status === "scenario_fallback") return "Scenario range";
  if (status.status === "needs_calibration") return "Needs company validation";
  return "Partially grounded";
}

function getTriageBadge(issue: Risk): { label: "Act" | "Validate" | "Watch" | "Ignore"; className: string } {
  const status = getIssueModelStatus(issue.methodology);
  const score = Number(issue.priority_score || 0);

  if (issue.display_section === "watchlist") {
    return { label: "Watch", className: "triage-badge triage-watch" };
  }
  if (status.status === "needs_calibration") {
    return { label: "Validate", className: "triage-badge triage-validate" };
  }
  if (score >= 68) {
    return { label: "Act", className: "triage-badge triage-act" };
  }
  if (score >= 40) {
    return { label: "Validate", className: "triage-badge triage-validate" };
  }
  return { label: "Watch", className: "triage-badge triage-watch" };
}


function getDecisionTrigger(issue: Risk | Opportunity): string {
  const typed = issue as any;
  if (typed.decision_required && String(typed.decision_required).trim()) {
    return String(typed.decision_required).trim().slice(0, 150);
  }
  const status = getIssueModelStatus(typed.methodology);
  if (status.status === "needs_calibration") {
    return "Confirm calibration inputs before escalating. Add missing company data, then regenerate.";
  }
  if (status.status === "scenario_fallback") {
    return "Validate when a specific, company-verified shock percentage or announcement becomes available.";
  }
  if (typed.display_section === "watchlist") {
    return "Upgrade to active risk when a direct adverse signal with company-specific evidence arrives.";
  }
  return "Monitor for escalation. Assign owner when priority exceeds threshold.";
}

function getConfidenceDecomposition(
  methodology?: Methodology | null,
  evidence?: any[],
  issue?: Risk | Opportunity | null
): Array<{ label: string; value: string; level: "High" | "Medium" | "Low" | "Needs validation" }> {
  const items = Array.isArray(evidence) ? evidence : [];
  const avgQuality = items.length > 0
    ? Math.round(items.reduce((s, e) => s + (Number(e.source_quality) || 50), 0) / items.length)
    : 0;

  const evidenceLevel =
    items.length >= 5 && avgQuality >= 65 ? "High"
    : items.length >= 2 ? "Medium"
    : items.length > 0 ? "Low"
    : "Needs validation";

  const typed = issue as any;
  const nbType: string = typed?.numeric_basis_type ?? "no_numeric_basis";
  const isOfficialMetric = ["official_structured_metric", "manual_structured_metric"].includes(nbType);
  const isArticleClaim = nbType === "article_numeric_claim";
  const isScenario = nbType === "no_numeric_basis";

  const mappingLevel: "High" | "Medium" | "Low" | "Needs validation" =
    isOfficialMetric ? "High"
    : isArticleClaim ? "Medium"
    : isScenario ? "Needs validation"
    : "Needs validation";

  const hasBase = !!methodology?.base_exposure_value;
  const exposureLevel =
    hasBase && isOfficialMetric ? "High"
    : hasBase ? "Medium"
    : "Needs validation";

  const hasAction = !!(typed?.decision_required || typed?.action_required);
  const actionLevel = hasAction ? "Medium" : "Needs validation" as const;

  return [
    {
      label: "Evidence confidence",
      value: items.length > 0 ? `${items.length} item${items.length !== 1 ? "s" : ""}, avg quality ${avgQuality}/100` : "No evidence paired",
      level: evidenceLevel,
    },
    {
      label: "Mapping confidence",
      value: isOfficialMetric
        ? "Verified external metric — structured data source"
        : isArticleClaim
          ? `Article-claimed metric · ${typed?.numeric_basis_snippet ? `"${String(typed.numeric_basis_snippet).slice(0, 60)}…"` : "validation required"}`
          : isScenario
            ? "No verified external number — scenario assumption used"
            : "Not mapped",
      level: mappingLevel,
    },
    {
      label: "Exposure confidence",
      value: methodology?.base_exposure_value ? `Base: ${formatMoney(methodology.base_exposure_value)}` : "No base exposure stored",
      level: exposureLevel,
    },
    {
      label: "Action confidence",
      value: typed?.decision_required ? String(typed.decision_required).slice(0, 80) : "No explicit action specified",
      level: actionLevel,
    },
  ];
}


function getIssuePLBridge(issue?: Risk | Opportunity | null): string {
  if (!issue) return "Revenue · Gross margin · COGS · SG&A · EBITDA — Directional only, not an earnings forecast. Requires calibration inputs.";
  const category = String((issue as any).issue_category || "").toLowerCase();
  const title = String((issue as any).risk_title || (issue as any).title || "").toLowerCase();
  const section = (issue as any).display_section || "";

  if (section === "opportunity" || "revenue_low" in issue) {
    return "Revenue ↑ · Gross margin ↑ (volume leverage) · SG&A ↑ (sales cost) — Upside directional only. Requires segment confirmation.";
  }
  // Fuel / diesel surcharge relief is FAVORABLE — never the generic downside bridge.
  if (category.includes("fuel") || title.includes("diesel") || title.includes("fuel-surcharge") || title.includes("fuel surcharge")) {
    return "Freight/fuel expense ↓ · Gross margin/EBITDA ↑ · Cash savings subject to carrier surcharge pass-through — Favorable relief; timing depends on when carriers update fuel-surcharge tables.";
  }
  if (category.includes("freight") || category.includes("logistics") || title.includes("freight")) {
    return "COGS ↑ (freight in) · SG&A ↑ (outbound freight) · Gross margin ↓ — Direct cost impact. Pass-through rate determines net P&L effect.";
  }
  if (category.includes("tariff") || category.includes("trade") || title.includes("tariff")) {
    return "COGS ↓ potential relief · Gross margin ↑ if supplier landed costs update · Residual exposure remains until supplier/PO validation.";
  }
  if (category.includes("commodity") || category.includes("steel") || category.includes("copper") || category.includes("aluminum") || title.includes("steel") || title.includes("copper") || title.includes("aluminum")) {
    return "COGS ↑ (raw material) · Gross margin ↓ · Revenue ↔ (pass-through lag) — Commodity cost pressure. Lag and hedging determine timing.";
  }
  if (category.includes("competitor") || category.includes("market_share") || title.includes("competitor")) {
    return "Revenue ↓ (share shift) · Gross margin ↔ · SG&A ↑ (retention spend) — Competitive displacement. Volume loss drives operating deleverage.";
  }
  if (category.includes("demand") || category.includes("customer") || category.includes("revenue")) {
    return "Revenue ↓ · Gross margin ↓ (deleverage) · EBITDA ↓ — Demand-side pressure. Fixed cost absorption worsens at lower volumes.";
  }
  if (category.includes("service") || category.includes("fill_rate") || category.includes("backorder")) {
    return "Revenue ↓ (lost sales) · SG&A ↑ (expedite cost) · Gross margin ↓ — Service failure leakage. Expedite costs compound the revenue miss.";
  }
  if (section === "watchlist") {
    return "P&L bridge not yet modeled — watchlist item. Upgrade to active risk to generate directional P&L estimate.";
  }
  return "Revenue · Gross margin · COGS · SG&A · EBITDA — Directional only. Specific P&L line depends on company calibration inputs.";
}

function formatPercentDecimal(value: unknown, digits = 1) {
  const n = Number(value);

  if (!Number.isFinite(n) || n <= 0) {
    return "Not stored";
  }

  return `${(n * 100).toFixed(digits)}%`;
}

function formatScenarioPercent(value: unknown, digits = 1) {
  const n = Number(value);

  if (!Number.isFinite(n) || n <= 0) {
    return "N/A";
  }

  return `${(n * 100).toFixed(digits)}%`;
}

function getMethodologyCalculationInputs(methodology: any) {
  return getMetadata(methodology?.calculation_inputs);
}
type IssueModelStatus =
  | "evidence_backed"
  | "scenario_fallback"
  | "needs_calibration"
  | "watchlist_uncertain"
  | "unknown";

function getIssueModelStatus(methodology?: Methodology | null): {
  status: IssueModelStatus;
  label: string;
  className: string;
  exposureLabel: string;
} {
  const method: any = methodology || {};
  const inputs = getMethodologyCalculationInputs(method);

  // Canonical: the stored numeric_basis_type is the single source of truth for the
  // model badge. A metric-backed issue is NEVER labeled scenario/needs-calibration.
  const nbType = String(method.numeric_basis_type || "");
  if (["official_structured_metric", "manual_structured_metric", "company_structured_metric"].includes(nbType)) {
    return {
      status: "evidence_backed",
      label: "Official metric",
      className: "model-status model-status-evidence",
      exposureLabel: "Official metric-backed exposure",
    };
  }
  if (nbType === "article_numeric_claim") {
    return {
      status: "evidence_backed",
      label: "Article-claimed metric",
      className: "model-status model-status-evidence",
      exposureLabel: "Article-claimed exposure · validation required",
    };
  }

  if (
    method.calibration_status === "needs_calibration" ||
    method.formula_status === "not_calculated"
  ) {
    return {
      status: "needs_calibration",
      label: "Needs calibration",
      className: "model-status model-status-missing",
      exposureLabel: "Not modeled",
    };
  }

  const source = String(
    inputs.shock_source || method.shock_source || ""
  ).toLowerCase();

  if (
    source === "explicit_new_source_number" ||
    source === "explicit_news_number"
  ) {
    return {
      status: "evidence_backed",
      label: "Secondary article/context signal",
      className: "model-status model-status-evidence",
      exposureLabel: "Secondary article/context signal · validation required",
    };
  }

  // Verified public/official metrics (BLS PPI, manual structured tariff metric, etc.) are
  // source-backed — not scenario assumptions.
  if (
    source.includes("bls") ||
    source.includes("verified") ||
    source.includes("structured") ||
    source.includes("manual_metric") ||
    source.includes("official")
  ) {
    return {
      status: "evidence_backed",
      label: "Official metric-backed",
      className: "model-status model-status-evidence",
      exposureLabel: "Official metric-backed exposure",
    };
  }

  if (source.includes("scenario_fallback")) {
    return {
      status: "scenario_fallback",
      label: "Scenario-modeled",
      className: "model-status model-status-scenario",
      exposureLabel: "Scenario exposure",
    };
  }

  return {
    status: "unknown",
    label: "Model status unknown",
    className: "model-status model-status-unknown",
    exposureLabel: "Exposure",
  };
}

function getRejectedExplicitShocks(methodology?: Methodology | null) {
  const inputs = getMethodologyCalculationInputs(methodology || {});
  const rejected = inputs.rejected_explicit_shocks;

  return Array.isArray(rejected) ? rejected : [];
}
function extractPercentNumbers(text: string) {
  const matches = String(text || "").matchAll(/(\d+(?:\.\d+)?)\s*%/g);

  return [...matches]
    .map((match) => Number(match[1]))
    .filter((value) => Number.isFinite(value) && value > 0);
}

function textLooksCumulativeOrBaseline(text: string) {
  const normalized = String(text || "").toLowerCase();

  return [
    "since the start",
    "since start",
    "since the beginning",
    "since beginning",
    "since the war",
    "since war",
    "since the iran war",
    "since iran war",
    "since the pandemic",
    "since pandemic",
    "year to date",
    "ytd",
    "over the past",
    "over the last",
    "from last year",
    "versus last year",
    "compared with last year",
    "since 2024",
    "since 2025",
  ].some((term) => normalized.includes(term));
}

function extractRejectedCumulativePercentsFromEvidence(risk: Risk) {
  const evidence = Array.isArray(risk.evidence_items)
    ? risk.evidence_items
    : [];

  const values: number[] = [];

  for (const item of evidence as any[]) {
    const text = [
      item.title,
      item.source,
      item.why_it_matters,
      item.impact_type,
    ]
      .filter(Boolean)
      .join(" ");

    if (!textLooksCumulativeOrBaseline(text)) continue;

    values.push(...extractPercentNumbers(text));
  }

  return [...new Set(values)].sort((a, b) => b - a);
}

function formatRejectedShockValuesForRisk(risk: Risk) {
  const stored = formatRejectedShockValues(risk.methodology);

  if (stored) return stored;

  const inferred = extractRejectedCumulativePercentsFromEvidence(risk);

  if (inferred.length === 0) return "";

  const formatted = inferred.map((value) => `${value.toFixed(1)}%`);

  if (formatted.length <= 3) return formatted.join(", ");

  return `${formatted.slice(0, 3).join(", ")} +${formatted.length - 3} more`;
}
function formatRejectedShockValues(methodology?: Methodology | null) {
  const rejected = getRejectedExplicitShocks(methodology);

  const values = [
    ...new Set(
      rejected
        .map((shock: any) => Number(shock?.value_pct))
        .filter((value) => Number.isFinite(value) && value > 0)
        .map((value) => `${value.toFixed(1)}%`)
    ),
  ];

  if (values.length === 0) return "";

  if (values.length <= 3) return values.join(", ");

  return `${values.slice(0, 3).join(", ")} +${values.length - 3} more`;
}

function ModelStatusBadge({
  methodology,
  risk,
}: {
  methodology?: Methodology | null;
  risk?: Risk | { numeric_basis_type?: string } | null;
}) {
  // Prefer numeric_basis_type over stale methodology.shock_source (FIX 3).
  const btype = (risk as any)?.numeric_basis_type ?? "no_numeric_basis";
  if (btype === "article_numeric_claim") {
    return <span className="model-status model-status-article">Article-claimed metric</span>;
  }
  if (btype === "official_structured_metric" || btype === "manual_structured_metric") {
    return <span className="model-status model-status-evidence">Verified external metric</span>;
  }
  const status = getIssueModelStatus(methodology);
  return <span className={status.className}>{status.label}</span>;
}

function getMethodologyShock(methodology: any) {
  const inputs = getMethodologyCalculationInputs(methodology);

  const low =
    methodology?.risk_rate_low ??
    inputs.external_shock_low ??
    inputs.freight_rate_shock_low ??
    inputs.shock_low ??
    inputs.low;

  const mid =
    inputs.external_shock_mid ??
    inputs.freight_rate_shock_mid ??
    inputs.shock_mid ??
    inputs.mid;

  const high =
    methodology?.risk_rate_high ??
    inputs.external_shock_high ??
    inputs.freight_rate_shock_high ??
    inputs.shock_high ??
    inputs.high;

  const source = String(
    inputs.shock_source || methodology?.shock_source || "Not stored"
  );

  const label = String(
    inputs.shock_label || methodology?.shock_label || "Operating shock"
  );

  const basis = String(
    inputs.shock_basis ||
      methodology?.shock_basis ||
      "No short source basis stored."
  );

  const auditBasis = String(
    inputs.shock_audit_basis || methodology?.shock_audit_basis || ""
  );

  const isExplicit = source === "explicit_new_source_number";
  const isScenario = source.includes("scenario_fallback");

  const representative = Number(high || mid || low || 0);

  const displayValue =
    isExplicit && representative > 0
      ? `~${formatPercentDecimal(representative, 1)}`
      : isScenario
      ? `Low ${formatScenarioPercent(low)} · Mid ${formatScenarioPercent(
          mid || (Number(low || 0) + Number(high || 0)) / 2
        )} · High ${formatScenarioPercent(high)}`
      : representative > 0
      ? `~${formatPercentDecimal(representative, 1)}`
      : "No explicit %";

  return {
  low,
  mid,
  high,
  source,
  label,
  basis,
  auditBasis,
  isExplicit,
  isScenario,
  displayValue,
  displayRange: displayValue,
};
}

function getReliefDisplay(risk: Risk) {
  const inputs = getMethodologyCalculationInputs(risk.methodology || {});
  const relief = Number(inputs.modeled_relief || 0);

  if (!Number.isFinite(relief) || relief <= 0) {
    return null;
  }

  return formatMoney(relief);
}

function getResidualExposureDisplay(risk: Risk) {
  if (
    risk.methodology?.calibration_status === "needs_calibration" ||
    risk.methodology?.formula_status === "not_calculated"
  ) {
    return "Needs calibration";
  }

  const low = Number(risk.impact_low || 0);
  const high = Number(risk.impact_high || 0);

  if (low === high) {
    return formatMoney(high);
  }

  return `${formatMoney(low)}–${formatMoney(high)}`;
}
function friendlyMissingInput(input: string) {
  const text = String(input || "").toLowerCase();

  if (text.includes("company_commodity_exposure rows")) {
    return "commodity exposure row";
  }

  if (text.includes("annual_spend")) {
    return "annual commodity spend";
  }

  if (text.includes("import_exposure_pct")) {
    return "import exposure percent";
  }

  if (text.includes("pass_through_pct")) {
    return "pass-through percent";
  }

  if (text.includes("repricing_lag_days")) {
    return "repricing lag";
  }

  if (text.includes("company_logistics_exposure")) {
    return "logistics exposure row";
  }

  if (text.includes("annual_freight_spend")) {
    return "annual freight spend";
  }

  if (text.includes("spot_rate_exposure_pct")) {
    return "spot-rate exposure percent";
  }

  if (text.includes("company_segment_exposure")) {
    return "customer segment exposure row";
  }

  if (text.includes("annual_revenue")) {
    return "segment revenue";
  }

  if (text.includes("gross_margin_pct")) {
    return "gross margin percent";
  }

  return input;
}

// ---------------------------------------------------------------------------
// Action ROI derivation — populates workflow fields from linked risk/opportunity
// ---------------------------------------------------------------------------

type DerivedActionFields = {
  owner: string | null;
  deadline: string | null;
  effortLevel: string;
  successCondition: string;
  nextStep: string;
  decisionTrigger: string;
};

function deriveActionRoiFields(
  action: ActionItem,
  linkedRisk: Risk | null,
  linkedOpp: Opportunity | null
): DerivedActionFields {
  if (!linkedRisk && !linkedOpp) {
    return {
      owner: null,
      deadline: null,
      effortLevel: "Medium",
      successCondition: "Action completed and outcome documented.",
      nextStep: "Review with relevant owner and confirm next steps.",
      decisionTrigger: "Escalate if no owner assigned within one review cycle.",
    };
  }

  const category = String((linkedRisk as any)?.issue_category || "").toLowerCase();
  const title = String(linkedRisk?.risk_title || linkedOpp?.title || "").toLowerCase();

  // Freight-specific action
  if (category.includes("freight") || title.includes("freight") || title.includes("container")) {
    return {
      owner: action.owner || "Head of Logistics",
      deadline: action.deadline || "2026-06-22",
      effortLevel: "Medium",
      successCondition: "Top inbound lanes classified by contract coverage, surcharge exposure, and mitigation option.",
      nextStep: "Identify top inbound lanes with spot or surcharge exposure and compare current contract coverage.",
      decisionTrigger: "Escalate if spot exposure exceeds 20% or new surcharges hit top-volume lanes.",
    };
  }

  // Fuel / diesel (favorable fuel-surcharge relief operating change). Escalation
  // must be a real condition — not a repeat of the action itself.
  if (title.includes("diesel") || title.includes("fuel-surcharge") || title.includes("fuel surcharge")) {
    return {
      owner: action.owner || "Head of Logistics",
      deadline: action.deadline || null,
      effortLevel: "Low",
      successCondition: "Carrier fuel-surcharge tables reviewed; diesel relief captured on fuel-sensitive/spot lanes this billing cycle.",
      nextStep: "Review carrier fuel-surcharge tables and fuel clauses on fuel-sensitive lanes; capture relief before carriers reset surcharges.",
      decisionTrigger: "Escalate if carriers do not reflect diesel relief in fuel-surcharge tables during the current billing cycle.",
    };
  }

  // Tariff / trade policy
  if (category.includes("tariff") || category.includes("trade") || title.includes("tariff")) {
    return {
      owner: action.owner || "Head of Procurement",
      deadline: action.deadline || null,
      effortLevel: "Medium",
      successCondition: "Supplier country-of-origin confirmed, import-category exposure sized, landed-cost assumptions updated.",
      nextStep: "Pull supplier country-of-origin list and validate steel-linked import exposure; flag aluminum/copper separately if additional tariff metrics or supplier evidence are available.",
      decisionTrigger: "Escalate if exposed imports exceed $10M or suppliers have not confirmed updated landed costs.",
    };
  }

  // Commodity / metals
  if (category.includes("commodity") || category.includes("steel") || category.includes("copper") ||
      title.includes("steel") || title.includes("copper") || title.includes("aluminum")) {
    return {
      owner: action.owner || "Head of Procurement",
      deadline: action.deadline || null,
      effortLevel: "Medium",
      successCondition: "Supplier-level price updates and unpassed exposure validated by SKU against the index move.",
      nextStep: "Review commodity spend by supplier, confirm supplier price updates vs the PPI move, and check open-PO repricing windows.",
      decisionTrigger: "Escalate if supplier price updates exceed the index move, unpassed exposure exceeds the materiality threshold, or open PO repricing occurs within 30 days.",
    };
  }

  // Opportunity / demand
  if (linkedOpp || category.includes("demand") || category.includes("manufacturing")) {
    return {
      owner: action.owner || "Head of Sales",
      deadline: action.deadline || null,
      effortLevel: "Low",
      successCondition: "CRM pipeline confirms quote growth or order strength in manufacturing accounts.",
      nextStep: "Pull CRM data for manufacturing account segment — quote volume trend and win rate last 90 days.",
      decisionTrigger: "Escalate if CRM confirms quote growth >10% or order strength in target accounts.",
    };
  }

  // Generic fallback
  const hasExposure = (linkedRisk?.impact_low ?? 0) > 0;
  return {
    owner: action.owner || linkedRisk?.owner || null,
    deadline: action.deadline || null,
    effortLevel: "Medium",
    successCondition: hasExposure
      ? "Exposure validated and mitigation option identified."
      : "Issue reviewed and owner confirmed.",
    nextStep: linkedRisk?.action_required
      ? clampToWord(String(linkedRisk.action_required), 180)
      : "Review with relevant owner and confirm next steps.",
    decisionTrigger: getDecisionTrigger(linkedRisk ?? linkedOpp as any),
  };
}

// Buyer-visible narrative should not use vague "verified" wording — official
// producer-price metrics come from BLS (and diesel from EIA). Display-only; the
// stored issue text is unchanged.
function officializeText(s?: string | null): string {
  if (!s) return s ?? "";
  return String(s)
    .replace(/\bA verified\b/g, "An official")
    .replace(/\bverified (diesel|fuel)\b/gi, "official EIA $1")
    .replace(/\bverified (freight|steel|copper|aluminum|fabricated|metal)\b/gi, "official BLS $1")
    .replace(/\bverified external (metric|number|shock)\b/gi, "official $1")
    .replace(/\bverified producer-price\b/gi, "official BLS producer-price")
    .replace(/\bverified\b/gi, "official");
}

// Concise per-input provenance shown directly under a formula (DB-backed, no need
// to open the audit tab). e.g. "steel spend — demo seed; unpassed % — inferred assumption".
function inlineProvenanceText(issue: any): string {
  const prov = Array.isArray(issue?.formula_provenance) ? issue.formula_provenance : [];
  if (prov.length === 0) return "";
  const map: Record<string, string> = { uploaded_csv: "uploaded CSV", demo_seed: "demo seed", calibration_table: "calibration table", inferred_assumption: "inferred assumption", manual: "manual" };
  return prov.map((p: any) => `${p.input_label || p.input_name} — ${map[p.source_type] || p.source_type}`).join("; ");
}

// Truncate on a word boundary (never mid-word) so action copy doesn't end like "befor".
function clampToWord(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max).replace(/\s+\S*$/, "").replace(/[.,;:]$/, "") + "…";
}

function formatMoney(value: number | null | undefined) {
  const number = Number(value || 0);

  if (number >= 1_000_000_000) {
    return `$${(number / 1_000_000_000).toFixed(1)}B`;
  }

  if (number >= 1_000_000) {
    return `$${(number / 1_000_000).toFixed(1)}M`;
  }

  if (number >= 1_000) {
    return `$${(number / 1_000).toFixed(0)}K`;
  }

  return `$${number.toFixed(0)}`;
}
function cleanImpactCategoryLabel(
  category: string | null | undefined,
  triggerName?: string | null
) {
  const categoryText = String(category || "").toLowerCase();
  const triggerText = String(triggerName || "").toLowerCase();

  if (
    triggerText.includes("freight") ||
    triggerText.includes("shipping") ||
    triggerText.includes("logistics") ||
    categoryText.includes("freight") ||
    categoryText.includes("logistics")
  ) {
    if (categoryText.includes("spot") || categoryText.includes("rate")) {
      return "Freight Spot-Rate Sensitivity";
    }

    return "Freight Cost Sensitivity";
  }

  if (categoryText === "commodity_pass_through_sensitivity") {
    return "Commodity Pass-Through Sensitivity";
  }

  if (categoryText === "competitor_revenue_risk") {
    return "Competitor Revenue Risk";
  }

  if (categoryText === "service_level_revenue_leakage") {
    return "Service-Level Revenue Leakage";
  }

  if (categoryText === "supplier_expedite_cost") {
    return "Supplier Expedite Cost";
  }

  return cleanLabel(category || "impact path");
}

function classifyPathGroup(
  category: string,
  triggerName: string,
  triggerType?: string
): "cost" | "supplier" | "customer" | "competitor" | "service" | "opportunity" | "other" {
  const cat = String(category || "").toLowerCase();
  const trigger = String(triggerName || "").toLowerCase();
  const ttype = String(triggerType || "").toLowerCase();

  if (
    cat.includes("commodity") || cat.includes("tariff") || cat.includes("freight") ||
    cat.includes("logistics") || cat.includes("input_cost") || cat.includes("cost_pressure") ||
    cat.includes("expedite") || trigger.includes("freight") || trigger.includes("steel") ||
    trigger.includes("copper") || trigger.includes("aluminum") || trigger.includes("tariff") ||
    trigger.includes("shipping") || trigger.includes("ocean")
  ) return "cost";

  if (
    cat.includes("supplier") || cat.includes("procurement") || cat.includes("supply_chain") ||
    ttype === "supplier" || trigger.includes("supplier") || trigger.includes("vendor")
  ) return "supplier";

  if (
    cat.includes("competitor") || cat.includes("market_share") || cat.includes("share_shift") ||
    ttype === "competitor" || trigger.includes("grainger") || trigger.includes("msc") ||
    trigger.includes("fastenal competitor")
  ) return "competitor";

  if (
    cat.includes("service_level") || cat.includes("fill_rate") || cat.includes("backorder") ||
    cat.includes("fulfillment") || cat.includes("service_leakage")
  ) return "service";

  if (
    cat.includes("opportunity") || cat.includes("revenue_upside") || cat.includes("demand_capture") ||
    ttype === "opportunity"
  ) return "opportunity";

  if (
    cat.includes("customer") || cat.includes("revenue") || cat.includes("segment") ||
    ttype === "customer_segment" || ttype === "customer"
  ) return "customer";

  return "other";
}

function buildPrimaryPathText(
  issue: Risk | Opportunity,
  matchedConnections: MatchedConnectionPath[]
): string | null {
  // 1. Use exposure_path array if available and meaningful
  const ep = Array.isArray(issue.exposure_path) ? issue.exposure_path : [];
  if (ep.length >= 3) {
    return ep.join(" → ");
  }

  // 2. Use first matched connection
  if (matchedConnections.length > 0) {
    const conn = matchedConnections[0];
    const nodes = Array.isArray(conn.path_nodes) && conn.path_nodes.length >= 3
      ? conn.path_nodes.join(" → ")
      : null;
    if (nodes) return nodes;

    const trigger = conn.trigger_name || "";
    const affected = conn.affected_name || "";
    const cat = cleanImpactCategoryLabel(conn.impact_category, conn.trigger_name);
    if (trigger && affected) {
      return `${trigger} → ${cat} → ${affected}`;
    }
  }

  // 3. Construct from issue fields
  const r = issue as Risk;
  const issueCat = String(r.issue_category || "").replace(/_/g, " ");
  const affected = [
    ...(r.affected_commodities || []),
    ...(r.affected_suppliers || []),
    ...(r.affected_customers || []),
  ].slice(0, 2).join(", ");
  const o = issue as Opportunity;
  const segments = [...(o.affected_segments || []), ...(o.affected_customers || [])].slice(0, 2).join(", ");

  if (issueCat && (affected || segments)) {
    return `${issueCat} → ${affected || segments}`;
  }

  return null;
}

function formatIssueDirection(value: string | null | undefined) {
  const text = String(value || "").toLowerCase().trim();

  if (text === "favorable_with_residual_exposure") {
    return "Tariff relief · validation pending";
  }

  if (text === "mixed_or_uncertain") {
    return "Mixed / uncertain";
  }

  if (text === "downside") {
    return "Downside";
  }

  if (text === "favorable") {
    return "Favorable";
  }

  if (text === "uncertain") {
    return "Uncertain";
  }

  if (!text) {
    return "Mixed";
  }

  return cleanLabel(text);
}

function cleanLabel(value: string | null | undefined) {
  return String(value || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}



function getMetadata(value: unknown) {
  if (!value) return {};

  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return {};
    }
  }

  if (typeof value === "object") return value as Record<string, any>;

  return {};
}

function explainDashboardMetric(type: string, options: Record<string, any>) {
  if (type === "executive_issues") {
    return {
      title: "Executive Issues",
      formula: "risk_register count + opportunity_register count",
      inputs: [
  `${options.riskCount || 0} downside risks`,
  `${options.operatingChangeCount || 0} operating changes`,
  `${options.watchlistCount || 0} watchlist items`,
  `${options.opportunityCount || 0} opportunities`,
],
      source: "Loaded directly from Supabase after Generate Risks and Generate Opportunities.",
      caveat:
        "This is a count of generated executive items, not a count of all raw articles.",
    };
  }

  if (type === "risk_exposure") {
  return {
    title: "Exposure Summary",
    formula:
      "Downside = official metric-backed published risks. Favorable = official metric-backed favorable operating changes. Reported separately — never combined.",
    inputs: [
      {
        label: "Downside exposure (official metric-backed)",
        value: `${formatMoney(options.downside || 0)} across ${options.downsideCount || 0} risks`,
      },
      {
        label: "Favorable operating changes",
        value: `${formatMoney(options.favorable || 0)} across ${options.favorableCount || 0} changes`,
      },
      {
        label: "Watchlist (no dollar estimate)",
        value: `${options.watchCount || 0} items`,
      },
      {
        label: "Scenario exposure",
        value: "$0 (no scenario-backed published issues)",
      },
      {
        label: "Basis",
        value: `${options.metricBackedCount || 0} official metric-backed · ${options.articleBackedCount || 0} article-claim-backed`,
      },
    ],
    source:
      "risk_register.gate_status + numeric_basis_type + numeric_shocks + source_observations + formula_inputs (one truth system).",
    note:
      "Downside risk and favorable relief are reported separately. No scenario-backed or article-shock dollars are published.",
  };
}

  if (type === "opportunity_upside") {
    return {
      title: "Opportunity Upside",
      formula:
        "sum(opportunity_register.revenue_low) – sum(opportunity_register.revenue_high)",
      inputs: [
        `Low total: ${formatMoney(options.low)}`,
        `High total: ${formatMoney(options.high)}`,
        `${options.count || 0} opportunities included`,
      ],
      source:
        "opportunity_register revenue_low and revenue_high fields generated by the opportunity model.",
      caveat:
        "This is modeled commercial upside, not booked revenue.",
    };
  }

  if (type === "connection_graph") {
    return {
      title: "Connection Graph",
      formula: "company_connections count + impact_paths count",
      inputs: [
        `${options.connections || 0} relationship edges`,
        `${options.paths || 0} modeled impact paths`,
      ],
      source:
        "Generated by build-company-connections from company entities, exposure tables, and modeled operating logic.",
      caveat:
        "The graph is a reasoning layer. The brief should use it, not dump it raw.",
    };
  }

  if (type === "supporting_signals") {
    return {
      title: "Supporting Signals",
      formula: "event_assessments where relevant = true",
      inputs: [
        `${options.relevant || 0} relevant assessments`,
        `${options.events || 0} raw events loaded`,
      ],
      source: "raw_events and event_assessments tables.",
      caveat:
        "Relevant signals are determined by the scoring step.",
    };
  }

  if (type === "open_actions") {
    return {
      title: "Open Actions",
      formula: "risk_actions where status != completed",
      inputs: [
        `${options.open || 0} open actions`,
        `${options.total || 0} total actions`,
      ],
      source: "risk_actions table.",
      caveat:
        "Dismissed and completed items should not be treated as active work.",
    };
  }

  return null;
}

function explainRiskPriority(risk: Risk): NumberExplanation {
  const score = risk.priority_score || 0;
  const exposure = Number(risk.impact_high || 0);
  const status = getIssueModelStatus(risk.methodology);

  // Build labeled priority drivers
  const drivers: ExplanationInput[] = [
    { label: "Financial magnitude", value: exposure > 0 ? formatMoney(exposure) + " high-end exposure" : "Not calibrated" },
    { label: "Scenario confidence", value: `${clampPercent(risk.probability)}%` },
    { label: "Evidence confidence", value: `${clampPercent(risk.confidence)}% (${formatConfidenceLabel(risk.confidence)})` },
    { label: "Evidence signals", value: String(risk.supporting_event_count || 0) },
    { label: "Model basis", value: status.label },
    { label: "Estimate quality", value: formatEstimateQuality(risk.methodology) },
    { label: "Severity rating", value: risk.severity || "Not set" },
  ];

  const urgencyNote = score >= 70
    ? "High-priority item — warrants near-term executive action."
    : score >= 40
    ? "Medium-priority — monitor and assign owner."
    : "Lower-priority — review quarterly.";

  return {
    title: "Priority drivers",
    formula: "Priority combines exposure magnitude, probability, confidence, evidence quality, and calibration status",
    inputs: drivers,
    source: "Generated by Generate Risks from event assessments and company calibration inputs.",
    caveat: urgencyNote,
  };
}
// Strip min–max dollar ranges + scenario/range wording from generated narrative in
// executive mode, and replace the legacy "did not find a clean rate … scenario-modeled"
// freight clause with clean executive copy.
function stripExecRanges(text: string): string {
  if (!text) return text;
  let t = text
    // Remove the legacy freight "did not find a clean … rate, so the $X–$Y range is scenario-modeled" sentence.
    .replace(/GroundSense did not find a clean[^.]*\./gi, "Public logistics data supports current price pressure, while lane-specific freight-rate validation remains pending.")
    // Generic range → estimate.
    .replace(/\$[\d.,]+\s*[KMB]?\s*[–-]\s*\$[\d.,]+\s*[KMB]?(\s+(scenario\s+)?range)?/gi, "a source-backed estimate")
    .replace(/\bscenario downside range\b/gi, "operating downside")
    .replace(/\bmodeled range\b/gi, "source-backed estimate")
    // Drop any leftover sentence that still asserts scenario-modeled.
    .replace(/[^.]*\bis scenario-modeled\b[^.]*\.?/gi, "")
    .replace(/\bscenario-modeled\b/gi, "source-backed")
    .replace(/\bthe a source-backed estimate\b/gi, "a source-backed estimate")
    .replace(/\s{2,}/g, " ")
    .trim();
  return t;
}

function getRiskExposureDisplay(risk: Risk) {
  if (
    risk.methodology?.calibration_status === "needs_calibration" ||
    risk.methodology?.formula_status === "not_calculated"
  ) {
    return "Needs calibration";
  }

  const low = Number(risk.impact_low || 0);
  const high = Number(risk.impact_high || 0);

  if (low === high) {
    return `${formatMoney(high)} point estimate`;
  }

  return `${formatMoney(low)}–${formatMoney(high)}`;
}
function explainRiskExposure(risk: Risk): NumberExplanation {
  const methodology = risk.methodology || {};
  const inputs = getMethodologyCalculationInputs(methodology);
  const shock = getMethodologyShock(methodology);
  const status = getIssueModelStatus(methodology);

  if (
    methodology.calibration_status === "needs_calibration" ||
    methodology.formula_status === "not_calculated"
  ) {
    return {
      title: "Exposure model",
      formula:
        "No dollar exposure calculated because required company inputs are missing.",
      inputs: Array.isArray(methodology.missing_inputs)
        ? methodology.missing_inputs.map((input) => ({
            label: "Missing input",
            value: friendlyMissingInput(input),
          }))
        : [
            {
              label: "Missing input",
              value: "Not stored",
            },
          ],
      note:
        "GroundSense does not invent dollar exposure when calibrated company inputs are missing.",
    };
  }

  // ── Basis-aware methodology (numeric_shock ledger) ────────────────────────
  // Official/manual/company metric and article-claim issues render their REAL
  // basis from first-class columns — NEVER the legacy "base exposure / article
  // shock percent / verified article text" fields.
  const nbTypeX = String((risk as any).numeric_basis_type ?? "no_numeric_basis");
  const METRIC_TYPES = ["official_structured_metric", "manual_structured_metric", "company_structured_metric"];
  if (METRIC_TYPES.includes(nbTypeX) || nbTypeX === "article_numeric_claim") {
    const official = METRIC_TYPES.includes(nbTypeX);
    const fi = ((risk as any).formula_inputs ?? {}) as Record<string, unknown>;
    const srcLabel = (risk as any).numeric_basis_source_label ?? "source";
    const nbVal = (risk as any).numeric_basis_value;
    const nbUnit = ((risk as any).numeric_basis_unit === "pct" ? "%" : (risk as any).numeric_basis_unit) ?? "";
    const prettyKey = (k: string) => k.replace(/_/g, " ").replace(/\bpct\b/g, "%").replace(/^\w/, (c) => c.toUpperCase());
    const fmtInput = (k: string, v: unknown): string => {
      const n = Number(v);
      if (/spend|freight|result|exposed/.test(k) && Number.isFinite(n)) return formatMoney(n);
      if (/share/.test(k) && Number.isFinite(n)) return `${Math.round(n * 100)}%`;
      if (/pct|percent_change|change/.test(k) && Number.isFinite(n)) return `${n > 0 ? "+" : ""}${n}%`;
      return v == null ? "—" : String(v);
    };
    const mInputs: ExplanationInput[] = Object.entries(fi)
      .filter(([k]) => k !== "source_shock_id" && k !== "result")
      .map(([k, v]) => ({ label: prettyKey(k), value: fmtInput(k, v) }));
    mInputs.push({ label: "Metric", value: srcLabel });
    if (nbVal != null) mInputs.push({ label: "Change", value: `${nbVal > 0 ? "+" : ""}${nbVal}${nbUnit}` });
    if ((risk as any).business_estimate != null) mInputs.push({ label: "Formula result", value: formatMoney(Number((risk as any).business_estimate)) });
    return {
      title: official ? "Official metric exposure model" : "Article-claimed exposure model",
      formula: (risk as any).formula || methodology.formula || "",
      inputs: mInputs,
      inputsProvenance: inputProvenanceLabel(risk),
      source: `${official ? "Official metric" : "Article-claimed metric"} · ${srcLabel}${(risk as any).numeric_basis_snippet ? ` — ${String((risk as any).numeric_basis_snippet).slice(0, 140)}` : ""}`,
      note: risk.exposure_interpretation || "Validate against current supplier/lane pricing before relying on this figure.",
    };
  }

  const formula =
    methodology.formula ||
    "Exposure = base exposure × shock percent × exposure adjustment";

  const cleanFormula = formula
    .replace(/_/g, " ")
    .replace(/%/g, "percent");

  const baseExposure = Number(methodology.base_exposure_value || 0);

  const passThroughPct = Number(inputs.pass_through_pct || 0);
  const unpassedCostPct = Number(inputs.unpassed_cost_pct || 0);
  const repricingLagDays = Number(inputs.repricing_lag_days || 0);
  const lagFactor = Number(inputs.repricing_lag_factor || 0);

  const valueInputs: ExplanationInput[] = [
    {
      label: "Base exposure",
      value: formatMoney(baseExposure),
    },
  ];

  if (status.status === "evidence_backed") {
    valueInputs.push({
      label: "Article shock percent",
      value: shock.displayValue,
    });
  } else if (status.status === "scenario_fallback") {
    valueInputs.push({
      label: "Assumed shock percent",
      value: shock.displayValue,
    });
  } else {
    valueInputs.push({
      label: "Shock percent",
      value: shock.displayValue,
    });
  }

  if (passThroughPct > 0) {
    valueInputs.push({
      label: "Pass-through percent",
      value: formatPercentDecimal(passThroughPct),
    });
  }

  if (unpassedCostPct > 0) {
    valueInputs.push({
      label: "Unpassed cost percent",
      value: formatPercentDecimal(unpassedCostPct),
    });
  }

  if (lagFactor > 0) {
    valueInputs.push({
      label: "Repricing lag factor",
      value: lagFactor.toFixed(2),
    });
  }

  if (repricingLagDays > 0) {
    valueInputs.push({
      label: "Repricing lag",
      value: `${repricingLagDays.toFixed(0)} days`,
    });
  }

  const relief = getReliefDisplay(risk);

  if (relief) {
    valueInputs.push({
      label: "Relief versus prior state",
      value: relief,
    });
  }

  let sourceSentence = "";

  if (status.status === "evidence_backed") {
    sourceSentence = `${shock.displayValue} came from verified article text.`;
  } else if (status.status === "scenario_fallback") {
    const rejectedValues = formatRejectedShockValuesForRisk(risk);

    sourceSentence = rejectedValues
      ? `Found ${rejectedValues} in evidence, but rejected it as cumulative, stale, baseline, or not clearly incremental. Scenario assumptions were used instead.`
      : "No new explicit percentage was found. Scenario assumptions were used instead.";
  } else {
    sourceSentence =
      "GroundSense could not determine whether the shock percent was evidence-backed or scenario-based.";
  }

  return {
    title:
      risk.display_section === "operating_changes"
        ? "Residual exposure model"
        : risk.display_section === "watchlist"
        ? "Scenario sensitivity"
        : status.status === "scenario_fallback"
        ? "Scenario exposure model"
        : "Risk exposure model",
    formula: cleanFormula,
    inputs: valueInputs,
    inputsProvenance: inputProvenanceLabel(risk),
    source: sourceSentence,
    note:
      risk.exposure_interpretation ||
      methodology.honesty_note ||
      "Dollar exposure is calculated from calibrated company inputs.",
  };
}

function explainOpportunityPriority(opportunity: Opportunity): NumberExplanation {
  return {
    title: "Opportunity priority",
    formula:
      "opportunity priority combines revenue range, probability, confidence, evidence count, and source quality",
    inputs: [
      `Stored priority_score: ${opportunity.priority_score || 0}/100`,
      `Probability: ${clampPercent(opportunity.probability)}%`,
      `Confidence: ${clampPercent(opportunity.confidence)}% (${formatConfidenceLabel(opportunity.confidence)})`,
      `Supporting events: ${opportunity.supporting_event_count || 0}`,
    ],
    source:
      "opportunity_register.priority_score generated by Generate Opportunities.",
    caveat:
      "This is a ranking number used to order commercial attention.",
  };
}

function explainOpportunityExposure(opportunity: Opportunity): NumberExplanation {
  const methodology = opportunity.methodology || {};

  return {
    title: "Opportunity upside range",
    formula:
      methodology.formula ||
      "base exposure × conversion rate × evidence multiplier × quality multiplier",
    inputs: [
      `Low: ${formatMoney(opportunity.revenue_low)}`,
      `High: ${formatMoney(opportunity.revenue_high)}`,
      `Base exposure type: ${methodology.base_exposure_type || "Not stored"}`,
      `Base exposure value: ${formatMoney(methodology.base_exposure_value)}`,
      `Conversion low: ${methodology.conversion_rate_low ?? "Not stored"}`,
      `Conversion high: ${methodology.conversion_rate_high ?? "Not stored"}`,
      `Evidence multiplier: ${methodology.evidence_multiplier ?? "Not stored"}`,
      `Quality multiplier: ${methodology.quality_multiplier ?? "Not stored"}`,
    ],
    source:
      "opportunity_register revenue fields and methodology JSON produced by Generate Opportunities.",
    caveat:
      "This is modeled upside potential, not committed revenue.",
  };
}
function normalizeIdArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim()).filter(Boolean);
  }

  if (typeof value === "string") {
    const trimmed = value.trim();

    if (!trimmed) return [];

    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      return trimmed
        .slice(1, -1)
        .split(",")
        .map((item) => item.replace(/^"|"$/g, "").trim())
        .filter(Boolean);
    }

    return trimmed
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

async function loadMatchedConnectionsByItemId(
  companyId: string,
  items: Array<{
    id: string;
    supporting_connection_ids?: string[] | string | null;
  }>
) {
  const allConnectionIds = uniqueStrings(
    items.flatMap((item) => normalizeIdArray(item.supporting_connection_ids))
  );

  if (allConnectionIds.length === 0) {
    return {};
  }

  const { data, error } = await supabase
    .from("impact_paths")
    .select(
      "id, trigger_name, affected_name, impact_category, path_nodes, impact_weight, priority_score"
    )
    .eq("company_id", companyId)
    .in("id", allConnectionIds);

  if (error) {
    console.log("Failed to load matched connection paths", error);
    return {};
  }

  const pathById = new Map<string, MatchedConnectionPath>();

  for (const path of (data || []) as MatchedConnectionPath[]) {
    pathById.set(path.id, path);
  }

  const result: Record<string, MatchedConnectionPath[]> = {};

  for (const item of items) {
    const ids = normalizeIdArray(item.supporting_connection_ids);

    result[item.id] = ids
      .map((id) => pathById.get(id))
      .filter((path): path is MatchedConnectionPath => Boolean(path));
  }

  return result;
}

// ── Trust layer helpers ───────────────────────────────────────────────────────

type EvidenceTierInfo = {
  label: string;
  className: string;
  rank: number;
};

function classifyEvidenceSource(item: any): EvidenceTierInfo {
  const source = String(item.source || item.source_name || "").toLowerCase();
  const tier = String(item.source_tier || "").toLowerCase();
  const quality = Number(item.source_quality || 0);

  // Government and official first — highest trust
  if (
    tier === "government" ||
    /\b(\.gov|whitehouse\.gov|federal reserve|the fed|u\.s\. treasury|department of|bureau of|bls|eia|u\.s\. census|white house|executive order|presidential|congress|senate|cbo)\b/.test(source)
  ) {
    return { label: "Official source", className: "ev-tier ev-tier-official", rank: 1 };
  }

  // Company filings and earnings
  if (
    /\b(earnings call|investor relations|10-k|10-q|8-k|annual report|sec filing|conference call|transcript|press release fastenal|earnings)\b/.test(source)
  ) {
    return { label: "Company filing", className: "ev-tier ev-tier-company", rank: 2 };
  }

  // Financial market data providers
  if (
    /\b(s&p global|moody'?s|fitch|bloomberg intelligence|ihs markit|refinitiv|factset|morningstar)\b/.test(source)
  ) {
    return { label: "Market data", className: "ev-tier ev-tier-market", rank: 3 };
  }

  // Wire services and major news outlets — news reports, not primary sources
  if (
    /\b(reuters|bloomberg|associated press|ap news|dow jones newswires|wsj|wall street journal|financial times|ft\.com|cnbc|barron)\b/.test(source)
  ) {
    return { label: "News report", className: "ev-tier ev-tier-news", rank: 4 };
  }

  // Industry-specific publications
  if (
    /\b(supply chain|supplychaindive|supplychainbrain|freightwaves|journal of commerce|american shipper|inbound logistics|logistics management|manufacturing|industrial distribution|modern distribution)\b/.test(source)
  ) {
    return { label: "Industry publication", className: "ev-tier ev-tier-industry", rank: 3 };
  }

  // Industry research and associations
  if (
    tier === "tier1" || tier === "tier2" ||
    quality >= 75 ||
    /\b(association|institute|council|federation|report|survey|index|research|journal|bureau)\b/.test(source)
  ) {
    return { label: "Industry report", className: "ev-tier ev-tier-industry", rank: 4 };
  }

  if (quality >= 45) {
    return { label: "News article", className: "ev-tier ev-tier-news", rank: 5 };
  }

  return { label: "Unclassified", className: "ev-tier ev-tier-low", rank: 6 };
}

function cleanShockSourceForDisplay(source: string): string {
  const s = String(source || "").toLowerCase();

  // Numeric-shock-ledger basis types (single source of truth).
  if (s.includes("official") || s.includes("structured_metric")) return "Official metric";
  if (s.includes("article")) return "Article-claimed metric";

  if (s === "explicit_new_source_number" || s === "explicit_news_number") {
    return "From verified article text";
  }

  if (s.includes("scenario_fallback")) {
    return "Scenario assumption — no clean incremental rate found in evidence";
  }

  if (s.includes("scenario")) {
    return "Scenario assumption";
  }

  if (s.includes("calibrat")) {
    return "Calibrated company input";
  }

  if (!s || s === "not stored") {
    return "Source not stored";
  }

  return cleanLabel(source);
}

function getExposureBaseSource(methodology: Methodology | null | undefined): string {
  const method: any = methodology || {};
  const calibration = getMetadata(method.calibration_inputs);

  const hasCalibration =
    calibration.annual_revenue ||
    calibration.steel_spend ||
    calibration.cogs ||
    calibration.manufacturing_revenue ||
    calibration.construction_revenue ||
    calibration.annual_freight_spend;

  if (hasCalibration) {
    return "Calibrated company input";
  }

  const baseType = String(method.base_exposure_type || "").toLowerCase();

  if (baseType.includes("benchmark") || baseType.includes("industry")) {
    return "Industry benchmark";
  }

  if (method.base_exposure_value > 0) {
    return "Inferred from company model";
  }

  return "Not stored";
}

function getWhatWouldMakeThisWrong(methodology: Methodology | null | undefined): string {
  const method: any = methodology || {};
  const status = getIssueModelStatus(methodology);
  const inputs = getMethodologyCalculationInputs(method);
  const passThroughPct = Number(inputs.pass_through_pct || 0);

  if (status.status === "evidence_backed") {
    const parts = [
      "If the source percentage was cumulative, baseline, or contextual rather than a new incremental rate, exposure would be lower.",
    ];
    if (passThroughPct > 0) {
      parts.push("Actual pass-through or hedging arrangements could reduce realized impact.");
    }
    return parts.join(" ");
  }

  if (status.status === "scenario_fallback") {
    return "The shock rate is a scenario assumption, not sourced from current article data. If actual market rates, company hedging, or pass-through differ from the scenario, the exposure estimate could be materially different.";
  }

  if (status.status === "needs_calibration") {
    return "Dollar exposure cannot be validated without calibrated company inputs. The direction is based on evidence, but the magnitude is unquantified.";
  }

  return "If key assumptions — exposure base, shock rate, or pass-through — differ significantly from modeled values, the estimate could change.";
}

// ── Trust Audit Panel ─────────────────────────────────────────────────────────

function TrustAuditPanel({
  methodology,
  evidence,
  sectionType,
  issue,
}: {
  methodology?: Methodology | null;
  evidence?: any[];
  sectionType?: "risk_register" | "operating_changes" | "watchlist" | "opportunity";
  issue?: any;
}) {
  const method: any = methodology || {};
  const status = getIssueModelStatus(methodology);
  const shock = getMethodologyShock(method);

  const baseExposure = Number(method.base_exposure_value || 0);
  const baseType = String(method.base_exposure_type || "").replace(/_/g, " ");
  const baseSource = getExposureBaseSource(methodology);

  const missingInputs: string[] = Array.isArray(method.missing_inputs)
    ? method.missing_inputs.map(friendlyMissingInput)
    : [];

  const signalCount = Number(
    method.supporting_signal_count ||
      (Array.isArray(evidence) ? evidence.length : 0)
  );
  const avgQuality = Number(method.average_source_quality || 0);

  const storedRejected = formatRejectedShockValues(methodology);
  const inferredRejected =
    !storedRejected && Array.isArray(evidence)
      ? (() => {
          const values: number[] = [];
          for (const item of evidence as any[]) {
            const text = [
              item.title,
              item.source,
              item.why_it_matters,
              item.impact_type,
            ]
              .filter(Boolean)
              .join(" ");
            if (textLooksCumulativeOrBaseline(text)) {
              values.push(...extractPercentNumbers(text));
            }
          }
          const unique = [...new Set(values)].sort((a, b) => b - a);
          if (unique.length === 0) return "";
          const formatted = unique.map((v) => `${v.toFixed(1)}%`);
          if (formatted.length <= 3) return formatted.join(", ");
          return `${formatted.slice(0, 3).join(", ")} +${formatted.length - 3} more`;
        })()
      : "";

  const rejectedValues = storedRejected || inferredRejected;
  const rejectedNote = storedRejected
    ? "Rejected as cumulative, baseline, stale, or not clearly incremental"
    : inferredRejected
    ? "Inferred from evidence text — may be cumulative or contextual"
    : "";

  const wrongSentence = getWhatWouldMakeThisWrong(methodology);
  const rawFormula = String(method.formula || "");
  const honesty = String(method.honesty_note || "");

  // ── Display formula with an unambiguous sign for favorable diesel relief (shared helper) ──
  const formula = formatFormulaForDisplay(rawFormula);

  // ── Per-input provenance (task 1) ──
  const fi = (issue?.formula_inputs && typeof issue.formula_inputs === "object") ? (issue.formula_inputs as Record<string, unknown>) : {};
  const demoCal = isDemoMode();
  const spendProv = demoCal ? "demo supplier spend" : "uploaded supplier spend";
  const calProv = demoCal ? "demo calibration" : "calibration table";
  const fl = formula.toLowerCase();
  const formulaInputRows: { label: string; prov: string }[] = [];
  if (/freight spend/.test(fl)) formulaInputRows.push({ label: "freight spend", prov: calProv });
  if (/spot/.test(fl)) formulaInputRows.push({ label: "spot %", prov: calProv });
  if (/steel spend/.test(fl)) formulaInputRows.push({ label: "steel spend", prov: spendProv });
  if (/copper spend/.test(fl)) formulaInputRows.push({ label: "copper spend", prov: spendProv });
  if (/aluminum spend/.test(fl)) formulaInputRows.push({ label: "aluminum spend", prov: spendProv });
  if (/unpassed/.test(fl)) formulaInputRows.push({ label: "unpassed %", prov: "inferred assumption" });
  if (/fuel-exposed freight/.test(fl)) formulaInputRows.push({ label: "fuel-exposed freight", prov: demoCal ? "demo calibration assumption" : "calibration table" });

  // Prefer DB-backed provenance (formula_input_provenance) over the view heuristic.
  // Only fall back to the heuristic when no persisted provenance exists.
  const dbProvenance: any[] = Array.isArray((issue as any)?.formula_provenance) ? (issue as any).formula_provenance : [];
  const provenanceFromDb = dbProvenance.length > 0;
  const sourceTypeLabel = (st: string): string =>
    (({ uploaded_csv: "uploaded CSV", demo_seed: "demo seed", calibration_table: "calibration table", inferred_assumption: "inferred assumption", manual: "manual entry" } as Record<string, string>)[st] || st);
  const operatorView = canViewAdminControls();

  // ── Formula governance (task 2) ──
  const formulaOwner = issue?.owner || "Unassigned — assign on first review";
  const lastValidatedRaw = issue?.last_updated || issue?.updated_at || issue?.created_at || null;
  const lastValidated = lastValidatedRaw
    ? new Date(lastValidatedRaw).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : "Not yet validated against company data";
  const assumptionSource = demoCal ? "demo calibration (illustrative, not real company data)" : "company calibration table";

  // ── Sensitivity band (task 3) — display only; never changes the core estimate ──
  const numF = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
  const sensitivity = (() => {
    const pct = numF(fi.percent_change) ?? numF(fi.abs_percent_change);
    const base = Math.abs(numF(issue?.business_estimate) ?? numF(issue?.impact_high) ?? numF(fi.result) ?? 0);
    if (!base || pct == null) return null;
    const aPct = Math.abs(pct), pctLo = aPct * 0.8, pctHi = aPct * 1.2;
    const commoditySpend = numF(fi.commodity_spend), unpassed = numF(fi.unpassed_share);
    const freightSpend = numF(fi.freight_spend), spot = numF(fi.spot_exposure_pct);
    const fuelFreight = numF(fi.fuel_exposed_freight);
    let lo = base * 0.7, hi = base * 1.3, lever = "PPI move ±20%";
    if (commoditySpend != null && unpassed != null) {
      lo = commoditySpend * Math.max(0, unpassed - 0.10) * (pctLo / 100);
      hi = commoditySpend * Math.min(1, unpassed + 0.10) * (pctHi / 100);
      lever = "unpassed share ±10pp · PPI move ±20%";
    } else if (freightSpend != null && spot != null) {
      lo = freightSpend * Math.max(0, spot / 100 - 0.10) * (pctLo / 100);
      hi = freightSpend * Math.min(1, spot / 100 + 0.10) * (pctHi / 100);
      lever = "spot exposure ±10pp · PPI move ±20%";
    } else if (fuelFreight != null) {
      lo = fuelFreight * 0.85 * (pctLo / 100) * 0.7;
      hi = fuelFreight * 1.15 * (pctHi / 100) * 1.0;
      lever = "fuel-exposed base ±15% · surcharge capture 70–100%";
    }
    lo = Math.abs(lo); hi = Math.abs(hi);
    return { base, conservative: Math.min(lo, hi), lo: Math.min(lo, hi), hi: Math.max(lo, hi), lever };
  })();

  if (!methodology) {
    return (
      <div className="trust-audit-panel">
        <div className="trust-audit-header">
          <span className="trust-audit-title">Model Basis / Assumption Audit</span>
        </div>
        <div className="trust-audit-rows">
          <p className="muted" style={{ margin: 0 }}>No model basis stored for this item.</p>
        </div>
      </div>
    );
  }

  const auditTitle = sectionType === "watchlist"
    ? "Watchlist Triage Audit"
    : "Model Basis / Assumption Audit";

  const auditBadge = sectionType === "watchlist"
    ? <span className="model-status model-status-watchlist">Watchlist only</span>
    : <span className={status.className}>{status.label}</span>;

  return (
    <div className="trust-audit-panel">
      <div className="trust-audit-header">
        <span className="trust-audit-title">{auditTitle}</span>
        {auditBadge}
      </div>

      <div className="trust-audit-rows">
        {formula && (
          <div className="trust-row">
            <span className="trust-row-label">Formula used</span>
            <span className="trust-row-value">{formula}</span>
          </div>
        )}

        {/* Per-input provenance (task 1) — DB-backed first, view heuristic only as fallback. */}
        {formula && (
          <div className="trust-row">
            <span className="trust-row-label">Company input provenance{provenanceFromDb ? "" : " (derived)"}</span>
            <div className="trust-row-value">
              {provenanceFromDb ? (
                dbProvenance.map((p) => (
                  <span key={p.id || p.input_name} className="trust-row-note">
                    {(p.input_label || p.input_name)}: {sourceTypeLabel(p.source_type)}
                    {operatorView
                      ? ` · ${p.source_label ?? ""}${p.confidence ? ` · confidence ${p.confidence}` : ""}${p.owner ? ` · owner ${p.owner}` : ""}${p.last_validated_at ? ` · validated ${new Date(p.last_validated_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}` : ""}`
                      : ""}
                  </span>
                ))
              ) : formulaInputRows.length > 0 ? (
                formulaInputRows.map((r) => (
                  <span key={r.label} className="trust-row-note">{r.label}: {r.prov}</span>
                ))
              ) : (
                <span className="trust-row-note">per-input provenance unavailable; shared demo calibration used.</span>
              )}
            </div>
          </div>
        )}

        {formula && /fuel-exposed freight/i.test(formula) && (
          <div className="trust-row">
            <span className="trust-row-label">Base note</span>
            <span className="trust-row-value">
              Fuel-exposed freight base includes fuel-sensitive surchargeable lanes; it may differ from the
              spot-exposed freight spend used in the Freight PPI issue.{isDemoMode() ? " Source: demo calibration assumption." : ""}
            </span>
          </div>
        )}

        {/* Sensitivity band (task 3) — display only; core estimate unchanged. */}
        {sensitivity && (
          <div className="trust-row">
            <span className="trust-row-label">Sensitivity</span>
            <div className="trust-row-value">
              <span>Base ~{formatMoney(sensitivity.base)} · Conservative ~{formatMoney(sensitivity.conservative)} · Range ~{formatMoney(sensitivity.lo)}–{formatMoney(sensitivity.hi)}</span>
              <span className="trust-row-source">Varying {sensitivity.lever} (illustrative, does not change the core estimate)</span>
            </div>
          </div>
        )}

        {/* Formula governance (task 2). */}
        <div className="trust-row">
          <span className="trust-row-label">Governance</span>
          <div className="trust-row-value">
            <span className="trust-row-note">Formula owner: {formulaOwner}</span>
            <span className="trust-row-note">Last validated: {lastValidated}</span>
            <span className="trust-row-note">Assumption source: {assumptionSource}</span>
            <span className="trust-row-note">Sensitivity: {sensitivity ? `~${formatMoney(sensitivity.lo)}–${formatMoney(sensitivity.hi)} under the levers above` : "single-point estimate; provide company data to band it"}</span>
          </div>
        </div>

        <div className="trust-row">
          <span className="trust-row-label">Exposure base</span>
          <div className="trust-row-value">
            <span>{baseExposure > 0 ? formatMoney(baseExposure) : "Not stored"}</span>
            {baseType && <span className="trust-row-note">{cleanLabel(baseType)}</span>}
            <span className="trust-row-source">{baseSource}</span>
          </div>
        </div>

        <div className="trust-row">
          <span className="trust-row-label">Shock used</span>
          <div className="trust-row-value">
            <span>{shock.displayValue}</span>
            <span className="trust-row-source">{cleanShockSourceForDisplay(shock.source)}</span>
          </div>
        </div>

        {rejectedValues && (
          <div className="trust-row trust-row-warn">
            <span className="trust-row-label">Rejected values</span>
            <div className="trust-row-value">
              <span>{rejectedValues}</span>
              {rejectedNote && (
                <span className="trust-row-note">{rejectedNote}</span>
              )}
            </div>
          </div>
        )}

        <div className="trust-row">
          <span className="trust-row-label">Evidence signals</span>
          <div className="trust-row-value">
            <span>
              {signalCount} signal{signalCount !== 1 ? "s" : ""} paired
            </span>
            {avgQuality > 0 && (
              <span className="trust-row-note">
                Avg source quality {avgQuality}/100
              </span>
            )}
          </div>
        </div>

        <div className="trust-row">
          <span className="trust-row-label">Confidence breakdown</span>
          <div className="confidence-decomp">
            {getConfidenceDecomposition(methodology, evidence).map((item) => (
              <div key={item.label} className="confidence-decomp-row">
                <span className="confidence-decomp-label">{item.label}</span>
                <span className="confidence-decomp-right">
                  <span className={`confidence-level confidence-level-${item.level.toLowerCase().replace(/ /g, "-")}`}>{item.level}</span>
                  <span className="confidence-decomp-value">{item.value}</span>
                </span>
              </div>
            ))}
          </div>
        </div>

        {missingInputs.length > 0 && (
          <div className="trust-row trust-row-error">
            <span className="trust-row-label">Missing calibration</span>
            <span className="trust-row-value">
              {missingInputs.slice(0, 3).join(", ")}
              {missingInputs.length > 3
                ? ` +${missingInputs.length - 3} more`
                : ""}
            </span>
          </div>
        )}

        {honesty && (
          <div className="trust-row">
            <span className="trust-row-label">Model note</span>
            <span className="trust-row-value">{honesty}</span>
          </div>
        )}

        {wrongSentence && (
          <div className="trust-row trust-row-caveat">
            <span className="trust-row-label">What could be wrong</span>
            <span className="trust-row-value">{wrongSentence}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Evidence presentation helpers ─────────────────────────────────────────────

function EvidenceTierBadge({ item }: { item: any }) {
  const tier = classifyEvidenceSource(item);
  return <span className={tier.className}>{tier.label}</span>;
}

function EvidenceSummaryHeader({
  evidence,
  methodology,
}: {
  evidence: any[];
  methodology?: Methodology | null;
}) {
  if (evidence.length === 0) return null;

  const tiers = evidence.map(classifyEvidenceSource);
  const bestTier = [...tiers].sort((a, b) => a.rank - b.rank)[0];

  const withDates = evidence.filter((e: any) => e.published_at);
  const mostRecent =
    withDates.length > 0
      ? [...withDates].sort(
          (a: any, b: any) =>
            new Date(b.published_at).getTime() -
            new Date(a.published_at).getTime()
        )[0]
      : null;

  const uniqueSources = new Set(
    evidence.map((e: any) => e.source).filter(Boolean)
  ).size;

  const shock = methodology ? getMethodologyShock(methodology as any) : null;
  const usedValue = shock?.isExplicit ? shock.displayValue : null;
  const rejectedValues = formatRejectedShockValues(methodology);

  return (
    <div className="evidence-summary-header">
      <div className="evidence-summary-stats">
        <span>
          {evidence.length} item{evidence.length !== 1 ? "s" : ""} ·{" "}
          {uniqueSources} unique source{uniqueSources !== 1 ? "s" : ""}
        </span>
        {bestTier && bestTier.rank <= 3 && (
          <span className="ev-tier-badge-inline">
            Best: <span className={bestTier.className}>{bestTier.label}</span>
          </span>
        )}
        {mostRecent && (
          <span className="muted">
            Most recent:{" "}
            {formatFreshnessFromPublishedAt(
              (mostRecent as any).published_at,
              null,
              null
            )}
          </span>
        )}
      </div>

      {(usedValue || rejectedValues) && (
        <div className="evidence-value-row">
          {usedValue && (
            <span className="evidence-used-value">
              Used: {usedValue} (article-verified)
            </span>
          )}
          {rejectedValues && (
            <span className="evidence-rejected-value">
              Rejected: {rejectedValues} (not incremental)
            </span>
          )}
        </div>
      )}
    </div>
  );
}
