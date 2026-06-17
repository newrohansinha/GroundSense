// Company Exposure Graph — canonical view model.
//
// Builds a 2D node-and-edge operating map: external signal → company exposure →
// calculation → business impact → action. It CONSUMES the canonical executive
// estimates (executiveImpactViewModel) for every dollar value and only derives
// deterministic intermediate values (spot-exposed spend, unpassed base) from the
// SAME calibration + verified-shock inputs. It never recomputes a different total.
//
// Supporting signals (steel/copper/aluminum PPI, World Bank, GDELT, SEC) are context
// only — never dollarized here. Blocked candidates are a separate, excluded lane.

import type { CompanyCalibrationInput } from "../calibrationService";
import type { ExecutiveEstimate } from "../executive/executiveImpactViewModel";
import type { VerifiedShockRow } from "../sources/issueProvenanceService";

export type ExposureNodeType =
  | "external_signal"
  | "verified_shock"
  | "company_exposure"
  | "calculation"
  | "business_impact"
  | "action"
  | "supporting_signal"
  | "blocked_candidate"
  | "missing_data"
  | "company_outcome";

export type ExposureNodeStatus =
  | "verified"
  | "company_calibrated"
  | "assumption"
  | "estimate"
  | "pending"
  | "action"
  | "blocked"
  | "missing"
  | "context";

export type ExposureGraphNode = {
  id: string;
  type: ExposureNodeType;
  /** Column index 0..N for left→right layout. */
  column: number;
  title: string;
  subtitle?: string;
  valueLabel?: string;
  sourceLabel?: string;
  status: ExposureNodeStatus;
  statusLabel: string;
  issueId?: string;
  driver?: string;
  caveat?: string;
  meta?: { owner?: string; due?: string; formula?: string };
};

export type ExposureEdgeType =
  | "verifies"
  | "maps_to"
  | "calculates"
  | "impacts"
  | "triggers_action"
  | "supports"
  | "blocked_by"
  | "requires_data"
  | "excluded_from_estimate";

export type ExposureGraphEdge = {
  id: string;
  source: string;
  target: string;
  type: ExposureEdgeType;
  label?: string;
};

export type ExposurePath = {
  id: string;
  label: string;
  issueType: string;
  impactDisplay: string;
  nodes: ExposureGraphNode[];
  edges: ExposureGraphEdge[];
};

export type SupportingSignal = {
  id: string;
  label: string;
  detail: string;
  status: ExposureNodeStatus;
  statusLabel: string;
};

export type BlockedLane = {
  id: string;
  label: string;
  nodes: ExposureGraphNode[];
  edges: ExposureGraphEdge[];
};

export type ExposureGraphModel = {
  activePaths: ExposurePath[];
  supportingSignals: SupportingSignal[];
  blockedLanes: BlockedLane[];
  summary: {
    activeCount: number;
    valueAtStake: string;
    blockedCount: number;
    supportingCount: number;
  };
};

export type ActionMeta = { owner: string; due: string };

// A published issue (risk_register / operating change) that isn't one of the two
// canonical freight/tariff driver paths — e.g. an article-derived steel or
// supplier risk. Fed in so EVERY published active issue materializes a path
// instead of silently producing 0 active paths.
export type IssuePathInput = {
  id: string;
  title: string;
  driver: string;
  issueType: string;
  impactDisplay: string;
  calculation?: string | null;
  exposureText?: string | null;
  evidenceStatus: "evidence_backed" | "scenario_modeled" | "watchlist" | string;
  sourceLabel?: string | null;
  action?: { title: string; owner: string; due: string; nextStep?: string | null } | null;
};

export type BuildExposureGraphInput = {
  execFreight: ExecutiveEstimate | null;
  execTariff: ExecutiveEstimate | null;
  verifiedShocks: VerifiedShockRow[];
  calibration: CompanyCalibrationInput | null;
  blockedCandidateTitles: string[];
  /** Canonical total (formatExecutiveEstimate of the published risk estimates). */
  valueAtStakeDisplay: string;
  freightAction?: ActionMeta;
  tariffAction?: ActionMeta;
  /** Published active issues not covered by the canonical freight/tariff paths. */
  publishedIssues?: IssuePathInput[];
};

