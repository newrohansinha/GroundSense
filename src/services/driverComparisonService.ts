// driverComparisonService.ts
// Pure computation — no Supabase, no React imports.

export type DriverRow = {
  key: string;
  name: string;
  status: "Act" | "Validate" | "Watch" | "Ignore" | "Not active";
  estimatedImpact: string | null;
  estimateQuality: string;
  evidenceStrength: "Strong" | "Moderate" | "Weak" | "None";
  actionability: "Immediate" | "Near-term" | "Monitor" | "Not actionable";
  relatedIssueTitle: string | null;
  reason: string;
  recommendedAction: string;
  modelBasis:
    | "evidence_backed"
    | "scenario_fallback"
    | "needs_calibration"
    | "operating_change"
    | "unknown"
    | "not_active";
};

export type DriverPriorityReport = {
  drivers: DriverRow[];
  topDriver: DriverRow | null;
  actCount: number;
  validateCount: number;
  watchCount: number;
};

// ---------------------------------------------------------------------------
// Driver catalogue
// ---------------------------------------------------------------------------

type DriverDef = {
  key: string;
  name: string;
  matchKeywords: string[];
};

const DRIVERS: DriverDef[] = [
  {
    key: "freight",
    name: "Freight / logistics cost",
    matchKeywords: ["freight", "shipping", "logistics", "ocean", "port", "carrier", "container"],
  },
  {
    key: "tariff",
    name: "Tariff / trade policy",
    matchKeywords: ["tariff", "trade", "import", "duty", "section 301", "trade policy"],
  },
  {
    key: "steel",
    name: "Steel / metals pricing",
    matchKeywords: ["steel", "metal", "iron", "fastener", "aluminum", "copper", "metals"],
  },
  {
    key: "copper",
    name: "Copper pricing",
    matchKeywords: ["copper", "wire", "electrical"],
  },
  {
    key: "aluminum",
    name: "Aluminum pricing",
    matchKeywords: ["aluminum", "aluminium"],
  },
  {
    key: "manufacturing_demand",
    name: "Manufacturing demand",
    matchKeywords: ["manufacturing", "industrial", "manufacturing demand", "pmi"],
  },
  {
    key: "construction_demand",
    name: "Construction demand",
    matchKeywords: ["construction", "housing", "building permit"],
  },
  {
    key: "competitor",
    name: "Competitor pressure",
    matchKeywords: ["grainger", "msc", "competitor", "market share"],
  },
  {
    key: "service_level",
    name: "Service level / backorders",
    matchKeywords: ["fill rate", "backorder", "service level", "fulfillment"],
  },
  {
    key: "supplier",
    name: "Supplier concentration",
    matchKeywords: ["supplier", "vendor", "single source", "procurement"],
  },
];

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

type RiskInput = {
  id: string;
  risk_title: string;
  issue_category?: string | null;
  display_section?: string | null;
  priority_score?: number | null;
  impact_low?: number | null;
  impact_high?: number | null;
  affected_commodities?: string[] | null;
  confidence?: number | null;
  methodology?: Record<string, unknown> | null;
  evidence_items?: unknown[] | null;
};

