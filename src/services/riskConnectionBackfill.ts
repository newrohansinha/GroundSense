import { supabase } from "../lib/supabase";

type RiskRow = {
  id: string;
  risk_title: string;
  risk_type?: string | null;
  source_event_ids?: string[] | string | null;
  evidence_items?: any[] | null;
};

type OpportunityRow = {
  id: string;
  title: string;
  source_event_ids?: string[] | string | null;
  evidence_items?: any[] | null;
};

type MatchRow = {
  raw_event_id: string;
  connection_id: string;
  match_score: number;
  match_type: string;
  matched_terms?: string[] | null;
};

type ImpactPathRow = {
  id: string;
  trigger_name?: string | null;
  affected_name?: string | null;
  impact_category?: string | null;
  path_nodes?: string[] | null;
};

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim()).filter(Boolean);
  }

  if (typeof value === "string") {
    const trimmed = value.trim();

    if (!trimmed) return [];

    // Handles Postgres array literal style: {id1,id2,id3}
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

function norm(value: unknown) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function textOfPath(path?: ImpactPathRow | null) {
  if (!path) return "";

  return [
    path.trigger_name,
    path.affected_name,
    path.impact_category,
    ...(Array.isArray(path.path_nodes) ? path.path_nodes : []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function evidenceEventIds(items: any[] | null | undefined) {
  if (!Array.isArray(items)) return [];

  return unique(
    items
      .map((item) =>
        String(
          item.raw_event_id ||
            item.event_id ||
            item.rawEventId ||
            item.source_event_id ||
            ""
        ).trim()
      )
      .filter(Boolean)
  );
}

function riskAllowsPath(risk: RiskRow, path?: ImpactPathRow | null) {
  const title = norm(risk.risk_title);
  const riskType = norm(risk.risk_type);
  const text = textOfPath(path);

  // If path failed to load, don't block attachment.
  // This prevents valid event_connection_matches from being discarded.
  if (!text) return true;

  const isCompetitor =
    text.includes("competitor") ||
    text.includes("grainger") ||
    text.includes("msc industrial") ||
    text.includes("applied industrial") ||
    text.includes("white cap") ||
    text.includes("wurth");

  const isCommodity =
    text.includes("steel") ||
    text.includes("copper") ||
    text.includes("aluminum") ||
    text.includes("freight") ||
    text.includes("tariff") ||
    text.includes("price move") ||
    text.includes("pass through") ||
    text.includes("unpassed cost") ||
    text.includes("margin exposure");

  const isSteel =
    text.includes("steel") ||
    text.includes("tariff") ||
    text.includes("china");
if (
  title.includes("tariff") ||
  title.includes("steel") ||
  title.includes("aluminum") ||
  title.includes("copper") ||
  riskType.includes("tariff") ||
  riskType.includes("trade") ||
  riskType.includes("commodity")
) {
  const isMetalsOrTrade =
    text.includes("steel") ||
    text.includes("aluminum") ||
    text.includes("copper") ||
    text.includes("tariff") ||
    text.includes("import") ||
    text.includes("landed cost") ||
    text.includes("pass through") ||
    text.includes("margin exposure");

  const isWrongForTariff =
    text.includes("freight") ||
    text.includes("logistics") ||
    text.includes("shipping") ||
    text.includes("competitor") ||
    text.includes("grainger") ||
    text.includes("msc industrial") ||
    text.includes("applied industrial");

  return isMetalsOrTrade && !isWrongForTariff;
}

  const isFreight =
    text.includes("freight") ||
    text.includes("logistics") ||
    text.includes("supplier") ||
    text.includes("disruption");



  const isDemand =
    text.includes("manufacturing") ||
    text.includes("construction") ||
    text.includes("customer") ||
    text.includes("demand") ||
    text.includes("revenue");

  if (
    title.includes("steel") ||
    title.includes("china") ||
    riskType.includes("steel") ||
    riskType.includes("commodity")
  ) {
    return (isSteel || isCommodity) && !isCompetitor;
  }

  if (
    title.includes("freight") ||
    title.includes("supplier") ||
    riskType.includes("freight") ||
    riskType.includes("supplier")
  ) {
    return isFreight && !isCompetitor;
  }

  if (title.includes("demand") || riskType.includes("demand")) {
    return isDemand && !isCompetitor;
  }

  if (
    title.includes("competitor") ||
    title.includes("competitive") ||
    riskType.includes("competitor")
  ) {
    return isCompetitor;
  }

  return true;
}

function opportunityAllowsPath(opportunity: OpportunityRow, path?: ImpactPathRow | null) {
  const title = norm(opportunity.title);
  const text = textOfPath(path);

  if (!text) return true;

  const isCompetitor =
    text.includes("competitor") ||
    text.includes("grainger") ||
    text.includes("msc industrial") ||
    text.includes("applied industrial") ||
    text.includes("white cap") ||
    text.includes("wurth");

  const isDemand =
    text.includes("manufacturing") ||
    text.includes("construction") ||
    text.includes("customer") ||
    text.includes("demand") ||
    text.includes("revenue");

  const isCommodity =
    text.includes("steel") ||
    text.includes("freight") ||
    text.includes("copper") ||
    text.includes("aluminum") ||
    text.includes("tariff");

  if (
    title.includes("share") ||
    title.includes("competitor") ||
    title.includes("competitive")
  ) {
    return isCompetitor;
  }

  if (
    title.includes("demand") ||
    title.includes("manufacturing") ||
    title.includes("construction") ||
    title.includes("infrastructure")
  ) {
    return isDemand;
  }

  if (
    title.includes("pricing") ||
    title.includes("margin") ||
    title.includes("sourcing")
  ) {
    return isCommodity;
  }

  return true;
}

async function loadMatches(companyId: string, eventIds: string[]) {
  if (eventIds.length === 0) return [];

  const { data, error } = await supabase
    .from("event_connection_matches")
    .select("raw_event_id, connection_id, match_score, match_type, matched_terms")
    .eq("company_id", companyId)
    .in("raw_event_id", eventIds)
    .gte("match_score", 50)
    .order("match_score", { ascending: false });

  if (error) throw error;

  return (data || []) as MatchRow[];
}

async function loadImpactPaths(companyId: string, connectionIds: string[]) {
  const ids = unique(connectionIds);

  if (ids.length === 0) return new Map<string, ImpactPathRow>();

  const { data, error } = await supabase
    .from("impact_paths")
    .select("id, trigger_name, affected_name, impact_category, path_nodes")
    .eq("company_id", companyId)
    .in("id", ids);

  if (error) throw error;

  const map = new Map<string, ImpactPathRow>();

  for (const path of (data || []) as ImpactPathRow[]) {
    map.set(path.id, path);
  }

  return map;
}

function topUniqueConnectionIds(matches: MatchRow[]) {
  const ids: string[] = [];

  for (const match of matches.sort((a, b) => b.match_score - a.match_score)) {
    if (!ids.includes(match.connection_id)) {
      ids.push(match.connection_id);
    }

    if (ids.length >= 8) break;
  }

  return ids;
}

export async function attachConnectionsToRisks(companyId: string) {
  const { data: risks, error: riskError } = await supabase
    .from("risk_register")
    .select("id, risk_title, risk_type, source_event_ids, evidence_items")
    .eq("company_id", companyId);

  if (riskError) throw riskError;

  const { data: opportunities, error: oppError } = await supabase
    .from("opportunity_register")
    .select("id, title, source_event_ids, evidence_items")
    .eq("company_id", companyId);

  if (oppError) throw oppError;

  const riskRows = (risks || []) as RiskRow[];
  const opportunityRows = (opportunities || []) as OpportunityRow[];

  const allEventIds = unique([
    ...riskRows.flatMap((risk) => [
      ...toStringArray(risk.source_event_ids),
      ...evidenceEventIds(risk.evidence_items),
    ]),
    ...opportunityRows.flatMap((opportunity) => [
      ...toStringArray(opportunity.source_event_ids),
      ...evidenceEventIds(opportunity.evidence_items),
    ]),
  ]);

  const allMatches = await loadMatches(companyId, allEventIds);

  const pathMap = await loadImpactPaths(
    companyId,
    allMatches.map((match) => match.connection_id)
  );

  const matchesByEvent = new Map<string, MatchRow[]>();

  for (const match of allMatches) {
    const current = matchesByEvent.get(match.raw_event_id) || [];
    current.push(match);
    matchesByEvent.set(match.raw_event_id, current);
  }

  let riskConnectionsAttached = 0;
  let opportunityConnectionsAttached = 0;

  for (const risk of riskRows) {
    const eventIds = unique([
      ...toStringArray(risk.source_event_ids),
      ...evidenceEventIds(risk.evidence_items),
    ]);

    const candidateMatches = eventIds.flatMap(
      (eventId) => matchesByEvent.get(eventId) || []
    );

    const allowedMatches = candidateMatches.filter((match) =>
      riskAllowsPath(risk, pathMap.get(match.connection_id))
    );

    // Important fallback:
    // If valid matches exist but semantic filter rejects all,
    // attach top raw matches instead of leaving the risk at 0.
    const finalMatches =
      allowedMatches.length > 0 ? allowedMatches : candidateMatches;

    const connectionIds = topUniqueConnectionIds(finalMatches);

    riskConnectionsAttached += connectionIds.length;

    const { error } = await supabase
      .from("risk_register")
      .update({
        supporting_connection_ids: connectionIds,
        supporting_connection_count: connectionIds.length,
      })
      .eq("id", risk.id);

    if (error) throw error;

    console.log("Risk connection attachment", {
      riskTitle: risk.risk_title,
      sourceEventIds: eventIds.length,
      candidateMatches: candidateMatches.length,
      allowedMatches: allowedMatches.length,
      attached: connectionIds.length,
      connectionIds,
    });
  }

  for (const opportunity of opportunityRows) {
    const eventIds = unique([
      ...toStringArray(opportunity.source_event_ids),
      ...evidenceEventIds(opportunity.evidence_items),
    ]);

    const candidateMatches = eventIds.flatMap(
      (eventId) => matchesByEvent.get(eventId) || []
    );

    const allowedMatches = candidateMatches.filter((match) =>
      opportunityAllowsPath(opportunity, pathMap.get(match.connection_id))
    );

    const finalMatches =
      allowedMatches.length > 0 ? allowedMatches : candidateMatches;

    const connectionIds = topUniqueConnectionIds(finalMatches);

    opportunityConnectionsAttached += connectionIds.length;

    const { error } = await supabase
      .from("opportunity_register")
      .update({
        supporting_connection_ids: connectionIds,
        supporting_connection_count: connectionIds.length,
      })
      .eq("id", opportunity.id);

    if (error) throw error;

    console.log("Opportunity connection attachment", {
      opportunityTitle: opportunity.title,
      sourceEventIds: eventIds.length,
      candidateMatches: candidateMatches.length,
      allowedMatches: allowedMatches.length,
      attached: connectionIds.length,
      connectionIds,
    });
  }

  console.log("Attached connections to risks/opportunities", {
    risks: riskRows.length,
    opportunities: opportunityRows.length,
    allEventIds: allEventIds.length,
    allMatches: allMatches.length,
    riskConnectionsAttached,
    opportunityConnectionsAttached,
  });

  return {
    risks: riskRows.length,
    opportunities: opportunityRows.length,
    allEventIds: allEventIds.length,
    allMatches: allMatches.length,
    riskConnectionsAttached,
    opportunityConnectionsAttached,
  };
}