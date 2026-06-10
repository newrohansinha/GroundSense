import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

async function fetchJsonWithHardTimeout(url: string, timeoutMs: number) {
  const controller = new AbortController();

  const fetchPromise = fetch(url, {
    signal: controller.signal,
    headers: {
      "User-Agent": "GroundSense/1.0",
      Accept: "application/json",
    },
  })
    .then(async (response) => {
      if (!response.ok) {
        return {
          ok: false,
          error: `GDELT HTTP ${response.status}`,
          json: null,
        };
      }

      const json = await response.json();

      return {
        ok: true,
        error: null,
        json,
      };
    })
    .catch((error) => {
      return {
        ok: false,
        error: `GDELT fetch failure: ${String(error)}`,
        json: null,
      };
    });

  const timeoutPromise = new Promise<{
    ok: boolean;
    error: string;
    json: null;
  }>((resolve) => {
    setTimeout(() => {
      controller.abort();

      resolve({
        ok: false,
        error: `GDELT hard timeout after ${timeoutMs}ms`,
        json: null,
      });
    }, timeoutMs);
  });

  return await Promise.race([fetchPromise, timeoutPromise]);
}
function normalize(value: string) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^\w\s.:-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hashString(value: string) {
  let hash = 0;

  for (let index = 0; index < value.length; index++) {
    const char = value.charCodeAt(index);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }

  return Math.abs(hash).toString(36);
}

function canonicalizeUrl(url: string) {
  try {
    const parsed = new URL(url);
    parsed.hash = "";

    for (const key of [...parsed.searchParams.keys()]) {
      if (
        key.startsWith("utm_") ||
        key === "fbclid" ||
        key === "gclid" ||
        key === "ocid" ||
        key === "cmpid"
      ) {
        parsed.searchParams.delete(key);
      }
    }

    return parsed.toString();
  } catch {
    return url;
  }
}

function sourceTier(sourceName: string, url = "") {
  const text = normalize(`${sourceName} ${url}`);

  if (
    text.includes("reuters") ||
    text.includes("bloomberg") ||
    text.includes("wall street journal") ||
    text.includes("wsj") ||
    text.includes("financial times") ||
    text.includes("ft.com") ||
    text.includes("sec.gov")
  ) {
    return "tier_1";
  }

  if (
    text.includes("manufacturingdive") ||
    text.includes("manufacturing dive") ||
    text.includes("supplychaindive") ||
    text.includes("supply chain dive") ||
    text.includes("freightwaves") ||
    text.includes("modern distribution management") ||
    text.includes("mdm.com") ||
    text.includes("industrial distribution") ||
    text.includes("inddist") ||
    text.includes("construction dive") ||
    text.includes("utility dive") ||
    text.includes("enr.com") ||
    text.includes("engineering news-record") ||
    text.includes("fastmarkets") ||
    text.includes("spglobal") ||
    text.includes("s&p global")
  ) {
    return "tier_2";
  }

  if (
    text.includes("businesswire") ||
    text.includes("business wire") ||
    text.includes("prnewswire") ||
    text.includes("pr newswire") ||
    text.includes("globenewswire") ||
    text.includes("yahoo finance") ||
    text.includes("marketwatch") ||
    text.includes("nasdaq.com")
  ) {
    return "tier_3";
  }

  if (
    text.includes("simplywall") ||
    text.includes("moomoo") ||
    text.includes("stock titan") ||
    text.includes("stocktitan") ||
    text.includes("ad hoc news") ||
    text.includes("indexbox") ||
    text.includes("travel and tour world") ||
    text.includes("benzinga") ||
    text.includes("zacks")
  ) {
    return "low_quality";
  }

  return "tier_3";
}

function sourceQuality(sourceName: string, url = "") {
  const tier = sourceTier(sourceName, url);

  if (tier === "tier_1") return 92;
  if (tier === "tier_2") return 76;
  if (tier === "tier_3") return 56;
  return 20;
}

function ageDays(publishedAt: string) {
  const date = new Date(publishedAt);

  if (Number.isNaN(date.getTime())) return 9999;

  return Math.floor((Date.now() - date.getTime()) / 86_400_000);
}

function freshnessScore(age: number) {
  if (age <= 1) return 100;
  if (age <= 3) return 92;
  if (age <= 7) return 82;
  return 0;
}

function freshnessBucket(age: number) {
  if (age <= 7) return "fresh_week";
  return "stale";
}