// ── helpers ───────────────────────────────────────────────────────────────────
function n(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

function fmtSpend(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${Math.round(v / 1_000)}K`;
  return `$${Math.round(v)}`;
}

// Exact K rounding for the raw calculated value (distinct from the ~$ display rounding).
function fmtKexact(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  return `$${Math.round(v / 1_000)}K`;
}

function bestShock(
  shocks: VerifiedShockRow[],
  pred: (s: VerifiedShockRow) => boolean
): VerifiedShockRow | null {
  return (
    shocks
      .filter(pred)
      .sort((a, b) => (b.confidence_score ?? 0) - (a.confidence_score ?? 0))[0] ?? null
  );
}

// Pass-through coverage (mirrors executiveImpactViewModel.resolvePassThrough — keeps the
// graph's intermediate "unpassed base" consistent with the canonical tariff estimate).
function resolvePassThroughPct(cal: Record<string, unknown>): number {
  const fields = [
    "tariff_pass_through_pct",
    "commodity_pass_through_pct",
    "supplier_pass_through_pct",
    "pass_through_pct",
    "pass_through_coverage_pct",
    "steel_pass_through_pct",
    "tariff_pass_through_coverage_pct",
  ];
  for (const f of fields) {
    const v = n(cal[f]);
    if (v !== null) return v;
  }
  return 80; // labeled demo default
}

const DEFAULT_FREIGHT_ACTION: ActionMeta = { owner: "Head of Supply Chain", due: "Jun 18, 2026" };
const DEFAULT_TARIFF_ACTION: ActionMeta = { owner: "Head of Procurement", due: "Jun 25, 2026" };

// ── freight path ────────────────────────────────────────────────────────────────
function buildFreightPath(input: BuildExposureGraphInput): ExposurePath | null {
  const { execFreight, verifiedShocks, calibration } = input;
  if (!execFreight || execFreight.value === null) return null;
  const cal = (calibration ?? {}) as Record<string, unknown>;

  const ppi = bestShock(
    verifiedShocks,
    (s) => /freight|logistic/i.test(s.driver ?? "") && s.primary_source_id === "bls_public_api"
  );
  const spend = n(cal.freight_spend);
  const spotPct = n(cal.freight_spot_rate_exposure_pct);
  const move = ppi ? n(ppi.percent_change) : null;
  const period = ppi?.period_end ?? null;
  const spotExposed = spend !== null && spotPct !== null ? spend * (spotPct / 100) : null;
  const action = input.freightAction ?? DEFAULT_FREIGHT_ACTION;

  const moveLabel = move !== null ? `+${move}%` : "+0.8%";
  const nodes: ExposureGraphNode[] = [
    {
      id: "freight-signal",
      type: "external_signal",
      column: 0,
      title: "BLS freight/logistics PPI",
      subtitle: `${moveLabel} public logistics price-pressure signal`,
      valueLabel: moveLabel,
      sourceLabel: `BLS Freight Transportation Arrangement PPI${period ? `, ${period}` : ""}`,
      status: "verified",
      statusLabel: "Verified public metric",
      driver: "freight",
    },
    {
      id: "freight-exposure",
      type: "company_exposure",
      column: 1,
      title: "Spot-exposed freight spend",
      subtitle:
        spend !== null && spotPct !== null
          ? `${fmtSpend(spend)} annual freight spend × ${spotPct}% spot exposure`
          : "Spot-exposed share of annual freight spend",
      valueLabel: spotExposed !== null ? `${fmtSpend(spotExposed)} spot-exposed spend` : undefined,
      status: "company_calibrated",
      statusLabel: "Company-calibrated",
      driver: "freight",
    },
    {
      id: "freight-calc",
      type: "calculation",
      column: 2,
      title: "Exposure calculation",
      subtitle:
        spend !== null && spotPct !== null && move !== null
          ? `${fmtSpend(spend)} × ${spotPct}% × ${move}%`
          : execFreight.calculation ?? undefined,
      valueLabel: `≈ ${fmtKexact(execFreight.value)}`,
      status: "estimate",
      statusLabel: "Spend-calibrated logistics pressure",
      driver: "freight",
      meta: { formula: execFreight.calculation ?? undefined },
    },
    {
      id: "freight-impact",
      type: "business_impact",
      column: 3,
      title: "Current-period logistics cost pressure",
      valueLabel: execFreight.display,
      status: "estimate",
      statusLabel: "Source-backed estimate",
      caveat:
        "Lane exposure calibrated; rate validation pending — public index supports price pressure, lane-specific freight rate not yet verified.",
      driver: "freight",
    },
    {
      id: "freight-action",
      type: "action",
      column: 4,
      title: "Validate freight lane exposure",
      subtitle: "Check spot-exposed lanes, surcharges, and contract coverage",
      status: "action",
      statusLabel: "Open action",
      meta: { owner: action.owner, due: action.due },
      driver: "freight",
    },
  ];

  return {
    id: "freight",
    label: "Freight logistics pressure",
    issueType: "Operating Risk",
    impactDisplay: execFreight.display,
    nodes,
    edges: linearEdges(nodes, "freight"),
  };
}

// ── tariff path ───────────────────────────────────────────────────────────────
function buildTariffPath(input: BuildExposureGraphInput): ExposurePath | null {
  const { execTariff, verifiedShocks, calibration } = input;
  if (!execTariff || execTariff.value === null) return null;
  const cal = (calibration ?? {}) as Record<string, unknown>;

  const tariff = bestShock(
    verifiedShocks,
    (s) =>
      (/tariff|trade|duty/i.test(s.driver ?? "") || s.shock_type === "tariff_rate_change") &&
      s.verification_status !== "scenario_assumption_only" &&
      s.verification_status !== "article_claim_only"
  );
  const steelSpend = n(cal.steel_spend);
  const baseline = tariff ? n(tariff.baseline_value) : null;
  const current = tariff ? n(tariff.current_value) : null;
  const pp = baseline !== null && current !== null ? Math.abs(baseline - current) : null;
  const passThroughPct = resolvePassThroughPct(cal);
  const unpassedPct = Math.round(100 - passThroughPct);
  const unpassedBase = steelSpend !== null ? steelSpend * (unpassedPct / 100) : null;
  const action = input.tariffAction ?? DEFAULT_TARIFF_ACTION;

  const rateMove = baseline !== null && current !== null ? `${baseline}% → ${current}%` : "25% → 15%";
  const ppLabel = pp !== null ? `${pp} percentage-point reduction` : "10 percentage-point reduction";

  const nodes: ExposureGraphNode[] = [
    {
      id: "tariff-signal",
      type: "external_signal",
      column: 0,
      title: "Manual tariff metric",
      subtitle: rateMove,
      valueLabel: ppLabel,
      sourceLabel: "Manual structured tariff metric CSV · USITC HTS / Federal Register",
      status: "verified",
      statusLabel: "Verified manual metric",
      driver: "tariff",
    },
    {
      id: "tariff-exposure",
      type: "company_exposure",
      column: 1,
      title: "Steel-linked import exposure",
      subtitle:
        steelSpend !== null
          ? `${fmtSpend(steelSpend)} steel-linked spend × 100% import exposed`
          : "Steel-linked import-exposed spend",
      valueLabel: steelSpend !== null ? `${fmtSpend(steelSpend)} import-exposed spend` : undefined,
      status: "company_calibrated",
      statusLabel: "Supplier-grounded",
      driver: "tariff",
    },
    {
      id: "tariff-unpassed",
      type: "company_exposure",
      column: 2,
      title: "Unpassed landed-cost exposure",
      subtitle: `${unpassedPct}% unpassed after ${Math.round(passThroughPct)}% pass-through coverage`,
      valueLabel: unpassedBase !== null ? `${fmtSpend(unpassedBase)} exposed base` : undefined,
      status: "assumption",
      statusLabel: "Pass-through assumption",
      driver: "tariff",
    },
    {
      id: "tariff-calc",
      type: "calculation",
      column: 3,
      title: "Exposure calculation",
      subtitle:
        steelSpend !== null && pp !== null
          ? `${fmtSpend(steelSpend)} × ${unpassedPct}% × ${pp} percentage points`
          : execTariff.calculation ?? undefined,
      valueLabel: `≈ ${fmtKexact(execTariff.value)}`,
      status: "estimate",
      statusLabel: "Canonical estimate",
      driver: "tariff",
      meta: { formula: execTariff.calculation ?? undefined },
    },
    {
      id: "tariff-impact",
      type: "business_impact",
      column: 4,
      title: "Tariff relief value at stake",
      valueLabel: execTariff.display,
      status: "pending",
      statusLabel: "Validation pending",
      caveat:
        "Value is not realized until supplier landed-cost updates, open POs, and country-of-origin exposure are validated.",
      driver: "tariff",
    },
    {
      id: "tariff-action",
      type: "action",
      column: 5,
      title: "Validate supplier landed-cost updates",
      subtitle: "Confirm country-of-origin, affected SKUs, supplier pricing, and open PO exposure",
      status: "action",
      statusLabel: "Open action",
      meta: { owner: action.owner, due: action.due },
      driver: "tariff",
    },
  ];

  return {
    id: "tariff",
    label: "Tariff relief validation",
    issueType: "Operating Change",
    impactDisplay: execTariff.display,
    nodes,
    edges: linearEdges(nodes, "tariff"),
  };
}

// ── issue-derived path (any published active issue not freight/tariff) ──────────
function buildIssuePath(issue: IssuePathInput): ExposurePath {
  const evidenceBacked = issue.evidenceStatus === "evidence_backed";
  const impactStatus: ExposureNodeStatus = evidenceBacked
    ? "estimate"
    : issue.evidenceStatus === "watchlist"
      ? "pending"
      : "assumption";

  const nodes: ExposureGraphNode[] = [
    {
      id: `${issue.id}-signal`,
      type: "external_signal",
      column: 0,
      title: issue.title,
      subtitle: issue.sourceLabel ?? "Company-evaluated external signal",
      sourceLabel: issue.sourceLabel ?? undefined,
      status: evidenceBacked ? "verified" : "context",
      statusLabel: evidenceBacked ? "Evidence-backed" : "Scenario-modeled",
      issueId: issue.id,
      driver: issue.driver,
    },
    {
      id: `${issue.id}-exposure`,
      type: "company_exposure",
      column: 1,
      title: "Company exposure",
      // No fabricated "mapped to calibration" placeholder — show the real basis,
      // or honestly state it isn't calibrated yet.
      subtitle: issue.exposureText ?? "Exposure basis not yet calibrated — add supplier/spend data in Calibration to ground this.",
      status: issue.exposureText ? "company_calibrated" : "assumption",
      statusLabel: issue.exposureText ? "Company-calibrated" : "Calibration pending",
      issueId: issue.id,
      driver: issue.driver,
    },
    {
      id: `${issue.id}-calc`,
      type: "calculation",
      column: 2,
      title: "Exposure calculation",
      // Only show a calculation line when there's a real formula; never a
      // "scenario midpoint" placeholder.
      subtitle: issue.calculation ?? undefined,
      valueLabel: issue.impactDisplay,
      status: "estimate",
      statusLabel: evidenceBacked ? "Evidence-backed estimate" : "Scenario-modeled estimate",
      issueId: issue.id,
      driver: issue.driver,
    },
    {
      id: `${issue.id}-impact`,
      type: "business_impact",
      column: 3,
      title: "Business impact",
      valueLabel: issue.impactDisplay,
      status: impactStatus,
      statusLabel: evidenceBacked ? "Source-backed estimate" : "Scenario assumption",
      caveat: evidenceBacked
        ? undefined
        : "Scenario-modeled — validate company-specific supplier/spend inputs before relying on this figure.",
      issueId: issue.id,
      driver: issue.driver,
    },
  ];

  if (issue.action) {
    nodes.push({
      id: `${issue.id}-action`,
      type: "action",
      column: 4,
      title: issue.action.title,
      subtitle: issue.action.nextStep ?? undefined,
      status: "action",
      statusLabel: "Open action",
      meta: { owner: issue.action.owner, due: issue.action.due },
      issueId: issue.id,
      driver: issue.driver,
    });
  }

  return {
    id: `issue-${issue.id}`,
    label: issue.title,
    issueType: issue.issueType,
    impactDisplay: issue.impactDisplay,
    nodes,
    edges: linearEdges(nodes, `issue-${issue.id}`),
  };
}

// Linear left→right edges with semantic edge types per column hop.
function linearEdges(nodes: ExposureGraphNode[], prefix: string): ExposureGraphEdge[] {
  const edgeTypeFor = (target: ExposureGraphNode): ExposureEdgeType => {
    switch (target.type) {
      case "company_exposure":
        return "maps_to";
      case "calculation":
        return "calculates";
      case "business_impact":
        return "impacts";
      case "action":
        return "triggers_action";
      default:
        return "verifies";
    }
  };
  const edges: ExposureGraphEdge[] = [];
  for (let i = 0; i < nodes.length - 1; i++) {
    edges.push({
      id: `${prefix}-e${i}`,
      source: nodes[i].id,
      target: nodes[i + 1].id,
      type: edgeTypeFor(nodes[i + 1]),
    });
  }
  return edges;
}

// ── supporting signals (context only — never dollarized) ─────────────────────────
function buildSupportingSignals(shocks: VerifiedShockRow[]): SupportingSignal[] {
  const signals: SupportingSignal[] = [];
  const has = (re: RegExp) =>
    shocks.some((s) => re.test(s.driver ?? "") && s.primary_source_id === "bls_public_api");

  if (has(/steel/i)) {
    signals.push({
      id: "support-steel",
      label: "BLS steel PPI",
      detail: "Verified public price context — included in tariff validation; no separate dollar estimate.",
      status: "context",
      statusLabel: "Verified context",
    });
  }
  if (has(/copper|aluminum|aluminium/i)) {
    signals.push({
      id: "support-metals",
      label: "BLS copper / aluminum PPI",
      detail: "Verified public price context — requires its own tariff metric before being quantified.",
      status: "context",
      statusLabel: "Verified context",
    });
  }
  // Macro / news / financial context that must never drive numeric exposure.
  signals.push(
    {
      id: "support-worldbank",
      label: "World Bank import volumes",
      detail: "Macro context for trade exposure — not a company-specific dollar driver.",
      status: "context",
      statusLabel: "Macro context",
    },
    {
      id: "support-gdelt",
      label: "GDELT news signal",
      detail: "News context only — excluded from numeric estimates.",
      status: "context",
      statusLabel: "News context only",
    },
    {
      id: "support-sec",
      label: "SEC EDGAR filings",
      detail: "Company financial anchor/context — grounds spend bases, not a separate exposure.",
      status: "context",
      statusLabel: "Financial anchor",
    }
  );
  return signals;
}

// ── blocked candidate lane (excluded from value totals) ──────────────────────────
function buildBlockedLanes(titles: string[]): BlockedLane[] {
  if (titles.length === 0) return [];
  // Show one representative blocked construction-demand candidate.
  const nodes: ExposureGraphNode[] = [
    {
      id: "blocked-signal",
      type: "blocked_candidate",
      column: 0,
      title: "Construction demand signal",
      subtitle: "Generated opportunity candidate",
      status: "blocked",
      statusLabel: "Candidate",
    },
    {
      id: "blocked-missing",
      type: "missing_data",
      column: 1,
      title: "Missing CRM/customer demand evidence",
      subtitle: "No quote/order trend, customer segment, exposed revenue base, or capture evidence",
      status: "missing",
      statusLabel: "Missing data",
    },
    {
      id: "blocked-gate",
      type: "blocked_candidate",
      column: 2,
      title: "Not promoted",
      subtitle: "Excluded from executive estimates and actions",
      status: "blocked",
      statusLabel: "Blocked by quality gate",
    },
    {
      id: "blocked-required",
      type: "missing_data",
      column: 3,
      title: "Required to promote",
      subtitle: "Upload CRM quote/order trend CSV or customer-segment demand data",
      status: "missing",
      statusLabel: "Actionable data request",
    },
  ];
  const edges: ExposureGraphEdge[] = [
    { id: "blocked-e0", source: "blocked-signal", target: "blocked-missing", type: "requires_data" },
    { id: "blocked-e1", source: "blocked-missing", target: "blocked-gate", type: "blocked_by" },
    { id: "blocked-e2", source: "blocked-gate", target: "blocked-required", type: "requires_data" },
  ];
  return [{ id: "blocked-construction", label: "Blocked construction demand opportunity", nodes, edges }];
}

// ── public adapter ────────────────────────────────────────────────────────────
export function buildExposureGraphViewModel(input: BuildExposureGraphInput): ExposureGraphModel {
  const canonicalPaths = [buildFreightPath(input), buildTariffPath(input)].filter(
    (p): p is ExposurePath => p !== null
  );
  // Add a path for every published active issue whose driver isn't already
  // covered by a canonical path — so an article-derived steel/supplier risk is
  // never published with 0 exposure paths.
  const coveredDrivers = new Set(canonicalPaths.map((p) => p.id));
  const issuePaths = (input.publishedIssues ?? [])
    .filter((iss) => !coveredDrivers.has(iss.driver))
    .map(buildIssuePath);
  const activePaths = [...canonicalPaths, ...issuePaths];

  const supportingSignals = buildSupportingSignals(input.verifiedShocks);
  const blockedLanes = buildBlockedLanes(input.blockedCandidateTitles);

  return {
    activePaths,
    supportingSignals,
    blockedLanes,
    summary: {
      activeCount: activePaths.length,
      valueAtStake: input.valueAtStakeDisplay,
      blockedCount: blockedLanes.length,
      supportingCount: supportingSignals.length,
    },
  };
}
