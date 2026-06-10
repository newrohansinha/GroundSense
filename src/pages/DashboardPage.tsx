import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { matchEventsToConnections } from "../services/eventConnectionMatcher";
import { fetchEventsForCompany } from "../services/eventFetcher";
import { scoreEventsForCompany } from "../services/eventScorer";
import { generateBriefForCompany } from "../services/briefService";
import { generateRisksForCompany } from "../services/riskGenerator";
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
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [brief, setBrief] = useState<Brief | null>(null);
  const [risks, setRisks] = useState<Risk[]>([]);
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [actions, setActions] = useState<ActionItem[]>([]);
  const [edges, setEdges] = useState<ExposureEdge[]>([]);
  const [riskSnapshots, setRiskSnapshots] = useState<Snapshot[]>([]);
  const [opportunitySnapshots, setOpportunitySnapshots] = useState<Snapshot[]>(
    []
  );
  const [connections, setConnections] = useState<CompanyConnection[]>([]);
const [impactPaths, setImpactPaths] = useState<ImpactPath[]>([]);

const [matchedConnectionsByItemId, setMatchedConnectionsByItemId] = useState<
  Record<string, MatchedConnectionPath[]>
>({});

const [signalStats, setSignalStats] = useState({
  rawEvents: 0,
  assessedEvents: 0,
  relevantEvents: 0,
}); 
  const [expandedRiskId, setExpandedRiskId] = useState<string | null>(null);
  const [expandedOpportunityId, setExpandedOpportunityId] = useState<
    string | null
  >(null);
  const [showRawEvents, setShowRawEvents] = useState(false);

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



  function getPathMetadata(path: ImpactPath) {
  return getMetadata(path.metadata);
}

function formatPathExposure(path: ImpactPath) {
  const metadata = getPathMetadata(path);

  if (
    path.calibration_status === "needs_calibration" ||
    metadata.display_unit === "needs_calibration"
  ) {
    return "Needs calibration";
  }

  if (metadata.display_unit === "dollars_per_1pct_price_move") {
    return `${formatMoney(path.exposure_high)} / 1% move`;
  }

  if (Number(path.exposure_low || 0) === Number(path.exposure_high || 0)) {
    return formatMoney(path.exposure_high);
  }

  return `${formatMoney(path.exposure_low)}–${formatMoney(path.exposure_high)}`;
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

  const relevantAssessments = assessments.filter(
    (assessment) => assessment.relevant
  );

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
            {busy === "fresh" ? "Fetching..." : "Fetch Fresh Intelligence"}
          </button>
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
            onClick={() =>
              run("connections", () => buildConnectionsForCompany(company!.id))
            }
            disabled={busy !== null}
          >
            {busy === "connections" ? "Building..." : "Build Connections"}
          </button>

          <button
  className="primary-button"
  onClick={() =>
    run("match-connections", () => matchEventsToConnections(company!.id))
  }
  disabled={busy !== null}
>
  {busy === "match-connections"
    ? "Matching..."
    : "Match Events to Connections"}
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
  {busy === "specific-explanations"
    ? "Explaining..."
    : "Generate Specific Explanations"}
</button>
          <button
            className="primary-button"
            onClick={() =>
              run("graph", () => buildExposureGraphForCompany(company!.id))
            }
            disabled={busy !== null}
          >
            {busy === "graph" ? "Building..." : "Build Exposure Graph"}
          </button>

          <button
            className="primary-button"
            onClick={() => run("brief", () => generateBriefForCompany(company!.id))}
            disabled={busy !== null}
          >
            {busy === "brief" ? "Generating..." : "Generate Brief"}
          </button>
        </section>

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
  title="Supporting Signals"
  value={String(signalStats.relevantEvents)}
  subtitle={`${signalStats.assessedEvents} scored · ${signalStats.rawEvents} events in DB`}
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

        <section className="card">
          <div className="card-header">
            <div>
              <p className="eyebrow">Company model</p>
              <h2 className="section-title">{company?.name || "No company"}</h2>
            </div>

            <span className="badge">{company?.industry || "Industry not set"}</span>
          </div>

          <div className="company-grid">
            <Info label="Revenue" value={company?.revenue_range || "Not set"} />
            <Info label="Suppliers" value={getEntities("supplier")} />
            <Info label="Competitors" value={getEntities("competitor")} />
            <Info label="Segments" value={getEntities("customer_segment")} />
            <Info label="Commodities" value={getEntities("commodity")} />
          </div>
        </section>

        

        

        <section className="card">
          <div className="card-header">
            <div>
              <p className="eyebrow">Leadership memo</p>
              <h2 className="section-title">
                {brief?.title || "No brief generated"}
              </h2>
            </div>

            {brief && (
              <span className="badge">
                {new Date(brief.created_at).toLocaleString()}
              </span>
            )}
          </div>

          {!brief ? (
            <p className="muted">
              Generate a brief after risks and opportunities are ready.
            </p>
          ) : (
            <pre className="memo">{executiveMemo}</pre>
          )}
        </section>

        {operatingChanges.length > 0 && (
  <section className="card">
    <div className="card-header">
      <div>
        <p className="eyebrow">Policy / operating changes</p>
        <h2 className="section-title">Operating Changes</h2>
      </div>

      <span className="badge">{operatingChanges.length} items</span>
    </div>

    <p className="muted">
  Relevant business changes that affect planning assumptions but are not
  classified as downside risks.
</p>

    {operatingChanges.map((item) => (
      <OperatingChangeCard
        key={item.id}
        risk={item}
        expanded={expandedRiskId === item.id}
        onToggle={() =>
          setExpandedRiskId(expandedRiskId === item.id ? null : item.id)
        }
        matchedConnections={matchedConnectionsByItemId[item.id] || []}
      />
    ))}
  </section>
)}

<section className="two-column">
  <div className="card">
    <div className="card-header">
      <div>
        <p className="eyebrow">System of record</p>
        <h2 className="section-title">Risk Register</h2>
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
          expanded={expandedRiskId === risk.id}
          onToggle={() =>
            setExpandedRiskId(expandedRiskId === risk.id ? null : risk.id)
          }
          movement={getMovement(risk.risk_title, riskSnapshots, "risk_title")}
          matchedConnections={matchedConnectionsByItemId[risk.id] || []}
        />
      ))
    )}
  </div>

  <div className="card">
    <div className="card-header">
      <div>
        <p className="eyebrow">Commercial upside</p>
        <h2 className="section-title">Opportunities</h2>
      </div>
    </div>

    {opportunities.length === 0 ? (
      <p className="muted">No opportunities generated yet.</p>
    ) : (
      opportunities.map((opportunity) => (
        <OpportunityCard
          key={opportunity.id}
          opportunity={opportunity}
          expanded={expandedOpportunityId === opportunity.id}
          onToggle={() =>
            setExpandedOpportunityId(
              expandedOpportunityId === opportunity.id
                ? null
                : opportunity.id
            )
          }
          movement={getMovement(
            opportunity.title,
            opportunitySnapshots,
            "opportunity_title"
          )}
          matchedConnections={matchedConnectionsByItemId[opportunity.id] || []}
        />
      ))
    )}
  </div>