function clusterKey(title: string) {
  return normalize(title)
    .replace(/\b(the|a|an|and|or|to|of|in|on|for|with|from|by)\b/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function relevanceSeedScore({
  title,
  queryText,
  quality,
  freshness,
}: {
  title: string;
  queryText: string;
  quality: number;
  freshness: number;
}) {
  const text = normalize(`${title} ${queryText}`);

  const terms = [
    "tariff",
    "tariffs",
    "duties",
    "export control",
    "steel",
    "aluminum",
    "copper",
    "freight",
    "shipping",
    "supply",
    "supplier",
    "manufacturing",
    "construction",
    "utilities",
    "infrastructure",
    "industrial",
    "margin",
    "pricing",
    "cost",
    "acquisition",
    "expansion",
    "earnings",
    "guidance",
    "demand",
    "contract",
    "award",
    "regulation",
    "sanction",
    "strike",
    "shutdown",
    "distribution",
    "warehouse",
  ];

  let score = 0;

  for (const term of terms) {
    if (text.includes(term)) score += 5;
  }

  score += Math.round(quality * 0.25);
  score += Math.round(freshness * 0.35);

  return Math.max(0, Math.min(100, score));
}

function formatGdeltDate(date: Date) {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mi = String(date.getUTCMinutes()).padStart(2, "0");
  const ss = String(date.getUTCSeconds()).padStart(2, "0");

  return `${yyyy}${mm}${dd}${hh}${mi}${ss}`;
}

function gdeltUrl(queryText: string, daysBack: number, maxRecords: number) {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - daysBack);

  const params = new URLSearchParams({
    query: `${queryText} sourcelang:english`,
    mode: "ArtList",
    format: "json",
    sort: "datedesc",
    maxrecords: String(maxRecords),
    startdatetime: formatGdeltDate(start),
    enddatetime: formatGdeltDate(end),
  });

  return `https://api.gdeltproject.org/api/v2/doc/doc?${params.toString()}`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const body = await req.json();

    const companyId = body.companyId;
    const queryText = String(body.queryText || `"Fastenal"`);
    const daysBack = Number(body.daysBack || 7);
    const maxRecords = Number(body.maxRecords || 50);

    if (!companyId) {
      return jsonResponse({
        generated: false,
        error: "Missing companyId",
        checked: 0,
        fetched: 0,
        inserted: 0,
        duplicates: 0,
        rejected: 0,
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse({
        generated: false,
        error: "Missing Supabase env vars",
        checked: 0,
        fetched: 0,
        inserted: 0,
        duplicates: 0,
        rejected: 0,
      });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const gdeltResult = await fetchJsonWithHardTimeout(
  gdeltUrl(queryText, daysBack, maxRecords),
  8000
);

if (!gdeltResult.ok || !gdeltResult.json) {
  return jsonResponse({
    generated: false,
    source_layer: "fresh_intelligence_single_query_v3",
    source: "gdelt",
    queryText,
    checked: 0,
    fetched: 0,
    inserted: 0,
    duplicates: 0,
    rejected: 0,
    skipped: true,
    error: gdeltResult.error,
  });
}

const json = gdeltResult.json;

    const articles = Array.isArray(json.articles) ? json.articles : [];

    const rows: any[] = [];
    let rejected = 0;

    for (const article of articles) {
      const title = String(article.title || "").trim();
      const url = String(article.url || article.url_mobile || "").trim();
      const sourceName = String(article.domain || "GDELT").trim();
      const publishedAt = String(article.seendate || "").trim();

      if (!title || !url || !publishedAt) {
        rejected++;
        continue;
      }

      const age = ageDays(publishedAt);
      const tier = sourceTier(sourceName, url);

      if (age > 7 || tier === "low_quality") {
        rejected++;
        continue;
      }

      const canonicalUrl = canonicalizeUrl(url);
      const quality = sourceQuality(sourceName, url);
      const fresh = freshnessScore(age);
      const key = clusterKey(title);
      const eventHash = hashString(`${canonicalUrl}|${key}`);

      rows.push({
        company_id: companyId,
        tracking_query_id: null,
        query_text: queryText,
        title,
        summary: title,
        source_url: url,
        canonical_url: canonicalUrl,
        source_name: sourceName,
        source_api: "gdelt",
        source_tier: tier,
        category: "fresh_news",
        published_at: new Date(publishedAt).toISOString(),
        raw_text: JSON.stringify(article),
        event_hash: eventHash,
        event_cluster_key: key,
        source_quality: quality,
        event_age_days: age,
        freshness_score: fresh,
        freshness_bucket: freshnessBucket(age),
        relevance_seed_score: relevanceSeedScore({
          title,
          queryText,
          quality,
          freshness: fresh,
        }),
      });
    }

    const uniqueRows: any[] = [];
    const seen = new Set<string>();

    for (const row of rows) {
      if (seen.has(row.event_hash)) continue;
      seen.add(row.event_hash);
      uniqueRows.push(row);
    }

    let inserted = 0;
    let duplicates = 0;
    let insertError: string | null = null;

    if (uniqueRows.length > 0) {
      const { data: existing, error: existingError } = await supabase
        .from("raw_events")
        .select("event_hash")
        .eq("company_id", companyId)
        .in(
          "event_hash",
          uniqueRows.map((row) => row.event_hash)
        );

      if (existingError) {
        return jsonResponse({
          generated: false,
          source_layer: "fresh_intelligence_single_query_v2",
          source: "gdelt",
          queryText,
          checked: articles.length,
          fetched: uniqueRows.length,
          inserted: 0,
          duplicates: 0,
          rejected,
          skipped: true,
          error: existingError.message,
        });
      }

      const existingHashes = new Set(
        (existing || []).map((row: any) => row.event_hash)
      );

      const newRows = uniqueRows.filter(
        (row) => !existingHashes.has(row.event_hash)
      );

      duplicates = uniqueRows.length - newRows.length;

      if (newRows.length > 0) {
        const { error } = await supabase.from("raw_events").insert(newRows);

        if (error) {
          insertError = error.message;
        } else {
          inserted = newRows.length;
        }
      }
    }

    return jsonResponse({
      generated: true,
      source_layer: "fresh_intelligence_single_query_v2",
      source: "gdelt",
      queryText,
      daysBack,
      checked: articles.length,
      fetched: uniqueRows.length,
      inserted,
      duplicates,
      rejected,
      insertError,
      sampleTitles: uniqueRows.slice(0, 5).map((row) => row.title),
    });
  } catch (error) {
    return jsonResponse({
      generated: false,
      source_layer: "fresh_intelligence_single_query_v2",
      source: "gdelt",
      checked: 0,
      fetched: 0,
      inserted: 0,
      duplicates: 0,
      rejected: 0,
      skipped: true,
      error: String(error),
    });
  }
});