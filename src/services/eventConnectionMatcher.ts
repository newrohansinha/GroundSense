import { supabase } from "../lib/supabase";

type RawEvent = {
  id: string;
  company_id: string;
  title: string;
  source_name?: string | null;
  source_url?: string | null;
  query_text?: string | null;
  matched_terms?: string[] | null;
  signal_terms?: string[] | null;
};

type Connection = {
  id: string;
  company_id: string;
  title?: string | null;
  trigger_name?: string | null;
  affected_name?: string | null;
  impact_type?: string | null;
  affected_area?: string | null;
  impact_category?: string | null;
  path_nodes?: string[] | null;
  metadata?: Record<string, any> | string | null;
};

function norm(value: unknown) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(value: unknown) {
  return norm(value)
    .split(" ")
    .filter((x) => x.length > 2);
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function overlapScore(articleText: string, connectionText: string) {
  const articleTokenSet = new Set(tokens(articleText));
  const connectionTokenSet = new Set(tokens(connectionText));

  const hits = [...connectionTokenSet].filter((t) => articleTokenSet.has(t));

  let score = hits.length * 12;

  const importantTerms = [
    "steel",
    "tariff",
    "freight",
    "copper",
    "aluminum",
    "manufacturing",
    "construction",
    "grainger",
    "fastenal",
    "msc",
    "inventory",
    "supplier",
    "distribution",
    "margin",
    "pricing",
    "demand",
    "shortage",
    "logistics",
    "industrial",
    "revenue",
    "cost",
    "cogs",
    "customer",
    "competitor",
  ];

  for (const term of importantTerms) {
    if (articleTokenSet.has(term) && connectionTokenSet.has(term)) {
      score += 15;
    }
  }

  return Math.min(100, score);
}

function buildConnectionText(connection: Connection) {
  return [
    connection.title,
    connection.trigger_name,
    connection.affected_name,
    connection.impact_type,
    connection.affected_area,
    connection.impact_category,
    ...(connection.path_nodes || []),
    typeof connection.metadata === "string"
      ? connection.metadata
      : JSON.stringify(connection.metadata || {}),
  ]
    .filter(Boolean)
    .join(" ");
}

function classifyMatch(score: number) {
  if (score >= 75) return "direct";
  return "semantic_trigger";
}

export async function matchEventsToConnections(companyId: string) {
  const { data: events, error: eventsError } = await supabase
    .from("raw_events")
    .select(
      "id, company_id, title, source_name, source_url, query_text, matched_terms, signal_terms"
    )
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(2000);

  if (eventsError) throw eventsError;

  const { data: connections, error: connectionsError } = await supabase
    .from("impact_paths")
    .select("*")
    .eq("company_id", companyId);

  if (connectionsError) throw connectionsError;

  const rows: any[] = [];

  for (const event of (events || []) as RawEvent[]) {
    const articleText = [
      event.title,
      event.query_text,
      ...(event.matched_terms || []),
      ...(event.signal_terms || []),
    ].join(" ");

    for (const connection of (connections || []) as Connection[]) {
      const connectionText = buildConnectionText(connection);
      const score = overlapScore(articleText, connectionText);

      if (score < 50) continue;

      const matchedTerms = unique(
        tokens(articleText).filter((t) => tokens(connectionText).includes(t))
      );

      rows.push({
        company_id: companyId,
        raw_event_id: event.id,
        connection_id: connection.id,
        match_score: score,
        match_type: classifyMatch(score),
        matched_terms: matchedTerms,
        matched_entities: connection.path_nodes || [],
        match_reason: `Article matched this impact path through shared business terms: ${matchedTerms.join(
          ", "
        )}.`,
      });
    }
  }

  await supabase
    .from("event_connection_matches")
    .delete()
    .eq("company_id", companyId);

  if (rows.length > 0) {
    const { error } = await supabase
      .from("event_connection_matches")
      .insert(rows);

    if (error) throw error;
  }

  console.log("Event → connection matching complete", {
    events: events?.length || 0,
    connections: connections?.length || 0,
    matches: rows.length,
    direct: rows.filter((row) => row.match_type === "direct").length,
    semantic: rows.filter((row) => row.match_type === "semantic_trigger")
      .length,
  });

  return {
    events: events?.length || 0,
    connections: connections?.length || 0,
    matches: rows.length,
  };
}