type OpportunityInput = {
  id: string;
  title: string;
  revenue_low?: number | null;
  revenue_high?: number | null;
  priority_score?: number | null;
  methodology?: Record<string, unknown> | null;
  evidence_items?: unknown[] | null;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function matchesDriver(driverDef: DriverDef, text: string, commodities: string[]): boolean {
  const haystack = text.toLowerCase();
  const commodityHaystack = commodities.join(" ").toLowerCase();
  for (const kw of driverDef.matchKeywords) {
    if (haystack.includes(kw) || commodityHaystack.includes(kw)) return true;
  }
  return false;
}

function matchRisk(driverDef: DriverDef, risk: RiskInput): boolean {
  const textFields = [
    risk.risk_title,
    risk.issue_category ?? "",
    risk.display_section ?? "",
  ].join(" ");
  const commodities = risk.affected_commodities ?? [];
  return matchesDriver(driverDef, textFields, commodities);
}

function matchOpportunity(driverDef: DriverDef, opp: OpportunityInput): boolean {
  return matchesDriver(driverDef, opp.title, []);
}

// Robust model status extraction — handles compound strings like "scenario_fallback_no_explicit_freight_rate"
function extractModelStatus(methodology: Record<string, unknown> | null | undefined): string {
  if (!methodology) return "unknown";
  // Try top-level model_status first
  if (typeof methodology.model_status === "string") return methodology.model_status;
  // Try calculation_inputs.shock_source
  const calc = methodology.calculation_inputs;
  if (calc && typeof calc === "object") {
    const ss = (calc as Record<string, unknown>).shock_source;
    if (typeof ss === "string" && ss) return ss;
  }
  // Try top-level shock_source
  if (typeof methodology.shock_source === "string" && methodology.shock_source) {
    return methodology.shock_source;
  }
  if (methodology.calibration_status === "needs_calibration") return "needs_calibration";
  if (methodology.formula_status === "not_calculated") return "needs_calibration";
  return "unknown";
}

// Normalize a raw model status string into a clean category
function normalizeModelStatus(raw: string): "evidence_backed" | "scenario_fallback" | "needs_calibration" | "unknown" {
  const s = raw.toLowerCase();
  if (s === "evidence_backed" || s.includes("explicit_new") || s.includes("explicit_news")) return "evidence_backed";
  if (s.includes("scenario_fallback") || s.includes("scenario")) return "scenario_fallback";
  if (s === "needs_calibration" || s.includes("needs_calibration")) return "needs_calibration";
  return "unknown";
}

function formatImpact(low: number | null | undefined, high: number | null | undefined): string | null {
  if (low == null && high == null) return null;
  const fmt = (n: number): string => {
    if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
    if (Math.abs(n) >= 1_000) return `$${Math.round(n / 1_000)}K`;
    return `$${Math.round(n)}`;
  };
  if (low != null && high != null) {
    if (low === high) return `${fmt(high)} midpoint`;
    return `${fmt(low)}–${fmt(high)}`;
  }
  if (high != null) return `up to ${fmt(high)}`;
  if (low != null) return `~${fmt(low)}`;
  return null;
}

function evidenceStrength(
  evidenceItems: unknown[] | null | undefined,
  modelStatus: "evidence_backed" | "scenario_fallback" | "needs_calibration" | "unknown"
): DriverRow["evidenceStrength"] {
  const count = evidenceItems?.length ?? 0;
  if (modelStatus === "evidence_backed" && count >= 2) return "Strong";
  if (modelStatus === "evidence_backed" && count === 1) return "Moderate";
  if (modelStatus === "scenario_fallback") return count >= 2 ? "Moderate" : "Weak";
  if (modelStatus === "needs_calibration") return "Weak";
  if (count === 0) return "None";
  return "Weak";
}

function qualityLabel(modelStatus: "evidence_backed" | "scenario_fallback" | "needs_calibration" | "unknown"): string {
  switch (modelStatus) {
    case "evidence_backed": return "Evidence-backed rate";
    case "scenario_fallback": return "Scenario-modeled";
    case "needs_calibration": return "Needs company validation";
    default: return "Inferred from public data";
  }
}

// ---------------------------------------------------------------------------
// Status and actionability resolution per driver key
// ---------------------------------------------------------------------------

function resolveStatus(
  driverKey: string,
  modelStatus: "evidence_backed" | "scenario_fallback" | "needs_calibration" | "unknown",
  priorityScore: number,
  isFromOperatingChange = false
): DriverRow["status"] {
  // Competitor: always Watch
  if (driverKey === "competitor") return "Watch";

  // Demand drivers from opportunity: Watch / Validate only
  if (driverKey === "manufacturing_demand" || driverKey === "construction_demand") {
    if (modelStatus === "evidence_backed" && priorityScore >= 68) return "Validate";
    return "Watch";
  }

  // Operating changes always Validate (they are known active policy changes)
  if (isFromOperatingChange) return "Validate";

  // Freight is the primary cost driver — active scenario risks warrant Act
  if (driverKey === "freight") {
    if (modelStatus === "evidence_backed" && priorityScore >= 60) return "Act";
    if (modelStatus === "scenario_fallback" && priorityScore >= 55) return "Act";
    if (modelStatus === "scenario_fallback") return "Validate";
    if (modelStatus === "needs_calibration") return "Validate";
    return "Watch";
  }

  // Standard path for all other drivers
  if (modelStatus === "evidence_backed" && priorityScore >= 68) return "Act";
  if (modelStatus === "evidence_backed") return "Validate";
  if (modelStatus === "scenario_fallback") return "Validate";
  if (modelStatus === "needs_calibration") return "Validate";
  return "Watch";
}

function resolveActionability(status: DriverRow["status"]): DriverRow["actionability"] {
  switch (status) {
    case "Act": return "Immediate";
    case "Validate": return "Near-term";
    case "Watch": return "Monitor";
    default: return "Not actionable";
  }
}

function resolveModelBasis(
  modelStatus: "evidence_backed" | "scenario_fallback" | "needs_calibration" | "unknown",
  isFromOperatingChange = false
): DriverRow["modelBasis"] {
  if (isFromOperatingChange) return "operating_change";
  switch (modelStatus) {
    case "evidence_backed": return "evidence_backed";
    case "scenario_fallback": return "scenario_fallback";
    case "needs_calibration": return "needs_calibration";
    default: return "unknown";
  }
}

function buildReason(
  driverKey: string,
  status: DriverRow["status"],
  modelStatus: "evidence_backed" | "scenario_fallback" | "needs_calibration" | "unknown",
  priorityScore: number,
  isFromOperatingChange: boolean
): string {
  if (isFromOperatingChange) {
    if (driverKey === "tariff") return "Active operating change affecting metal import and trade policy assumptions.";
    if (driverKey === "steel") return "Metal input exposure is active through tariff operating change.";
    return "Active operating change — residual exposure requires procurement validation.";
  }
  if (status === "Act") {
    if (driverKey === "freight") return `Active scenario downside risk with modeled range. Priority ${priorityScore}/100. Logistics action open.`;
    return `Evidence-backed exposure with priority score ${priorityScore}. Immediate action warranted.`;
  }
  if (status === "Validate") {
    if (driverKey === "manufacturing_demand" || driverKey === "construction_demand") {
      return "Macro demand signal identified; requires CRM and field validation before acting.";
    }
    if (modelStatus === "needs_calibration") {
      return "Modeled exposure pending company-specific data; validate inputs before acting.";
    }
    return `Exposure identified — ${modelStatus === "scenario_fallback" ? "based on scenario assumptions" : "confidence below Act threshold"}. Validate before acting.`;
  }
  if (status === "Watch") {
    if (driverKey === "competitor") return "Directional competitive pressure detected; no account-level displacement data yet.";
    if (driverKey === "manufacturing_demand") return "Broad market signals; not account-specific. Validate in CRM before promoting to campaign.";
    return "Signal present but evidence is weak or model basis is unclear. Monitor for changes.";
  }
  return "No issues currently modeled for this driver.";
}

function buildRecommendedAction(
  driverKey: string,
  status: DriverRow["status"],
  isFromOperatingChange: boolean
): string {
  if (status === "Not active") return "—";
  const actionMap: Record<string, string> = {
    freight: "Validate spot-exposed lanes, surcharges, and contract coverage by lane.",
    tariff: "Validate supplier country-of-origin and import-category exposure.",
    steel: "Validate supplier-level landed cost and tariff impact by SKU.",
    copper: "Review copper-exposed product lines and supplier pricing.",
    aluminum: "Review aluminum-exposed product lines and supplier pricing.",
    manufacturing_demand: "Validate CRM pipeline and quote volume in manufacturing accounts before campaign.",
    construction_demand: "Monitor construction segment quote volume and order trend.",
    competitor: "Monitor win/loss data, pricing changes, and account displacement signals.",
    service_level: "Monitor fill rate, backorder rate, and customer cancellations.",
    supplier: "Identify single-source dependencies and supplier concentration risk.",
  };
  if (isFromOperatingChange && driverKey === "tariff") {
    return "Validate steel-linked supplier landed-cost updates and country-of-origin; flag aluminum/copper separately only if additional tariff metrics or supplier evidence are available.";
  }
  return actionMap[driverKey] || "Monitor for changes.";
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function computeDriverPriority(
  risks: RiskInput[],
  opportunities: OpportunityInput[],
  _calibration: Record<string, number | null> | null,
  operatingChanges?: RiskInput[]
): DriverPriorityReport {
  const opChanges = operatingChanges ?? [];

  const drivers: DriverRow[] = DRIVERS.map((def) => {
    // --- Search risk register first ---
    const matchedRisk = risks.find((r) => matchRisk(def, r));

    if (matchedRisk) {
      const rawStatus = extractModelStatus(matchedRisk.methodology);
      const modelStatus = normalizeModelStatus(rawStatus);
      const priorityScore = matchedRisk.priority_score ?? 50;
      const status = resolveStatus(def.key, modelStatus, priorityScore, false);

      return {
        key: def.key,
        name: def.name,
        status,
        estimatedImpact: formatImpact(matchedRisk.impact_low, matchedRisk.impact_high),
        estimateQuality: qualityLabel(modelStatus),
        evidenceStrength: evidenceStrength(matchedRisk.evidence_items, modelStatus),
        actionability: resolveActionability(status),
        relatedIssueTitle: matchedRisk.risk_title,
        reason: buildReason(def.key, status, modelStatus, priorityScore, false),
        recommendedAction: buildRecommendedAction(def.key, status, false),
        modelBasis: resolveModelBasis(modelStatus, false),
      };
    }

    // --- Search operating changes ---
    const matchedOpChange = opChanges.find((r) => matchRisk(def, r));
    if (matchedOpChange) {
      const rawStatus = extractModelStatus(matchedOpChange.methodology);
      const modelStatus = normalizeModelStatus(rawStatus);
      const priorityScore = matchedOpChange.priority_score ?? 50;
      const status = resolveStatus(def.key, modelStatus, priorityScore, true);

      return {
        key: def.key,
        name: def.name,
        status,
        estimatedImpact: formatImpact(matchedOpChange.impact_low, matchedOpChange.impact_high),
        estimateQuality: "Evidence-backed rate, partially grounded exposure",
        evidenceStrength: evidenceStrength(matchedOpChange.evidence_items, modelStatus),
        actionability: resolveActionability(status),
        relatedIssueTitle: matchedOpChange.risk_title,
        reason: buildReason(def.key, status, modelStatus, priorityScore, true),
        recommendedAction: buildRecommendedAction(def.key, status, true),
        modelBasis: resolveModelBasis(modelStatus, true),
      };
    }

    // --- Search opportunities (demand drivers only) ---
    if (def.key === "manufacturing_demand" || def.key === "construction_demand") {
      const matchedOpp = opportunities.find((o) => matchOpportunity(def, o));
      if (matchedOpp) {
        const rawStatus = extractModelStatus(matchedOpp.methodology);
        const modelStatus = normalizeModelStatus(rawStatus);
        const priorityScore = matchedOpp.priority_score ?? 30;
        const status = resolveStatus(def.key, modelStatus, priorityScore, false);

        return {
          key: def.key,
          name: def.name,
          status,
          estimatedImpact: formatImpact(matchedOpp.revenue_low, matchedOpp.revenue_high),
          estimateQuality: "Needs CRM/customer validation",
          evidenceStrength: evidenceStrength(matchedOpp.evidence_items, modelStatus),
          actionability: resolveActionability(status),
          relatedIssueTitle: matchedOpp.title,
          reason: buildReason(def.key, status, modelStatus, priorityScore, false),
          recommendedAction: buildRecommendedAction(def.key, status, false),
          modelBasis: resolveModelBasis(modelStatus, false),
        };
      }
    }

    // --- No match: Not active ---
    return {
      key: def.key,
      name: def.name,
      status: "Not active",
      estimatedImpact: null,
      estimateQuality: "—",
      evidenceStrength: "None",
      actionability: "Not actionable",
      relatedIssueTitle: null,
      reason: "No issues currently modeled for this driver.",
      recommendedAction: "—",
      modelBasis: "not_active",
    };
  });

  const actCount = drivers.filter((d) => d.status === "Act").length;
  const validateCount = drivers.filter((d) => d.status === "Validate").length;
  const watchCount = drivers.filter((d) => d.status === "Watch").length;

  // Top driver: first Act, then first Validate
  const actDrivers = drivers.filter((d) => d.status === "Act");
  const topDriver = actDrivers.length > 0
    ? actDrivers[0]
    : drivers.find((d) => d.status === "Validate") ?? null;

  return { drivers, topDriver, actCount, validateCount, watchCount };
}
