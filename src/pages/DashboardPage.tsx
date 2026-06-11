import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
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

import "./DashboardPage.css";
import { attachConnectionsToRisks } from "../services/riskConnectionBackfill";
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
  caveat?: string;
};

export default function DashboardPage() {
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
      alert(companyError.message);
      setLoading(false);
      return;
    }

    const latestCompany = companies?.[0];
if (latestCompany) {
  localStorage.setItem("groundsense_company_id", latestCompany.id);

  console.log("Dashboard loading company:", {
    id: latestCompany.id,
    name: latestCompany.name,
    created_at: latestCompany.created_at,
  });
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
    setEntities(entityResult.data || []);
    setEvents(eventResult.data || []);
    setAssessments(assessmentResult.data || []);
    setRisks(riskResult.data || []);
    setOpportunities(opportunityResult.data || []);
    setBrief(briefResult.data?.[0] || null);
    setActions(actionResult.data || []);
    setEdges(edgeResult.data || []);
    setRiskSnapshots(riskSnapshotResult.data || []);
    setOpportunitySnapshots(opportunitySnapshotResult.data || []);
    setConnections(connectionResult.data || []);
    setImpactPaths(impactPathResult.data || []);

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
    field: "risk_title" | "opportunity_title"
  ) {
    const matching = snapshots
      .filter((snapshot) => snapshot[field] === title)
      .sort(
        (a, b) =>
          new Date(b.snapshot_week).getTime() -
          new Date(a.snapshot_week).getTime()
      );

    if (matching.length < 2) return "New";

    const current = matching[0].priority_score || 0;
    const previous = matching[1].priority_score || 0;
    const delta = current - previous;

    return delta > 0 ? `+${delta}` : String(delta);
  }

  const riskItems = risks.filter(
  (risk) => !risk.display_section || risk.display_section === "risk_register"
);

const operatingChanges = risks.filter(
  (risk) => risk.display_section === "operating_changes"
);

const watchlistItems = risks.filter(
  (risk) => risk.display_section === "watchlist"
);

const totalRiskHigh = riskItems.reduce(
  (sum, risk) => sum + Number(risk.impact_high || 0),
  0
);

const totalRiskLow = riskItems.reduce(
  (sum, risk) => sum + Number(risk.impact_low || 0),
  0
);
const evidenceBackedRiskItems = riskItems.filter(
  (risk) => getIssueModelStatus(risk.methodology).status === "evidence_backed"
);

const scenarioRiskItems = riskItems.filter(
  (risk) => getIssueModelStatus(risk.methodology).status === "scenario_fallback"
);

const needsCalibrationRiskItems = riskItems.filter(
  (risk) => getIssueModelStatus(risk.methodology).status === "needs_calibration"
);

const evidenceBackedRiskLow = evidenceBackedRiskItems.reduce(
  (sum, risk) => sum + Number(risk.impact_low || 0),
  0
);

const evidenceBackedRiskHigh = evidenceBackedRiskItems.reduce(
  (sum, risk) => sum + Number(risk.impact_high || 0),
  0
);

const scenarioRiskLow = scenarioRiskItems.reduce(
  (sum, risk) => sum + Number(risk.impact_low || 0),
  0
);

const scenarioRiskHigh = scenarioRiskItems.reduce(
  (sum, risk) => sum + Number(risk.impact_high || 0),
  0
);

const residualOperatingLow = operatingChanges.reduce(
  (sum, risk) => sum + Number(risk.impact_low || 0),
  0
);

const residualOperatingHigh = operatingChanges.reduce(
  (sum, risk) => sum + Number(risk.impact_high || 0),
  0
);

