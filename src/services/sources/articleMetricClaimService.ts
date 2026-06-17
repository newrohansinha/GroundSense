// Article Metric Claim Extraction (Part 7).
// Pulls numeric claims out of article/event text. These are CLAIMS TO VERIFY, never
// automatic shocks — verification happens in the source fusion / verified shock engine.

import { supabase } from "../../lib/supabase";
import type { ArticleMetricClaim } from "./types";

// Driver keyword → (driver, suspected metric_key family) for classifying a claim.
const DRIVER_KEYWORDS: Array<{ match: RegExp; driver: string; metricKey: string }> = [
  { match: /freight|container|ocean rate|shipping rate|logistics cost|spot rate/i, driver: "freight", metricKey: "freight_rate" },
  { match: /tariff|duty|duties|trade policy|section 232|section 301/i, driver: "tariff", metricKey: "tariff_rate" },
  { match: /steel|iron|rebar|hrc|hot.?rolled/i, driver: "steel", metricKey: "steel_price" },
  { match: /copper/i, driver: "copper", metricKey: "copper_price" },
  { match: /alumin/i, driver: "aluminum", metricKey: "aluminum_price" },
  { match: /import volume|export volume|shipment volume|trade volume/i, driver: "import_volume", metricKey: "import_volume" },
  { match: /\bppi\b|producer price/i, driver: "producer_prices", metricKey: "ppi" },
  { match: /\bgdp\b|inflation|\bcpi\b|demand/i, driver: "macro", metricKey: "macro_indicator" },
];

function classifyClaimDriver(context: string): { driver: string | null; metricKey: string | null } {
  for (const k of DRIVER_KEYWORDS) {
    if (k.match.test(context)) return { driver: k.driver, metricKey: k.metricKey };
  }
  return { driver: null, metricKey: null };
}

function windowAround(text: string, index: number, span = 70): string {
  const start = Math.max(0, index - span);
  return text.slice(start, Math.min(text.length, index + span));
}

// Extract numeric claims from a block of text.
export function extractClaimsFromText(text: string): ArticleMetricClaim[] {
  if (!text) return [];
  const claims: ArticleMetricClaim[] = [];
  const seen = new Set<string>();

  const push = (value: number | null, unit: string | null, idx: number, periodText: string | null) => {
    const context = windowAround(text, idx);
    const { driver, metricKey } = classifyClaimDriver(context);
    const claimText = context.trim().replace(/\s+/g, " ");
    const dedupeKey = `${value}|${unit}|${driver}|${claimText.slice(0, 40)}`;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    claims.push({
      claim_text: claimText,
      extracted_value: value,
      extracted_unit: unit,
      metric_key: metricKey,
      driver,
      period_text: periodText,
      verification_status: "article_claim_only",
    });
  };

  // Pattern A: "X% to Y%" (e.g., tariff 25% to 15%) → use Y as current, X as baseline context.
  const aToB = /(\d{1,3}(?:\.\d+)?)\s*%\s*(?:to|→|->|from)\s*(\d{1,3}(?:\.\d+)?)\s*%/gi;
  for (let m; (m = aToB.exec(text)); ) {
    const from = Number(m[1]);
    const to = Number(m[2]);
    push(to, "%", m.index, `${from}% → ${to}%`);
  }

  // Pattern B: directional percent change ("rose 12%", "up 8 percent", "fell 5%").
  const dirPct = /(rose|increased|climbed|jumped|surged|up|grew|fell|declined|dropped|down|decreased|cut)\s+(?:by\s+)?(\d{1,3}(?:\.\d+)?)\s*(?:%|percent)/gi;
  for (let m; (m = dirPct.exec(text)); ) {
    const dir = /fell|declined|dropped|down|decreased|cut/i.test(m[1]) ? -1 : 1;
    push(dir * Number(m[2]), "%", m.index, null);
  }

  // Pattern C: price level ("$1,200 per ton", "$3.85 per pound").
  const priceLevel = /\$\s?(\d{1,3}(?:,\d{3})*(?:\.\d+)?)\s*(?:per\s+)?(ton|tonne|lb|pound|kg|mt|bushel|barrel)/gi;
  for (let m; (m = priceLevel.exec(text)); ) {
    push(Number(m[1].replace(/,/g, "")), `$/${m[2].toLowerCase()}`, m.index, null);
  }

  return claims;
}

// Read recent events for a company, extract claims, and (best-effort) persist them.
export async function extractArticleMetricClaimsForCompany(companyId: string): Promise<ArticleMetricClaim[]> {
  let events: Array<{ id: string; title: string | null; query_text: string | null }> = [];
  try {
    const { data } = await supabase
      .from("raw_events")
      .select("id, title, query_text")
      .eq("company_id", companyId)
      .order("relevance_seed_score", { ascending: false })
      .limit(60);
    events = data ?? [];
  } catch {
    return [];
  }

  const all: ArticleMetricClaim[] = [];
  for (const ev of events) {
    const text = [ev.title, ev.query_text].filter(Boolean).join(". ");
    for (const claim of extractClaimsFromText(text)) {
      all.push({ ...claim, raw_event_id: ev.id, company_id: companyId });
    }
  }

  // Best-effort persistence (never throws to the pipeline).
  if (all.length > 0) {
    try {
      await supabase.from("article_metric_claims").insert(
        all.map((c) => ({
          raw_event_id: c.raw_event_id,
          company_id: companyId,
          claim_text: c.claim_text,
          extracted_value: c.extracted_value,
          extracted_unit: c.extracted_unit,
          metric_key: c.metric_key,
          driver: c.driver,
          period_text: c.period_text,
          verification_status: c.verification_status,
        }))
      );
    } catch {
      // ignore persistence failure
    }
  }
  return all;
}