</section>

{watchlistItems.length > 0 && (
  <section className="card">
    <div className="card-header">
      <div>
        <p className="eyebrow">Monitor</p>
        <h2 className="section-title">Watchlist</h2>
      </div>

      <span className="badge">{watchlistItems.length} items</span>
    </div>

    <p className="muted">
      Relevant items that are directionally mixed, not fully calibrated, or not
      strong enough to treat as modeled downside risks.
    </p>

    {watchlistItems.map((item) => (
      <WatchlistCard
        key={item.id}
        risk={item}
        expanded={expandedRiskId === item.id}
        onToggle={() =>
          setExpandedRiskId(expandedRiskId === item.id ? null : item.id)
        }
        matchedConnections={matchedConnectionsByItemId[item.id] || []}
      />
    ))}
  </section>
)}

        <section className="two-column">
          <div className="card">
            <div className="card-header">
              <div>
                <p className="eyebrow">Workflow</p>
                <h2 className="section-title">Executive Actions</h2>
              </div>
            </div>

            {actions.length === 0 ? (
              <p className="muted">No actions created yet.</p>
            ) : (
              actions.map((action) => (
                <div key={action.id} className="action-row">
                  <div>
                    <p className="action-title">{action.title}</p>
                    <p className="muted">
                      {action.owner || "Unassigned"} · Due{" "}
                      {action.deadline || "not set"} · {action.source_type}
                    </p>

                    {action.expected_benefit && (
                      <p className="small-text">{action.expected_benefit}</p>
                    )}
                  </div>

                  <select
                    value={action.status || "open"}
                    onChange={(event) =>
                      updateActionStatus(action.id, event.target.value)
                    }
                    className="status-select"
                  >
                    <option value="open">Open</option>
                    <option value="in_review">In review</option>
                    <option value="accepted">Accepted</option>
                    <option value="dismissed">Dismissed</option>
                    <option value="completed">Completed</option>
                  </select>
                </div>
              ))
            )}
          </div>

          <div className="card">
            <div className="card-header">
              <div>
                <p className="eyebrow">Exposure graph</p>
                <h2 className="section-title">Relationship Preview</h2>
              </div>

              <span className="badge">
  {edges.length > 0
    ? `${edges.length} edges`
    : `${impactPaths.length} paths`}