function riskExposureSubtitle() {
  if (riskItems.length === 0) return "No modeled downside";

  if (evidenceBackedRiskItems.length > 0 && scenarioRiskItems.length > 0) {
    return "Evidence-backed + scenario downside";
  }

  if (evidenceBackedRiskItems.length > 0) {
    return "Evidence-backed downside";
  }

  if (scenarioRiskItems.length > 0) {
    return "Scenario-modeled downside";
  }

  if (needsCalibrationRiskItems.length > 0) {
    return "Needs calibration";
  }

  return "Modeled downside";
}
  const totalOpportunityHigh = opportunities.reduce(
    (sum, opportunity) => sum + Number(opportunity.revenue_high || 0),
    0
  );

  const totalOpportunityLow = opportunities.reduce(
    (sum, opportunity) => sum + Number(opportunity.revenue_low || 0),
    0
  );

  const openActions = actions.filter(
    (action) => action.status !== "completed"
  ).length;

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

  const executiveMemo = useMemo(() => {
    if (!brief?.brief_text) return "";

    const parts = brief.brief_text.split("TOP RISKS");
    return parts[0]?.trim() || brief.brief_text;
  }, [brief]);

  if (loading) {
    return (
      <main className="dashboard-page">
        <div className="dashboard-container">Loading...</div>
      </main>
    );
  }

  return (
    <main className="dashboard-page">
      <div className="dashboard-container">
        <header className="dashboard-header">
          <div>
            <p className="eyebrow">GroundSense</p>
            <h1 className="dashboard-title">Executive Intelligence</h1>
            <p className="dashboard-subtitle">
              Company-specific risk, opportunity, methodology, connections, and
              action tracking.
            </p>
          </div>

          <Link to="/onboarding">
            <button className="secondary-button">Add Company</button>
          </Link>
          <Link to="/calibration">
  <button className="secondary-button">Calibrate Model</button>
</Link>
        </header>

        <section className="toolbar">
          <button
            className="primary-button"
            onClick={() =>
              run("fresh", () => fetchFreshIntelligenceForCompany(company!.id))
            }
            disabled={busy !== null}
          >
            {busy === "fresh" ? "Fetching..." : "Refresh Intelligence"}
          </button>

          <button
            className="primary-button"
            onClick={() => run("brief", () => generateBriefForCompany(company!.id))}
            disabled={busy !== null}
          >
            {busy === "brief" ? "Generating..." : "Generate Brief"}
          </button>

          <Link to="/calibration">
            <button className="secondary-button" disabled={busy !== null}>Approve Assumptions</button>
          </Link>

          <button className="secondary-button" disabled>Export Memo</button>

          <button
            className="text-button toolbar-advanced-toggle"
            onClick={() => setShowAdvancedPipeline((v) => !v)}
          >
            {showAdvancedPipeline ? "▲ Hide pipeline controls" : "▼ Advanced pipeline controls"}
          </button>
        </section>

        {showAdvancedPipeline && (
          <section className="toolbar toolbar-advanced">
            <button
              className="primary-button"
              onClick={() =>
                run("article-bodies", () => fetchArticleContentForCompany(company!.id))
              }
              disabled={busy !== null}
            >
              {busy === "article-bodies" ? "Fetching Bodies..." : "Fetch Article Bodies"}
            </button>
            <button
              className="secondary-button"
              onClick={() => stopFreshIntelligenceBatch()}
            >
              Stop Fresh Batch
            </button>
            <button
              className="primary-button"
              onClick={() => run("fetch", () => fetchEventsForCompany(company!.id))}
              disabled={busy !== null}
            >
              {busy === "fetch" ? "Fetching..." : "Fetch Events"}
            </button>
            <button
              className="primary-button"
              onClick={() =>
                run("score", async () => {
                  await scoreEventsForCompany(company!.id);
                  await matchEventsToConnections(company!.id);
                })
              }
              disabled={busy !== null}
            >
              {busy === "score" ? "Scoring..." : "Score Events"}
            </button>
            <button
              className="primary-button"
              onClick={() => run("connections", () => buildConnectionsForCompany(company!.id))}
              disabled={busy !== null}
            >
              {busy === "connections" ? "Building..." : "Build Connections"}
            </button>
            <button
              className="primary-button"
              onClick={() =>
                run("match-connections", async () => { await matchEventsToConnections(company!.id); })
              }
              disabled={busy !== null}
            >
              {busy === "match-connections" ? "Matching..." : "Match Events to Connections"}
            </button>
            <button
              className="primary-button"
              onClick={() =>
                run("risks", async () => {
                  await generateDynamicRisksForCompany(company!.id);
                  await matchEventsToConnections(company!.id);
                  await attachConnectionsToRisks(company!.id);
                })
              }
              disabled={busy !== null}
            >
              {busy === "risks" ? "Generating..." : "Generate Risks"}
            </button>
            <button
              className="primary-button"
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
              {busy === "opportunities" ? "Generating..." : "Generate Opportunities"}
            </button>
            <button
              className="primary-button"
              onClick={() =>
                run("specific-explanations", () =>
                  generateSpecificExplanationsForCompany(company!.id)
                )
              }
              disabled={busy !== null}
            >
              {busy === "specific-explanations" ? "Explaining..." : "Generate Specific Explanations"}
            </button>
            <button
              className="primary-button"
              onClick={() => run("graph", () => buildExposureGraphForCompany(company!.id))}
              disabled={busy !== null}
            >
              {busy === "graph" ? "Building..." : "Build Exposure Graph"}
            </button>
          </section>
        )}

        <section className="metrics-grid">
          <Metric
  title="Executive Issues"
  value={String(
    riskItems.length +
      operatingChanges.length +
      watchlistItems.length +
      opportunities.length
  )}
  subtitle={`${riskItems.length} risks · ${operatingChanges.length} changes · ${watchlistItems.length} watch · ${opportunities.length} opportunities`}
            explanation={explainDashboardMetric("executive_issues", {
  riskCount: riskItems.length,
  operatingChangeCount: operatingChanges.length,
  watchlistCount: watchlistItems.length,
  opportunityCount: opportunities.length,
})}
          />

          <Metric
  title="Risk Exposure"
  value={`${formatMoney(totalRiskLow)}–${formatMoney(totalRiskHigh)}`}
  subtitle={riskExposureSubtitle()}
  explanation={explainDashboardMetric("risk_exposure", {
    low: totalRiskLow,
    high: totalRiskHigh,
    count: riskItems.length,
    evidenceBackedLow: evidenceBackedRiskLow,
    evidenceBackedHigh: evidenceBackedRiskHigh,
    evidenceBackedCount: evidenceBackedRiskItems.length,
    scenarioLow: scenarioRiskLow,
    scenarioHigh: scenarioRiskHigh,
    scenarioCount: scenarioRiskItems.length,
    residualLow: residualOperatingLow,
    residualHigh: residualOperatingHigh,
    residualCount: operatingChanges.length,
    needsCalibrationCount: needsCalibrationRiskItems.length,
  })}
/>

          <Metric
            title="Opportunity Upside"
            value={`${formatMoney(totalOpportunityLow)}–${formatMoney(
              totalOpportunityHigh
            )}`}
            subtitle="Modeled upside"
            explanation={explainDashboardMetric("opportunity_upside", {
              low: totalOpportunityLow,
              high: totalOpportunityHigh,
              count: opportunities.length,
            })}
          />

          

          <Metric
  title="Evidence Sources"
  value={String(uniqueEvidenceSources)}
  subtitle={`${allEvidenceItems.length} evidence items · avg quality ${avgEvidenceQuality}/100`}
  explanation={explainDashboardMetric("supporting_signals", {
    relevant: signalStats.relevantEvents,
    events: signalStats.rawEvents,
    assessed: signalStats.assessedEvents,
  })}
/>

          <Metric
            title="Open Actions"
            value={String(openActions)}
            subtitle={`${actions.length} total actions`}
            explanation={explainDashboardMetric("open_actions", {
              open: openActions,
              total: actions.length,
            })}
          />
        </section>

        {/* 2. Leadership Memo — compact structured preview */}
        <CompactMemoSection
          brief={brief}
          executiveMemo={executiveMemo}
          company={company}
          riskItems={riskItems}
          operatingChanges={operatingChanges}
          watchlistItems={watchlistItems}
          opportunities={opportunities}
          openActions={openActions}
          totalRiskLow={totalRiskLow}
          totalRiskHigh={totalRiskHigh}
          totalOpportunityLow={totalOpportunityLow}
          totalOpportunityHigh={totalOpportunityHigh}
        />

        {/* 3. Executive Actions */}
        {actions.length > 0 && (
          <section className="card">
            <div className="card-header">
              <div>
                <p className="eyebrow">What to do next</p>
                <h2 className="section-title">Executive Actions</h2>
              </div>
              <span className="badge">{openActions} open</span>
            </div>
            <div className="actions-compact-list">
              {actions.slice(0, 6).map((action) => (
                <div key={action.id} className="action-compact-row">
                  <div className="action-compact-left">
                    <p className="action-title">{action.title}</p>
                    <p className="muted">
                      {action.owner || "Unassigned"} · Due {action.deadline || "not set"}
                    </p>
                  </div>
                  <select
                    value={action.status || "open"}
                    onChange={(event) => updateActionStatus(action.id, event.target.value)}
                    className="status-select"
                  >
                    <option value="open">Open</option>
                    <option value="in_review">In review</option>
                    <option value="accepted">Accepted</option>
                    <option value="dismissed">Dismissed</option>
                    <option value="completed">Completed</option>
                  </select>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* 4. Risk Register */}
        <section className="card">
          <div className="card-header">
            <div>
              <p className="eyebrow">System of record</p>
              <h2 className="section-title">Risk Register</h2>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span className="badge">{riskItems.length} risks · {formatMoney(totalRiskLow)}–{formatMoney(totalRiskHigh)}</span>
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
            riskItems.map((risk, index) => (
              <RiskCard
                key={risk.id}
                risk={risk}
                displayRank={index + 1}
                expanded={expandedRiskIds.has(risk.id)}
                onToggle={() => toggleRiskId(risk.id)}
                movement={getMovement(risk.risk_title, riskSnapshots, "risk_title")}
                matchedConnections={matchedConnectionsByItemId[risk.id] || []}
              />
            ))
          )}
        </section>

        {/* 5. Opportunities */}
        <section className="card">
          <div className="card-header">
            <div>
              <p className="eyebrow">Commercial upside</p>
              <h2 className="section-title">Opportunities</h2>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span className="badge">{opportunities.length} opportunities</span>
              {opportunities.length > 0 && (
                <button className="text-button" onClick={() => toggleAllOpportunitySection(opportunities.map(o => o.id))}>
                  {opportunities.every(o => expandedOpportunityIds.has(o.id)) ? "Collapse all" : "Expand all"}
                </button>
              )}
            </div>
          </div>
          {opportunities.length === 0 ? (
            <p className="muted">No opportunities generated yet.</p>
          ) : (
            opportunities.map((opportunity) => (
              <OpportunityCard
                key={opportunity.id}
                opportunity={opportunity}
                expanded={expandedOpportunityIds.has(opportunity.id)}
                onToggle={() => toggleOpportunityId(opportunity.id)}
                movement={getMovement(opportunity.title, opportunitySnapshots, "opportunity_title")}
                matchedConnections={matchedConnectionsByItemId[opportunity.id] || []}
              />
            ))
          )}
        </section>

        {/* 6. Operating Changes */}
        {operatingChanges.length > 0 && (
          <section className="card">
            <div className="card-header">
              <div>
                <p className="eyebrow">Policy / operating changes</p>
                <h2 className="section-title">Operating Changes</h2>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span className="badge">{operatingChanges.length} items</span>
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
              />
            ))}
          </section>
        )}

        {/* 7. Watchlist */}
        {watchlistItems.length > 0 && (
          <section className="card">
            <div className="card-header">
              <div>
                <p className="eyebrow">Monitor</p>
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

        {/* 8. Company Model — compact with expandable sections */}
        <CompanyModelSection company={company} entities={entities} getEntities={getEntities} />

        {/* 9. Exposure Graph — top 3 + expand */}
        <section className="card">
          <div className="card-header">
            <div>
              <p className="eyebrow">Exposure graph</p>
              <h2 className="section-title">Operating Exposure Paths</h2>
            </div>
            <span className="badge">
              {impactPaths.length > 0 ? `${impactPaths.length} paths` : edges.length > 0 ? `${edges.length} connections` : "0"}
            </span>
          </div>
          <GroupedExposurePaths paths={impactPaths} edges={edges} limit={3} />
        </section>

        {/* Raw events — advanced/developer view */}
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
      </div>
    </main>
  );
}