</span>
            </div>

            {edges.length > 0 ? (
  edges.slice(0, 12).map((edge) => (
    <div key={edge.id} className="edge-row">
      <span>{edge.from_name}</span>
      <span className="arrow">→</span>
      <span>{edge.to_name}</span>
      <span className="edge-label">{cleanLabel(edge.relationship)}</span>
    </div>
  ))
) : impactPaths.length > 0 ? (
  impactPaths.slice(0, 12).map((path) => (
    <div key={path.id} className="edge-row">
      <span>{path.trigger_name}</span>
      <span className="arrow">→</span>
      <span>{path.affected_name}</span>
      <span className="edge-label">
        {cleanImpactCategoryLabel(path.impact_category, path.trigger_name)}
      </span>
    </div>
  ))
) : (
  <p className="muted">
    Build the exposure graph to see relationships.
  </p>
)}
          </div>
        </section>

        <section className="card">
          <button
            className="secondary-button"
            onClick={() => setShowRawEvents(!showRawEvents)}
          >
            {showRawEvents ? "Hide Raw Events" : "Show Raw Events"}
          </button>

          {showRawEvents && (
            <div className="raw-events-list">
              {events.map((event) => (
                <div key={event.id} className="raw-event">
                  <p className="action-title">{event.title}</p>

                  <p className="muted">
                    {event.source_name || "Unknown"} ·{" "}
                    {event.source_api || "source"} ·{" "}
                    {event.freshness_bucket || "freshness unknown"} · Age{" "}
                    {event.event_age_days ?? "?"} days · Quality{" "}
                    {event.source_quality ?? 50}
                  </p>

                  <p className="small-text">{event.query_text}</p>

                  {event.source_url && (
                    <a
                      href={event.source_url}
                      target="_blank"
                      rel="noreferrer"
                      className="link"
                    >
                      Open source
                    </a>
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

function ExecutiveRiskExplanation({ risk }: { risk: Risk }) {
  const confidence =
    risk.explanation_confidence !== null &&
    risk.explanation_confidence !== undefined
      ? `${risk.explanation_confidence}% confidence`
      : "Executive read";

  const whatChanged =
    risk.what_happened ||
    risk.executive_summary ||
    "No specific explanation generated yet.";

  const whyNow = risk.why_now || null;

  const businessImpact =
    risk.risk_interaction ||
    risk.business_impact ||
    "No operating impact explanation generated yet.";

  return (
    <div className="plain-risk-panel">
      <div className="plain-risk-header">
        <div>
          <p className="eyebrow">Executive read</p>
          <h4 className="detail-title">What changed and why it matters</h4>
        </div>

        <span className="badge">{confidence}</span>
      </div>

      <div className="plain-grid">
        <div className="plain-card">
          <p className="plain-label">What changed</p>
          <p className="plain-text">{whatChanged}</p>
        </div>

        {whyNow && (
          <div className="plain-card">
            <p className="plain-label">Why now</p>
            <p className="plain-text">{whyNow}</p>
          </div>
        )}

        <div className="plain-card">
          <p className="plain-label">Business impact</p>
          <p className="plain-text">{businessImpact}</p>
        </div>
      </div>

      {risk.evidence_summary && (
        <p className="plain-note">
          <b>Evidence quality:</b> {risk.evidence_summary}
        </p>
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

  return (
    <div className="record-card">
      <div className="record-top">
        <div>
          <div className="record-badge-row">
            <span className="orange-badge">
              #{displayRank}{" "}
              {modelStatus.status === "scenario_fallback"
                ? "Scenario Risk"
                : "Risk"}
            </span>

            <ModelStatusBadge methodology={risk.methodology} />
          </div>

          <h3 className="record-title">{risk.risk_title}</h3>
        </div>

        <button className="text-button" onClick={onToggle}>
          {expanded ? "Hide path & evidence" : "View path & evidence"}
        </button>
      </div>

      <div className="mini-grid">
        <Mini
          label="Priority"
          value={`${risk.priority_score || 0}/100`}
          explanation={explainRiskPriority(risk)}
        />

        <Mini label="Movement" value={movement} />

        <Mini
          label="Probability"
          value={`${risk.probability || 0}%`}
          explanation={{
            title: "Risk probability",
            formula: "Stored risk_register.probability",
            inputs: [
              `Probability: ${risk.probability || 0}%`,
              `Confidence: ${risk.confidence || 0}%`,
              `Supporting events: ${risk.supporting_event_count || 0}`,
            ],
            source:
              "Generated by Generate Risks from relevant event assessments.",
            caveat:
              "Probability is modeled likelihood, not a statistical forecast from historical loss data.",
          }}
        />

        <Mini
          label={modelStatus.exposureLabel}
          value={getRiskExposureDisplay(risk)}
          explanation={explainRiskExposure(risk)}
        />
      </div>

      <ExecutiveRiskExplanation risk={risk} />

      <ModelDisclosureNotice risk={risk} />

      <div className="decision-box">
        <p className="plain-label">Decision needed</p>
        <p className="plain-text">
          {risk.decision_required ||
            risk.action_required ||
            "No decision has been stored for this risk."}
        </p>
      </div>

      {expanded && (
        <DetailPanel
          methodology={risk.methodology}
          evidence={risk.evidence_items || []}
          exposurePath={risk.exposure_path || []}
          expectedBenefit={risk.expected_benefit}
          matchedConnections={matchedConnections}
          showModelAssumptions={false}
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
  const relief = getReliefDisplay(risk);
  const explanation = getOperatingChangeExplanation(risk);

  return (
    <div className="record-card operating-change-card">
      <div className="record-top">
        <div>
          <div className="record-badge-row">
            <span className="blue-badge">Operating Change</span>
            <ModelStatusBadge methodology={risk.methodology} />
          </div>

          <h3 className="record-title">{risk.risk_title}</h3>
        </div>

        <button className="text-button" onClick={onToggle}>
          {expanded ? "Hide evidence" : "View evidence"}
        </button>
      </div>

      <div className="mini-grid">
        <Mini
          label="Direction"
          value={formatIssueDirection(risk.issue_direction)}
        />

        <Mini
          label="Residual exposure"
          value={getResidualExposureDisplay(risk)}
          explanation={explainRiskExposure(risk)}
        />

        <Mini
          label="Relief vs prior state"
          value={relief || "N/A"}
          explanation={
            relief
              ? {
                  title: "Relief versus prior state",
                  formula:
                    "Relief = prior modeled burden - current modeled burden",
                  inputs: [
                    {
                      label: "Current residual exposure",
                      value: getResidualExposureDisplay(risk),
                    },
                    {
                      label: "Relief versus prior state",
                      value: relief,
                    },
                  ],
                  source:
                    "Calculated from the prior state and current state found in source text.",
                  note:
                    "This is shown separately because the item is not classified as a new downside risk.",
                }
              : null
          }
        />

        <Mini label="Signals" value={String(risk.supporting_event_count || 0)} />
      </div>

      <div className="decision-box">
        <p className="plain-label">Interpretation</p>
        <p className="plain-text compact-explanation">{explanation}</p>
      </div>

      <div className="decision-box">
        <p className="plain-label">Decision needed</p>
        <p className="plain-text">
          {risk.decision_required ||
            risk.action_required ||
            "Review whether this change affects sourcing, pricing, or planning assumptions."}
        </p>
      </div>

      {expanded && (
        <DetailPanel
          methodology={risk.methodology}
          evidence={risk.evidence_items || []}
          exposurePath={risk.exposure_path || []}
          expectedBenefit={risk.expected_benefit}
          matchedConnections={matchedConnections}
          showModelAssumptions={false}
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

  return (
    <div className="record-card watchlist-card">
      <div className="record-top">
        <div>
          <div className="record-badge-row">
            <span className="gray-badge">Watchlist</span>
            <ModelStatusBadge methodology={risk.methodology} />
          </div>

          <h3 className="record-title">{risk.risk_title}</h3>
        </div>

        <button className="text-button" onClick={onToggle}>
          {expanded ? "Hide evidence" : "View evidence"}
        </button>
      </div>

      <div className="decision-box">
        <p className="plain-label">Why this is on watch</p>
        <p className="plain-text compact-explanation">
          {watchlistExplanation}
        </p>
      </div>

      <div className="mini-grid">
        <Mini
          label="Direction"
          value={formatIssueDirection(risk.issue_direction || "uncertain")}
        />

        <Mini label="Confidence" value={`${risk.confidence || 0}%`} />

        <Mini label="Signals" value={String(risk.supporting_event_count || 0)} />

        <Mini
          label="Scenario sensitivity"
          value={getWatchlistSensitivityDisplay(risk)}
          explanation={explainRiskExposure(risk)}
        />
      </div>

      {expanded && (
        <>
          <DetailPanel
            methodology={risk.methodology}
            evidence={risk.evidence_items || []}
            exposurePath={risk.exposure_path || []}
            expectedBenefit={risk.expected_benefit}
            matchedConnections={matchedConnections}
            showModelAssumptions={false}
          />

          <div className="decision-box">
            <p className="plain-label">What would upgrade this?</p>
            <p className="plain-text">{getWatchlistUpgradeText(risk)}</p>
          </div>
        </>
      )}
    </div>
  );
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
  return (
    <div className="record-card">
      <div className="record-top">
        <div>
          <span className="green-badge">
            #{opportunity.opportunity_rank || "-"} Opportunity
          </span>
          <h3 className="record-title">{opportunity.title}</h3>
        </div>

        <button className="text-button" onClick={onToggle}>
          {expanded ? "Hide details" : "View methodology"}
        </button>
      </div>

      <p className="record-summary">{opportunity.summary}</p>

      <div className="mini-grid">
        <Mini
          label="Priority"
          value={`${opportunity.priority_score || 0}/100`}
          explanation={explainOpportunityPriority(opportunity)}
        />

        <Mini label="Movement" value={movement} />

        <Mini
          label="Probability"
          value={`${opportunity.probability || 0}%`}
          explanation={{
            title: "Opportunity probability",
            formula: "Stored opportunity_register.probability",
            inputs: [
              `Probability: ${opportunity.probability || 0}%`,
              `Confidence: ${opportunity.confidence || 0}%`,
              `Supporting events: ${opportunity.supporting_event_count || 0}`,
            ],
            source:
              "Generated by Generate Opportunities from relevant event assessments.",
            caveat:
              "Probability is modeled likelihood of commercial capture, not booked pipeline.",
          }}
        />

        <Mini
          label="Upside"
          value={`${formatMoney(opportunity.revenue_low)}–${formatMoney(
            opportunity.revenue_high
          )}`}
          explanation={explainOpportunityExposure(opportunity)}
        />
      </div>

      <div className="decision-box">
  <p className="plain-label">Decision needed</p>
  <p className="plain-text">
    {opportunity.decision_required ||
      opportunity.action_required ||
      "No decision has been stored for this opportunity."}
  </p>
</div>

      {expanded && (
        <DetailPanel
  methodology={opportunity.methodology}
  evidence={opportunity.evidence_items || []}
  exposurePath={opportunity.exposure_path || []}
  expectedBenefit={opportunity.expected_benefit}
  matchedConnections={matchedConnections}
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
  showModelAssumptions = false,
}: {
  methodology?: Methodology | null;
  evidence: EvidenceItem[];
  exposurePath: any;
  expectedBenefit?: string | null;
  matchedConnections?: MatchedConnectionPath[];
  showModelAssumptions?: boolean;
}) {
  const method: any = methodology || {};

  function pickNumber(values: any[], fallback = 0) {
    for (const value of values) {
      const n = Number(value);
      if (Number.isFinite(n) && n > 0) return n;
    }

    return fallback;
  }

  function pickText(values: any[], fallback = "N/A") {
    for (const value of values) {
      const text = String(value || "").trim();
      if (text && text !== "null" && text !== "undefined") return text;
    }

    return fallback;
  }

  function avg(values: number[]) {
    const clean = values.filter((value) => Number.isFinite(value) && value > 0);
    if (clean.length === 0) return 0;
    return clean.reduce((sum, value) => sum + value, 0) / clean.length;
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

  const averageEvidenceQuality = Math.round(
    avg(normalizedEvidence.map((item: any) => Number(item.source_quality || 0)))
  );

  const normalizedMethodology: any = {
    ...method,

    base_exposure_type: pickText(
      [
        method.base_exposure_type,
        method.baseType,
        method.base_type,
        method.base,
      ],
      "risk_exposure"
    ),

    base_exposure_value: pickNumber(
      [
        method.base_exposure_value,
        method.baseExposure,
        method.base_exposure,
        method.baseExposureAmount,
        method?.calibration_inputs?.steel_spend,
        method?.calibration_inputs?.cogs,
        method?.calibration_inputs?.manufacturing_revenue,
        method?.calibration_inputs?.construction_revenue,
        method.highEstimate,
        method.high_estimate,
      ],
      0
    ),

    average_source_quality: Math.round(
      pickNumber(
        [
          method.average_source_quality,
          method.sourceQuality,
          method.source_quality,
          averageEvidenceQuality,
        ],
        0
      )
    ),

    supporting_signal_count: Math.round(
      pickNumber(
        [
          method.supporting_signal_count,
          method.signalCount,
          method.signals,
          normalizedEvidence.length,
        ],
        0
      )
    ),

    evidence_multiplier: pickNumber(
      [method.evidence_multiplier, method.evidenceMultiplier],
      1
    ),

    quality_multiplier: pickNumber(
      [method.quality_multiplier, method.qualityMultiplier],
      1
    ),

    final_low: pickNumber(
      [method.final_low, method.lowEstimate, method.low_estimate],
      0
    ),

    final_high: pickNumber(
      [method.final_high, method.highEstimate, method.high_estimate],
      0
    ),
  };

  const shock = getMethodologyShock(method);
const calculationInputs = getMethodologyCalculationInputs(method);

const passThroughPct =
  Number(calculationInputs.pass_through_pct) ||
  Number(calculationInputs.passThroughPct) ||
  0;

const unpassedCostPct =
  Number(calculationInputs.unpassed_cost_pct) ||
  Number(calculationInputs.unpassedCostPct) ||
  0;

const repricingLagDays =
  Number(calculationInputs.repricing_lag_days) ||
  Number(calculationInputs.repricingLagDays) ||
  0;
  const safeExposurePath = Array.isArray(exposurePath)
    ? exposurePath
    : exposurePath
      ? [exposurePath]
      : [];

  return (
    <div className="detail-panel">
   <div className="path-toggle-header">
  <h4 className="detail-title">Exposure Path</h4>

  <div className="path-toggle-buttons">
    <button
  type="button"
  className="path-toggle-button active"
>
  Mapped connection
</button>

    <details className="modeled-path-details">
      <summary className="path-toggle-button">
        Modeled path
      </summary>

      <div className="modeled-path-body">
        {safeExposurePath.length === 0 ? (
          <p className="muted">No modeled exposure path available.</p>
        ) : (
          <LayeredPath nodes={safeExposurePath} />
        )}
      </div>
    </details>
  </div>
</div>

{matchedConnections.length === 0 ? (
  <div className="evidence-row">
    <p className="muted">
      No matched connection path found yet. Showing the modeled exposure path instead.
    </p>

    {safeExposurePath.length === 0 ? (
      <p className="muted">No exposure path available.</p>
    ) : (
      <LayeredPath nodes={safeExposurePath} />
    )}
  </div>
) : (
  matchedConnections.slice(0, 3).map((connection) => (
    <div key={connection.id} className="evidence-row">
      <p className="action-title">
        {connection.trigger_name || "Unknown trigger"} →{" "}
        {connection.affected_name || "Unknown affected area"}
      </p>

      <p className="muted">
        {cleanImpactCategoryLabel(
  connection.impact_category,
  connection.trigger_name
)} · Priority{" "}
        {connection.priority_score || 0} · Weight{" "}
        {Math.round(Number(connection.impact_weight || 0) * 100)}%
      </p>

      {connection.path_nodes && connection.path_nodes.length > 0 && (
        <LayeredPath nodes={connection.path_nodes} />
      )}
    </div>
  ))
)}
{showModelAssumptions && (
  <details className="advanced-model-details">
  <summary className="advanced-summary">Show model assumptions</summary>

  <div className="advanced-model-body">
    <h4 className="detail-title">Methodology</h4>

    {!methodology ? (
      <p className="muted">No methodology available.</p>
    ) : (
      <>
        <div className="method-grid">
          <Mini
            label="Base exposure"
            value={formatMoney(normalizedMethodology.base_exposure_value)}
            explanation={explainMethodologyField(
              "Base exposure",
              formatMoney(normalizedMethodology.base_exposure_value),
              normalizedMethodology
            )}
          />

          <Mini
  label={shock.isExplicit ? "Article shock" : "Scenario shock"}
  value={shock.displayRange}
            explanation={{
  title: shock.isExplicit ? "Article shock" : "Scenario shock",
  formula: shock.isExplicit
    ? "Only percentages verified in stored article text can enter the model."
    : "No new explicit percentage was verified, so scenario assumptions are used.",
  inputs: [
    {
      label: "Shock value",
      value: shock.displayRange,
    },
    {
      label: "Basis",
      value: shock.basis,
    },
  ],
  source: shock.isExplicit
    ? "Verified against raw event title, description, and article body text."
    : "Scenario fallback used because no new explicit percentage was found.",
}}
          />

          <Mini
            label="Low estimate"
            value={formatMoney(normalizedMethodology.final_low)}
            explanation={explainMethodologyField(
              "Low estimate",
              formatMoney(normalizedMethodology.final_low),
              normalizedMethodology
            )}
          />

          <Mini
            label="High estimate"
            value={formatMoney(normalizedMethodology.final_high)}
            explanation={explainMethodologyField(
              "High estimate",
              formatMoney(normalizedMethodology.final_high),
              normalizedMethodology
            )}
          />
        </div>

        <div className="method-summary-box">
          <p className="plain-label">Model summary</p>

          <p className="plain-text">
            {normalizedMethodology.formula ||
              "Exposure was calculated from calibrated company inputs."}
          </p>

          <p className="small-text">
            Base: {formatMoney(normalizedMethodology.base_exposure_value)} ·
            Shock: {shock.displayRange}
            {passThroughPct > 0
              ? ` · Pass-through: ${(passThroughPct * 100).toFixed(1)}%`
              : ""}
            {unpassedCostPct > 0
              ? ` · Unpassed: ${(unpassedCostPct * 100).toFixed(1)}%`
              : ""}
            {repricingLagDays > 0
              ? ` · Repricing lag: ${repricingLagDays.toFixed(0)} days`
              : ""}
          </p>

          <p className="small-text">
            <b>Basis:</b> {shock.basis}
          </p>

          {method.honesty_note && (
            <p className="small-text">
              <b>Note:</b> {method.honesty_note}
            </p>
          )}

          {shock.auditBasis && shock.auditBasis !== shock.basis && (
            <details className="methodology-audit">
              <summary>Show source extraction audit</summary>
              <p className="small-text">{shock.auditBasis}</p>
            </details>
          )}
        </div>
      </>
    )}
  </div>
  </details>
)}

      {showModelAssumptions && expectedBenefit && (
  <>
    <h4 className="detail-title">Expected Benefit</h4>
    <p className="small-text">{expectedBenefit}</p>
  </>
)}

      <h4 className="detail-title">Evidence</h4>

      {normalizedEvidence.length === 0 ? (
        <p className="muted">No paired evidence available.</p>
      ) : (
        normalizedEvidence.slice(0, 5).map((item: any, index: number) => (
          <div key={`${item.title}-${index}`} className="evidence-row">
            <p className="action-title">{item.title}</p>

            <p className="muted">
  {item.source || "Unknown source"} · {item.source_tier || "unknown"} ·
  Score {clampScore(item.display_score)}/100 · Quality{" "}
  {clampScore(item.source_quality)}/100 · {item.display_age_label}
</p>

            {item.url && (
              <a
                href={item.url}
                target="_blank"
                rel="noreferrer"
                className="link"
              >
                Open source
              </a>
            )}
          </div>
        ))
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
function clampNumber(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
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

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="info-label">{label}</p>
      <p className="info-value">{value || "Not specified"}</p>
    </div>
  );
}
function renderExplanationInput(input: ExplanationInput, index: number) {
  if (typeof input === "string") {
    return <span key={`${input}-${index}`}>• {input}</span>;
  }

  return (
    <span key={`${input.label}-${index}`}>
      • {input.label}: {input.value}
    </span>
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
      label: "Scenario fallback",
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

function getScenarioAssumptionText(methodology?: Methodology | null) {
  const inputs = getMethodologyCalculationInputs(methodology || {});
  const scenario = getMetadata(inputs.scenario_assumptions);

  const low = Number(scenario.low);
  const mid = Number(scenario.mid);
  const high = Number(scenario.high);

  if (
    Number.isFinite(low) &&
    Number.isFinite(mid) &&
    Number.isFinite(high) &&
    low > 0 &&
    mid > 0 &&
    high > 0
  ) {
    return `Scenario assumptions: low ${(low * 100).toFixed(
      1
    )}%, mid ${(mid * 100).toFixed(1)}%, high ${(high * 100).toFixed(1)}%.`;
  }

  return "Scenario assumptions were used because no usable new percentage was verified.";
}

function getIssueDisclosureText(risk: Risk) {
  const status = getIssueModelStatus(risk.methodology);
  const rejectedValues = formatRejectedShockValuesForRisk(risk);

  if (status.status === "evidence_backed") {
    const shock = getMethodologyShock(risk.methodology || {});

    return `${shock.displayValue} was taken from verified article text.`;
  }

  if (status.status === "scenario_fallback") {
    if (rejectedValues) {
      return `Found ${rejectedValues} in the evidence, but rejected it as cumulative, baseline, stale, or not clearly incremental. GroundSense used scenario assumptions instead.`;
    }

    return "No usable new explicit percentage was found in the evidence. GroundSense used scenario assumptions instead.";
  }

  if (status.status === "needs_calibration") {
    return getMissingCalibrationText(risk);
  }

  return "";
}

function ModelStatusBadge({
  methodology,
}: {
  methodology?: Methodology | null;
}) {
  const status = getIssueModelStatus(methodology);

  return <span className={status.className}>{status.label}</span>;
}

function ModelDisclosureNotice({ risk }: { risk: Risk }) {
  const status = getIssueModelStatus(risk.methodology);

  if (
    status.status !== "scenario_fallback" &&
    status.status !== "needs_calibration"
  ) {
    return null;
  }

  return (
    <div className="model-disclosure-notice">
      <span className={status.className}>{status.label}</span>

      <p>{getIssueDisclosureText(risk)}</p>

      {status.status === "scenario_fallback" && (
        <p className="model-disclosure-subtext">
          {getScenarioAssumptionText(risk.methodology)}
        </p>
      )}
    </div>
  );
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
function getWatchlistSensitivityDisplay(risk: Risk) {
  const status = getIssueModelStatus(risk.methodology);

  if (status.status === "needs_calibration") {
    return getMissingCalibrationText(risk).replace("Missing calibration: ", "");
  }

  if (status.status === "scenario_fallback") {
    return "Scenario only";
  }

  if (
    risk.methodology?.calibration_status === "needs_calibration" ||
    risk.methodology?.formula_status === "not_calculated"
  ) {
    return "Not modeled";
  }

  return `${getResidualExposureDisplay(risk)} sensitivity`;
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
  return joinDistinctSentences(
    [
      risk.exposure_interpretation,
      risk.business_impact,
      risk.risk_interaction,
      risk.executive_summary,
      risk.what_happened,
      getOperatingChangePlanningSentence(risk),
    ],
    2
  );
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

function extractPathOwner(path: ImpactPath) {
  const metadata = getMetadata(path.metadata);
  return metadata?.owner || null;
}
function toNumber(value: any, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function firstNumber(values: any[], fallback = 0) {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return n;
  }

  return fallback;
}

function firstText(values: any[], fallback = "N/A") {
  for (const value of values) {
    const text = String(value || "").trim();
    if (text && text !== "null" && text !== "undefined") return text;
  }

  return fallback;
}

function average(values: number[]) {
  const clean = values.filter((value) => Number.isFinite(value) && value > 0);
  if (clean.length === 0) return 0;
  return clean.reduce((sum, value) => sum + value, 0) / clean.length;
}

function normalizeEvidenceItems(risk: any) {
  const evidence =
    risk?.evidence_items ||
    risk?.evidence ||
    risk?.metadata?.evidence ||
    [];

  if (Array.isArray(evidence)) return evidence;

  return [];
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

function explainPathExposure(path: ImpactPath): NumberExplanation {
  const metadata = getMetadata(path.metadata);

  const calculationSteps = Array.isArray(metadata.calculation_steps)
    ? metadata.calculation_steps
    : [];

  const sourceFields = Array.isArray(metadata.source_fields)
    ? metadata.source_fields
    : metadata.source_field
      ? [metadata.source_field]
      : [];

  const displayUnit = metadata.display_unit || "absolute_dollars";
  const calibrationStatus = path.calibration_status || "unknown";

  if (
    calibrationStatus === "needs_calibration" ||
    displayUnit === "needs_calibration"
  ) {
    return {
      title: "Exposure calculation",
      formula: "No dollar value calculated because required real inputs are missing.",
      inputs: [
        `Status: NEEDS CALIBRATION`,
        `Impact type: ${cleanLabel(path.impact_category)}`,
        `Trigger: ${path.trigger_name}`,
        `Affected area: ${path.affected_name}`,
        ...(Array.isArray(metadata.missing_inputs)
          ? metadata.missing_inputs.map((input: string) => `Missing input: ${input}`)
          : ["Missing input: not stored"]),
        `Displayed value: Needs calibration`,
      ],
      source: metadata.source || "company_calibration",
      caveat:
        metadata.honesty_note ||
        "GroundSense intentionally does not invent a dollar estimate when required company inputs are missing.",
    };
  }

  const low = Number(path.exposure_low || 0);
  const high = Number(path.exposure_high || 0);

  let displayedValue = `${formatMoney(low)}–${formatMoney(high)}`;

  if (displayUnit === "dollars_per_1pct_price_move") {
    displayedValue = `${formatMoney(high)} per 1% move`;
  } else if (low === high) {
    displayedValue = formatMoney(high);
  }

  return {
    title: "Exposure calculation",
    formula: metadata.formula || "Calculated exposure from stored company calibration inputs.",
    inputs: [
      `Status: ${calibrationStatus.toUpperCase()}`,
      `Displayed value: ${displayedValue}`,
      `Impact type: ${cleanLabel(path.impact_category)}`,
      `Trigger: ${path.trigger_name}`,
      `Affected area: ${path.affected_name}`,
      ...(sourceFields.length > 0
        ? sourceFields.map((field: string) => `Source field: ${field}`)
        : ["Source field: not stored"]),
      ...(calculationSteps.length > 0
        ? ["Calculation:", ...calculationSteps.map((step: string) => `  ${step}`)]
        : [
            `Calculation:`,
            `  Low stored value = ${formatMoney(low)}`,
            `  High stored value = ${formatMoney(high)}`,
          ]),
    ],
    source:
      metadata.source_table ||
      "company_calibration and related company exposure tables",
    caveat:
      metadata.honesty_note ||
      "This value is calculated from stored company inputs. It is not a generic AI guess.",
  };
}

function explainPathWeight(path: ImpactPath): NumberExplanation {
  const metadata = getMetadata(path.metadata);
  const weight = Number(path.impact_weight || 0);
  const calibrationStatus = path.calibration_status || "unknown";

  let rule = "Default relationship confidence";
  let reason = "The model assigned a standard confidence value for this path type.";

  if (calibrationStatus === "needs_calibration") {
    rule = "Needs calibration fallback";
    reason =
      "Required inputs are missing, so the path is kept visible but receives a low confidence weight.";
  } else if (path.impact_category === "commodity_pass_through_sensitivity") {
    rule = "Commodity pass-through path";
    reason =
      "This path uses real commodity spend, pass-through coverage, and repricing lag, so it receives a high operating-confidence weight.";
  } else if (path.impact_category === "competitor_revenue_risk") {
    rule = "Competitor revenue risk path";
    reason =
      "This path uses segment revenue plus historical lost quote rate or churn rate, so it receives a medium-high confidence weight.";
  } else if (path.impact_category === "service_level_revenue_leakage") {
    rule = "Service leakage path";
    reason =
      "This path uses segment revenue, backorder rate, and cancellation leakage, so it receives a medium-high confidence weight.";
  } else if (path.impact_category === "supplier_expedite_cost") {
    rule = "Supplier expedite cost path";
    reason =
      "This path uses supplier spend and historical expedite premium, so it receives a high operating-confidence weight.";
  }

  return {
    title: "Path weight",
    formula:
      "Weight = confidence/relevance score for this impact path. It does not change the dollar exposure calculation.",
    inputs: [
      `Status: ${calibrationStatus.toUpperCase()}`,
      `Stored weight: ${Math.round(weight * 100)}%`,
      `Rule: ${rule}`,
      `Reason: ${reason}`,
      `Impact type: ${cleanLabel(path.impact_category)}`,
      `Owner: ${metadata.owner || "Not stored"}`,
      `Used for: ranking and trust display`,
      `Not used for: multiplying the exposure number`,
    ],
    source:
      "Generated in build-company-connections from the path type and whether required calibration inputs exist.",
    caveat:
      "Weight is not probability and not financial impact. It is a model confidence/relevance indicator.",
  };
}

function explainPathPriority(path: ImpactPath): NumberExplanation {
  const highExposure = Number(path.exposure_high || 0);
  const weight = Number(path.impact_weight || 0);
  const score = Number(path.priority_score || 0);
  const calibrationStatus = path.calibration_status || "unknown";

  const completeness =
    calibrationStatus === "calculated"
      ? 1
      : calibrationStatus === "partially_calibrated"
        ? 0.5
        : 0;

  const strengthScore = Math.round(completeness * 30);

  return {
    title: "Priority score",
    formula:
      "Priority = 35 + exposureScore + completenessScore, capped between 35 and 95.",
    inputs: [
      `Status: ${calibrationStatus.toUpperCase()}`,
      `Stored priority: ${score}/100`,
      `High exposure used: ${formatMoney(highExposure)}`,
      `Completeness score: ${completeness} × 30 = ${strengthScore}`,
      `If exposure and revenue exist: exposureScore = min((exposure / annual revenue) × 1200, 45)`,
      `If inputs are missing: priority defaults near 35`,
      `Impact weight shown separately: ${Math.round(weight * 100)}%`,
    ],
    source:
      "Calculated by priorityScore() inside build-company-connections.",
    caveat:
      "Priority is only for ranking executive attention. It is not probability, not confidence, and not a financial forecast.",
  };
}

function explainRiskPriority(risk: Risk): NumberExplanation {
  return {
    title: "Risk priority",
    formula:
      "risk priority combines impact range, probability, confidence, severity, evidence count, and source quality",
    inputs: [
      `Stored priority_score: ${risk.priority_score || 0}/100`,
      `Probability: ${risk.probability || 0}%`,
      `Confidence: ${risk.confidence || 0}%`,
      `Supporting events: ${risk.supporting_event_count || 0}`,
      `Severity: ${risk.severity || "Not set"}`,
    ],
    source: "risk_register.priority_score generated by Generate Risks.",
    caveat:
      "This is a ranking number used to order executive attention.",
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
function humanizeFormula(value: unknown) {
  return String(value || "")
    .replace(/_/g, " ")
    .replace(/%/g, "percent")
    .replace(/\s+/g, " ")
    .trim();
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
function explainMethodologyField(
  label: string,
  displayedValue: string,
  methodology: any
): NumberExplanation {
  const key = String(label || "").toLowerCase();

  const baseType =
    methodology?.base_exposure_type ||
    methodology?.baseType ||
    methodology?.base_type ||
    "Not stored";

  const baseExposure =
    Number(
      methodology?.base_exposure_value ||
        methodology?.baseExposure ||
        methodology?.base_exposure ||
        0
    ) || 0;

  const sourceQuality =
    Number(
      methodology?.average_source_quality ||
        methodology?.sourceQuality ||
        methodology?.source_quality ||
        0
    ) || 0;

  const signalCount =
    Number(
      methodology?.supporting_signal_count ||
        methodology?.signalCount ||
        methodology?.signals ||
        0
    ) || 0;

  const evidenceMultiplier =
    Number(
      methodology?.evidence_multiplier ||
        methodology?.evidenceMultiplier ||
        1
    ) || 1;

  const qualityMultiplier =
    Number(
      methodology?.quality_multiplier ||
        methodology?.qualityMultiplier ||
        1
    ) || 1;

  const lowEstimate =
    Number(
      methodology?.final_low ||
        methodology?.lowEstimate ||
        methodology?.low_estimate ||
        0
    ) || 0;

  const highEstimate =
    Number(
      methodology?.final_high ||
        methodology?.highEstimate ||
        methodology?.high_estimate ||
        0
    ) || 0;

  const coreFormula =
    methodology?.formula ||
    methodology?.calculation_formula ||
    "Risk-specific exposure formula stored in methodology JSON.";

  const calibration = methodology?.calibration_inputs || {};

  const calibrationBullets = [
    calibration.annual_revenue
      ? `Annual revenue = ${formatMoney(calibration.annual_revenue)}`
      : null,
    calibration.manufacturing_revenue
      ? `Manufacturing revenue = ${formatMoney(calibration.manufacturing_revenue)}`
      : null,
    calibration.construction_revenue
      ? `Construction revenue = ${formatMoney(calibration.construction_revenue)}`
      : null,
    calibration.steel_spend
      ? `Steel spend = ${formatMoney(calibration.steel_spend)}`
      : null,
    calibration.cogs ? `COGS = ${formatMoney(calibration.cogs)}` : null,
    calibration.pass_through_coverage_pct
      ? `Pass-through coverage = ${calibration.pass_through_coverage_pct}%`
      : null,
    calibration.lost_quote_rate_pct
      ? `Lost quote rate = ${calibration.lost_quote_rate_pct}%`
      : null,
    calibration.customer_churn_rate_pct
      ? `Customer churn rate = ${calibration.customer_churn_rate_pct}%`
      : null,
  ].filter(Boolean) as string[];

  if (key.includes("base type")) {
    return {
      title: "Base type",
      formula: "Select the financial driver used for this risk category.",
      displayedValue,
      bullets: [
        `Selected base type = ${baseType}`,
        "Commodity risk usually uses commodity spend, steel spend, COGS, or estimated exposed cost.",
        "Competitor risk usually uses affected customer segment revenue.",
        "Demand risk usually uses affected customer segment revenue.",
        "Supply chain risk usually uses COGS or estimated cost base.",
      ],
      source: "Risk methodology JSON and company calibration inputs.",
    };
  }

  if (key.includes("base exposure")) {
    return {
      title: "Base exposure",
      formula: "Base exposure = selected calibrated financial base before multipliers.",
      displayedValue,
      bullets: [
        `Base type = ${baseType}`,
        `Base exposure = ${formatMoney(baseExposure)}`,
        ...(calibrationBullets.length > 0
          ? calibrationBullets
          : ["Calibration sub-inputs were not stored on this row."]),
      ],
      source: "company_calibration and risk methodology JSON.",
    };
  }

  if (key.includes("source quality")) {
    return {
      title: "Average source quality",
      formula: "Average source quality = avg(source quality score for evidence items).",
      displayedValue,
      bullets: [
        `Average source quality = ${sourceQuality}/100`,
        `Supporting signals = ${signalCount}`,
        "Tier 1 sources like Reuters, government, or major institutions usually score around 90–95.",
        "Tier 2 industry sources usually score around 80–85.",
        "Unclassified sources usually score around 50.",
        "Blocked or low-quality sources should not enter risk generation.",
      ],
      source: "evidence_items.source_quality or methodology.source_quality.",
    };
  }

  if (key.includes("signals")) {
    return {
      title: "Supporting signals",
      formula: "Supporting signals = count(clean evidence items used for this risk).",
      displayedValue,
      bullets: [
        `Clean supporting signals = ${signalCount}`,
        "Clean evidence excludes blocked sources, stock-ownership articles, valuation spam, and unrelated articles.",
      ],
      source: "evidence_items length, supporting_event_count, or methodology.signals.",
    };
  }

  if (key.includes("evidence mult")) {
    return {
      title: "Evidence multiplier",
      formula: "Evidence multiplier = min(1.18, 1 + log10(signal_count + 1) × 0.08).",
      displayedValue,
      bullets: [
        `Signal count = ${signalCount}`,
        `Evidence multiplier = ${evidenceMultiplier}`,
        "More independent supporting signals slightly increase modeled exposure.",
        "The multiplier is capped so article volume cannot overinflate the estimate.",
      ],
      source: "methodology.evidence_multiplier.",
    };
  }

  if (key.includes("quality mult")) {
    return {
      title: "Quality multiplier",
      formula: "Quality multiplier = clamp(avg_source_quality / 80, 0.75, 1.15).",
      displayedValue,
      bullets: [
        `Average source quality = ${sourceQuality}/100`,
        `Quality multiplier = ${qualityMultiplier}`,
        "Higher-quality evidence slightly increases the estimate.",
        "Lower-quality evidence reduces the estimate.",
        "The multiplier is capped to avoid overconfidence.",
      ],
      source: "methodology.quality_multiplier.",
    };
  }

  if (key.includes("low estimate")) {
    return {
      title: "Low estimate",
      formula: "Low estimate = low base exposure estimate × evidence multiplier × quality multiplier.",
      displayedValue,
      bullets: [
        `Core model = ${coreFormula}`,
        `Base exposure = ${formatMoney(baseExposure)}`,
        `Evidence multiplier = ${evidenceMultiplier}`,
        `Quality multiplier = ${qualityMultiplier}`,
        `Low estimate = ${formatMoney(lowEstimate)}`,
      ],
      source: "methodology.low_estimate or risk impact_low.",
    };
  }

  if (key.includes("high estimate")) {
    return {
      title: "High estimate",
      formula: "High estimate = high base exposure estimate × evidence multiplier × quality multiplier.",
      displayedValue,
      bullets: [
        `Core model = ${coreFormula}`,
        `Base exposure = ${formatMoney(baseExposure)}`,
        `Evidence multiplier = ${evidenceMultiplier}`,
        `Quality multiplier = ${qualityMultiplier}`,
        `High estimate = ${formatMoney(highEstimate)}`,
      ],
      source: "methodology.high_estimate or risk impact_high.",
    };
  }

  return {
    title: label,
    formula: "No field-specific formula was found.",
    displayedValue,
    bullets: [
      `Base type = ${baseType}`,
      `Base exposure = ${formatMoney(baseExposure)}`,
      `Supporting signals = ${signalCount}`,
      `Average source quality = ${sourceQuality}/100`,
    ],
    source: "Risk methodology JSON.",
  };
}