function CompactMemoSection({
  brief,
  executiveMemo,
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
}: {
  brief: Brief | null;
  executiveMemo: string;
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
}) {
  const [briefExpanded, setBriefExpanded] = useState(false);

  const topRisk = riskItems[0];
  const topOpp = opportunities[0];
  const topChange = operatingChanges[0];

  const summaryLines = [
    topRisk
      ? `TOP RISK — ${topRisk.risk_title} · ${formatMoney(topRisk.impact_low)}–${formatMoney(topRisk.impact_high)} exposure · Priority ${topRisk.priority_score || 0}/100`
      : null,
    topOpp
      ? `TOP OPPORTUNITY — ${topOpp.title} · ${formatMoney(topOpp.revenue_low)}–${formatMoney(topOpp.revenue_high)} upside`
      : null,
    topChange
      ? `KEY CHANGE — ${topChange.risk_title}`
      : null,
    openActions > 0
      ? `ACTIONS REQUIRED — ${openActions} open action${openActions !== 1 ? "s" : ""} pending`
      : null,
  ].filter(Boolean) as string[];

  return (
    <section className="card memo-section">
      <div className="card-header">
        <div>
          <p className="eyebrow">Leadership memo</p>
          <h2 className="section-title">{brief?.title || "Intelligence Summary"}</h2>
        </div>
        {brief ? (
          <span className="badge">{new Date(brief.created_at).toLocaleString()}</span>
        ) : (
          <span className="badge">Preview</span>
        )}
      </div>

      {!briefExpanded ? (
        <div className="memo-compact">
          {summaryLines.map((line, i) => (
            <div key={i} className="memo-summary-line">
              <span className="memo-summary-text">{line}</span>
            </div>
          ))}
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
          {brief ? (
            <pre className="memo">{executiveMemo}</pre>
          ) : (
            <pre className="memo">{generateDashboardPreviewMemo({
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
            })}</pre>
          )}
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
          <p className="eyebrow">Company model</p>
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

function generateDashboardPreviewMemo({
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
}: {
  company: any;
  riskItems: Risk[];
  operatingChanges: Risk[];
  watchlistItems: Risk[];
  opportunities: Opportunity[];
  openActions: number;
  totalRiskLow: number;
  totalRiskHigh: number;
  totalOpportunityLow: number;
  totalOpportunityHigh: number;
}): string {
  const lines: string[] = [];
  const name = company?.name || "the company";
  const date = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

  lines.push(`INTELLIGENCE SUMMARY — ${name.toUpperCase()}`);
  lines.push(`As of ${date}  |  GroundSense preview (no brief generated yet)`);
  lines.push("");

  if (riskItems.length > 0) {
    const top = riskItems[0];
    const topStatus = getIssueModelStatus(top.methodology);
    lines.push(`TOP RISK: ${top.risk_title}`);
    lines.push(`  Exposure: ${formatMoney(top.impact_low)}–${formatMoney(top.impact_high)}  |  Priority: ${top.priority_score || 0}/100  |  Model basis: ${topStatus.label}`);
    // Only include free-text summary if evidence-backed (avoids leaking rejected shock values like "109%")
    if (topStatus.status === "evidence_backed" && (top.executive_summary || top.what_happened)) {
      lines.push(`  ${(top.executive_summary || top.what_happened || "").slice(0, 160)}`);
    } else if (top.decision_required || top.action_required) {
      lines.push(`  Action: ${(top.decision_required || top.action_required || "").slice(0, 140)}`);
    }
    lines.push("");
  }

  if (operatingChanges.length > 0) {
    const top = operatingChanges[0];
    lines.push(`OPERATING CHANGE: ${top.risk_title}`);
    if (top.exposure_interpretation || top.business_impact) {
      lines.push(`  ${(top.exposure_interpretation || top.business_impact || "").slice(0, 160)}`);
    }
    lines.push("");
  }

  if (opportunities.length > 0) {
    const top = opportunities[0];
    lines.push(`OPPORTUNITY: ${top.title}`);
    lines.push(`  Upside: ${formatMoney(top.revenue_low)}–${formatMoney(top.revenue_high)}`);
    if (top.summary) lines.push(`  ${top.summary.slice(0, 160)}`);
    lines.push("");
  } else if (watchlistItems.length > 0) {
    lines.push(`WATCHLIST: ${watchlistItems[0].risk_title} — monitoring, not yet modeled.`);
    lines.push("");
  }

  lines.push("RISK EXPOSURE SUMMARY");
  lines.push(`  Total modeled downside: ${formatMoney(totalRiskLow)}–${formatMoney(totalRiskHigh)} across ${riskItems.length} risk${riskItems.length !== 1 ? "s" : ""}`);
  if (totalOpportunityHigh > 0) {
    lines.push(`  Total modeled upside: ${formatMoney(totalOpportunityLow)}–${formatMoney(totalOpportunityHigh)} across ${opportunities.length} opportunit${opportunities.length !== 1 ? "ies" : "y"}`);
  }
  lines.push(`  Open actions: ${openActions}`);
  lines.push("");
  lines.push("Run 'Generate Brief' for a full AI-authored memo with source citations.");

  return lines.join("\n");
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
                    <span className="exposure-path-amount">{formatMoney(p.exposureHigh)} exposure</span>
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

function RiskCard({
  risk,
  displayRank,
  expanded,
  onToggle,
  movement,
  matchedConnections,
}: {
  risk: Risk;
  displayRank: number;
  expanded: boolean;
  onToggle: () => void;
  movement: string;
  matchedConnections: MatchedConnectionPath[];
}) {
  const modelStatus = getIssueModelStatus(risk.methodology);
  const rejectedVals = formatRejectedShockValuesForRisk(risk);
  const isScenarioWithRejected = modelStatus.status === "scenario_fallback" && !!rejectedVals;
  const takeaway = (risk.executive_summary || risk.what_happened || "").slice(0, 240);

  return (
    <div className="record-card">
      <div className="record-top">
        <div>
          <div className="record-badge-row">
            <span className="orange-badge">
              #{displayRank} {modelStatus.status === "scenario_fallback" ? "Scenario Risk" : "Risk"}
            </span>
            <ModelStatusBadge methodology={risk.methodology} />
            {movement && movement !== "—" && movement !== "New" && (
              <span className="movement-chip">{movement}</span>
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
          label="Likelihood est."
          value={`${risk.probability || 0}%`}
          explanation={{
            title: "Likelihood estimate",
            formula: "Stored risk_register.probability",
            inputs: [
              `Estimate: ${risk.probability || 0}%`,
              `Confidence: ${risk.confidence || 0}%`,
              `Supporting events: ${risk.supporting_event_count || 0}`,
            ],
            source: "Generated by Generate Risks from relevant event assessments.",
            caveat:
              "This is a model confidence estimate, not a historically calibrated or actuarial probability.",
          }}
        />
        <Mini
          label={modelStatus.exposureLabel}
          value={getRiskExposureDisplay(risk)}
          explanation={explainRiskExposure(risk)}
        />
      </div>

      {takeaway && (
        <p className="card-takeaway">{takeaway}</p>
      )}

      {(risk.decision_required || risk.action_required) && (
        <div className="card-action-line">
          <span className="card-action-label">Recommended action</span>
          <span className="card-action-text">
            {(risk.decision_required || risk.action_required || "").slice(0, 160)}
          </span>
        </div>
      )}

      {expanded && (
        <DetailPanel
          methodology={risk.methodology}
          evidence={risk.evidence_items || []}
          exposurePath={risk.exposure_path || []}
          expectedBenefit={risk.expected_benefit}
          matchedConnections={matchedConnections}
          overviewContent={{
            whatChanged: risk.what_happened || risk.executive_summary,
            whyNow: risk.why_now,
            businessImpact: risk.risk_interaction || risk.business_impact,
            modelNote: isScenarioWithRejected ? rejectedVals : null,
          }}
          issueForPath={risk}
        />
      )}
    </div>
  );
}

function OperatingChangeCard({
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
  const explanation = getOperatingChangeExplanation(risk);

  return (
    <div className="record-card operating-change-card">
      <div className="record-top">
        <div>
          <div className="record-badge-row">
            <span className="blue-badge">Operating Change</span>
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
          label="Residual exposure"
          value={getResidualExposureDisplay(risk)}
          explanation={explainRiskExposure(risk)}
        />
        <Mini label="Confidence" value={`${risk.confidence || 0}%`} />
      </div>

      {explanation && (
        <p className="card-takeaway">{explanation.slice(0, 280)}</p>
      )}

      {(risk.decision_required || risk.action_required) && (
        <div className="card-action-line">
          <span className="card-action-label">Recommended action</span>
          <span className="card-action-text">
            {(risk.decision_required || risk.action_required || "").slice(0, 160)}
          </span>
        </div>
      )}

      {expanded && (
        <DetailPanel
          methodology={risk.methodology}
          evidence={risk.evidence_items || []}
          exposurePath={risk.exposure_path || []}
          expectedBenefit={risk.expected_benefit}
          matchedConnections={matchedConnections}
          sectionType="operating_changes"
          overviewContent={{
            whatChanged: risk.what_happened || risk.executive_summary,
            whyNow: risk.why_now,
            businessImpact: risk.risk_interaction || risk.business_impact,
          }}
          issueForPath={risk}
        />
      )}
    </div>
  );
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
  const watchlistExplanation = getWatchlistExplanation(risk);
  const upgradeText = getWatchlistUpgradeText(risk);

  return (
    <div className="record-card watchlist-card-compact">
      <div className="watchlist-compact-row">
        <div className="watchlist-compact-left">
          <div className="record-badge-row">
            <span className="gray-badge">Watchlist</span>
            <span className="watchlist-confidence-chip">{risk.confidence || 0}% conf.</span>
            <span className="direction-chip direction-chip-sm">{formatIssueDirection(risk.issue_direction || "uncertain")}</span>
          </div>
          <h3 className="watchlist-compact-title">{risk.risk_title}</h3>
          <p className="watchlist-compact-body">{(watchlistExplanation || "").slice(0, 220)}</p>
          {upgradeText && !expanded && (
            <p className="watchlist-upgrade-hint">
              <span className="watchlist-upgrade-label">Upgrade trigger:</span> {upgradeText.slice(0, 140)}
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
function getOpportunityQuality(opportunity: Opportunity): "qualified" | "candidate" {
  const evidence: any[] = opportunity.evidence_items || [];
  const summary = String(opportunity.summary || opportunity.title || "").toLowerCase();

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

  if (allBroadMarket || (!hasCompanySpecific && evidence.length <= 3)) {
    return "candidate";
  }

  if (summary.includes("generic") || summary.includes("broad") || summary.includes("macro")) {
    return "candidate";
  }

  return "qualified";
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
  const isCandidate = quality === "candidate";

  return (
    <div className="record-card">
      <div className="record-top">
        <div>
          <div className="record-badge-row">
            {isCandidate ? (
              <span className="amber-badge">Opportunity candidate</span>
            ) : (
              <span className="green-badge">
                #{opportunity.opportunity_rank || "-"} Opportunity
              </span>
            )}
            {movement && movement !== "—" && movement !== "New" && (
              <span className="movement-chip">{movement}</span>
            )}
          </div>
          <h3 className="record-title">{opportunity.title}</h3>
        </div>
        <button className="text-button" onClick={onToggle}>
          {expanded ? "Hide analysis" : "View analysis →"}
        </button>
      </div>

      <div className="mini-grid mini-grid-3">
        <Mini
          label={isCandidate ? "Directional upside" : "Potential upside"}
          value={`${formatMoney(opportunity.revenue_low)}–${formatMoney(opportunity.revenue_high)}`}
          explanation={explainOpportunityExposure(opportunity)}
        />
        <Mini
          label="Confidence"
          value={`${opportunity.confidence || 0}%`}
        />
        <Mini
          label="Priority"
          value={`${opportunity.priority_score || 0}/100`}
          explanation={explainOpportunityPriority(opportunity)}
        />
      </div>

      {opportunity.summary && (
        <p className="card-takeaway">{opportunity.summary.slice(0, 280)}</p>
      )}

      {isCandidate && (
        <p className="candidate-note">Directional only — broad market signals, not company-specific data. Upgrade requires earnings confirmation or segment evidence.</p>
      )}

      {(opportunity.decision_required || opportunity.action_required) && (
        <div className="card-action-line">
          <span className="card-action-label">Recommended action</span>
          <span className="card-action-text">
            {(opportunity.decision_required || opportunity.action_required || "").slice(0, 160)}
          </span>
        </div>
      )}

      {expanded && (
        <DetailPanel
          methodology={opportunity.methodology}
          evidence={opportunity.evidence_items || []}
          exposurePath={opportunity.exposure_path || []}
          expectedBenefit={opportunity.expected_benefit}
          matchedConnections={matchedConnections}
          sectionType="opportunity"
          overviewContent={{
            whatChanged: opportunity.what_happened || (opportunity as any).executive_summary,
            whyNow: (opportunity as any).why_now,
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
          Model Audit
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
              <span className="analysis-ov-text">{overviewContent.whatChanged}</span>
            </div>
          )}
          {overviewContent?.whyNow && (
            <div className="analysis-overview-row">
              <span className="analysis-ov-label">Why now</span>
              <span className="analysis-ov-text">{overviewContent.whyNow}</span>
            </div>
          )}
          {overviewContent?.businessImpact && (
            <div className="analysis-overview-row">
              <span className="analysis-ov-label">Business impact</span>
              <span className="analysis-ov-text">{overviewContent.businessImpact}</span>
            </div>
          )}

          <div className="analysis-path-section">
            <p className="analysis-path-label">How Impact Reaches Fastenal</p>
            {bestPathNodes && bestPathNodes.length >= 2 ? (
              <LayeredPath nodes={bestPathNodes} />
            ) : (
              <p className="muted">No impact path available. Run Build Exposure Graph to generate paths.</p>
            )}
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
    color: "#fff7ed",
  };

  const labelStyle = {
    color: "#fed7aa",
    fontSize: "10px",
    fontWeight: 900,
    letterSpacing: "0.06em",
    textTransform: "uppercase" as const,
  };

  const lineStyle = {
    color: "#fff7ed",
    fontSize: "12px",
    lineHeight: 1.45,
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "10px",
        color: "#fffdf8",
        fontSize: "12px",
        lineHeight: 1.45,
        textAlign: "left",
      }}
    >
      <strong
        style={{
          display: "block",
          color: "#ffffff",
          fontSize: "13px",
          fontWeight: 850,
          paddingBottom: "6px",
          borderBottom: "1px solid rgba(255, 253, 248, 0.18)",
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
              border: "1px solid #5f4a38",
              background: "#2b2118",
              color: "#fffdf8",
              boxShadow: "0 18px 45px rgba(43, 33, 24, 0.32)",

              fontSize: "12px",
              lineHeight: 1.45,
              whiteSpace: "normal",
              textAlign: "left",
              pointerEvents: "none",
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
      label: "Evidence-backed",
      className: "model-status model-status-evidence",
      exposureLabel: "Evidence-backed exposure",
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
}: {
  methodology?: Methodology | null;
}) {
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

function getMissingCalibrationText(risk: Risk) {
  const missing = risk.methodology?.missing_inputs || [];

  if (!Array.isArray(missing) || missing.length === 0) {
    return "Required company calibration inputs are missing.";
  }

  const clean = missing.map(friendlyMissingInput);
  const unique = [...new Set(clean)];

  if (unique.length === 1) {
    return `Missing calibration: ${unique[0]}.`;
  }

  return `Missing calibration: ${unique.slice(0, 3).join(", ")}${
    unique.length > 3 ? ` +${unique.length - 3} more` : ""
  }.`;
}

function getWatchlistBlockerText(risk: Risk) {
  const status = getIssueModelStatus(risk.methodology);

  if (status.status === "needs_calibration") {
    return getMissingCalibrationText(risk);
  }

  if (status.status === "scenario_fallback") {
    const rejectedValues = formatRejectedShockValues(risk.methodology);

    if (rejectedValues) {
      return `Rejected ${rejectedValues} as not clearly new or incremental.`;
    }

    return "No new explicit percentage found.";
  }

  if (risk.issue_direction) {
    return `Direction: ${cleanLabel(risk.issue_direction)}.`;
  }

  return "Direction or evidence strength is uncertain.";
}

function getWatchlistUpgradeText(risk: Risk) {
  const status = getIssueModelStatus(risk.methodology);

  if (status.status === "needs_calibration") {
    return `${getMissingCalibrationText(
      risk
    )} Add the missing calibration fields, then regenerate risks.`;
  }

  if (status.status === "scenario_fallback") {
    return "A current article with a clearly new percentage, rate, cost, demand, or supply movement would upgrade this from scenario sensitivity to evidence-backed exposure.";
  }

  return "A current adverse operating signal with direct company exposure would upgrade this from watchlist to modeled risk.";
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
    return "Favorable + residual";
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

function compactText(value: unknown) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function ensureSentence(value: unknown) {
  const text = compactText(value);
  if (!text) return "";
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function textFingerprint(value: unknown) {
  return compactText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function isDuplicateMeaning(candidate: string, existing: string[]) {
  const candidateKey = textFingerprint(candidate);

  if (!candidateKey) return true;

  return existing.some((item) => {
    const itemKey = textFingerprint(item);

    if (!itemKey) return false;
    if (candidateKey === itemKey) return true;

    const shorter = candidateKey.length < itemKey.length ? candidateKey : itemKey;
    const longer = candidateKey.length < itemKey.length ? itemKey : candidateKey;

    return shorter.length > 80 && longer.includes(shorter);
  });
}

function joinDistinctSentences(values: unknown[], max = 3) {
  const chosen: string[] = [];

  for (const value of values) {
    const text = ensureSentence(value);

    if (!text) continue;
    if (isDuplicateMeaning(text, chosen)) continue;

    chosen.push(text);

    if (chosen.length >= max) break;
  }

  return chosen.join(" ");
}

function getOperatingChangePlanningSentence(risk: Risk) {
  const direction = String(risk.issue_direction || "").toLowerCase();

  if (direction.includes("favorable") && direction.includes("residual")) {
    return "GroundSense separates the remaining exposure from the favorable change so leaders can update sourcing, pricing, and planning assumptions without treating the change itself as a new downside event.";
  }

  if (direction.includes("favorable")) {
    return "GroundSense keeps this outside downside risk totals because the evidence points to relief or upside, while still preserving it as an executive planning item.";
  }

  if (direction.includes("mixed") || direction.includes("uncertain")) {
    return "GroundSense keeps this as an operating change because the evidence changes planning assumptions, but the financial direction is not clean enough to classify as pure downside or upside.";
  }

  return "GroundSense treats this as a planning assumption change rather than a downside risk, so the action is to update operating plans instead of launching mitigation as if a new loss event occurred.";
}

function getOperatingChangeExplanation(risk: Risk) {
  // Prefer exposure_interpretation as sentence 1 (prior→new rate + residual exposure),
  // then business_impact as sentence 2 (relief + procurement action required).
  // Fall back to other fields if those are absent.
  const s1 = risk.exposure_interpretation || risk.executive_summary || risk.what_happened;
  const s2 = risk.business_impact || risk.risk_interaction || getOperatingChangePlanningSentence(risk);

  return joinDistinctSentences([s1, s2], 2);
}

function formatWatchlistBlockerSentence(risk: Risk) {
  const blocker = compactText(getWatchlistBlockerText(risk)).replace(/\.$/, "");

  if (!blocker) {
    return "Blocker: Direction, calibration, or evidence strength is still unresolved.";
  }

  if (blocker.toLowerCase().startsWith("direction:")) {
    return `GroundSense is holding this in Watchlist because ${blocker
      .replace(/^direction:\s*/i, "")
      .toLowerCase()} has not been resolved into a clear modeled downside case.`;
  }

  return `Blocker: ${blocker}.`;
}

function getWatchlistExplanation(risk: Risk) {
  return joinDistinctSentences(
    [
      risk.executive_summary,
      risk.what_happened,
      risk.business_impact,
      risk.risk_interaction,
      risk.exposure_interpretation,
      formatWatchlistBlockerSentence(risk),
    ],
    4
  );
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
    title: "Risk Exposure",
    formula:
      "Downside total = sum of risk_register impact values for items in the Risk Register.",
    inputs: [
      {
        label: "Displayed downside total",
        value: `${formatMoney(options.low)}–${formatMoney(options.high)}`,
      },
      {
        label: "Evidence-backed downside",
        value: `${formatMoney(options.evidenceBackedLow)}–${formatMoney(
          options.evidenceBackedHigh
        )} across ${options.evidenceBackedCount || 0} risks`,
      },
      {
        label: "Scenario downside",
        value: `${formatMoney(options.scenarioLow)}–${formatMoney(
          options.scenarioHigh
        )} across ${options.scenarioCount || 0} risks`,
      },
      {
        label: "Residual operating exposure",
        value: `${formatMoney(options.residualLow)}–${formatMoney(
          options.residualHigh
        )} across ${options.residualCount || 0} operating changes`,
      },
      {
        label: "Needs calibration",
        value: `${options.needsCalibrationCount || 0} downside items`,
      },
    ],
    source:
      "risk_register impact_low and impact_high, split by methodology shock_source and calibration status.",
    note:
      "Scenario downside is shown separately from evidence-backed downside so cumulative, stale, or non-incremental percentages are not mistaken for modeled article shocks.",
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
    { label: "Likelihood estimate", value: `${risk.probability || 0}%` },
    { label: "Evidence confidence", value: `${risk.confidence || 0}%` },
    { label: "Evidence signals", value: String(risk.supporting_event_count || 0) },
    { label: "Model basis", value: status.label },
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
    return formatMoney(high);
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
      `Probability: ${opportunity.probability || 0}%`,
      `Confidence: ${opportunity.confidence || 0}%`,
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
}: {
  methodology?: Methodology | null;
  evidence?: any[];
  sectionType?: "risk_register" | "operating_changes" | "watchlist" | "opportunity";
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
  const formula = String(method.formula || "").replace(/_/g, " ").replace(/%/g, "percent");
  const honesty = String(method.honesty_note || "");

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
          <span className="trust-row-label">Confidence</span>
          <div className="trust-row-value">
            <span>
              {signalCount} supporting signal{signalCount !== 1 ? "s" : ""}
            </span>
            {avgQuality > 0 && (
              <span className="trust-row-note">
                Avg source quality {avgQuality}/100
              </span>
            )}
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
