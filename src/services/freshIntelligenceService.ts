import { supabase } from "../lib/supabase";
import {
  scoreNewsSource,
  getArticleNoiseReason,
} from "./newsQuality";

function isValidUuid(value: unknown) {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value
    )
  );
}

type TrackingQuery = {
  id: string;
  company_id: string;
  query_name: string;
  query_text: string;
  query_type: string;
  required_terms: string[] | null;
  signal_terms: string[] | null;
  blocked_terms: string[] | null;
  min_relevance_score: number | null;
};

type CurrentsArticle = {
  id?: string;
  title?: string;
  description?: string;
  url?: string;
  author?: string | null;
  image?: string | null;
  language?: string;
  category?: string[];
  published?: string;
};

type NormalizedArticle = {
  company_id: string;
  title: string;
  description: string | null;
  source_url: string;
  source_name: string;
  query_text: string;
  published_at: string | null;
  source_quality: number;
  event_age_days: number | null;
  relevance_seed_score: number;
  freshness_bucket: string;
  source_api: string;
  source_tier: string;
  tracking_query_id: string | null;
  matched_terms: string[];
  signal_terms: string[];
  quality_reason: string;
};

type BatchStats = {
  checked: number;
  fetched: number;
  inserted: number;
  duplicates: number;
  rejected: number;
  failedCalls: number;
  rateLimited: number;
};

let stopRequested = false;

const TARGET_FRESH_ARTICLES = 500;
const PAGE_SIZE = 50;
const PAGES_PER_QUERY = 1;
const FRESH_DAYS = 7;

const NORMAL_COOLDOWN_MS = 2500;
const QUERY_COOLDOWN_MS = 3500;
const RATE_LIMIT_COOLDOWN_MS = 60000;

const GLOBAL_BLOCKED_TERMS = [
  "market cap rank",
"relative strength rating",
"stock watch",
"analyst rating",
"shares crossed",
"etf inflow",
"etf outflow",
"zacks",
"investorplace",
"simply wall st",
"insider monkey",
"motley fool",
"stock market crash",
"msci rebalancing",
"msci index",
"options now available",
"quantitative value",
"market neutral index",
"fund commentary",
"noteworthy etf",
"norges bank acquires",
  "sports",
  "football",
  "soccer",
  "rugby",
  "lottery",
  "celebrity",
  "movie",
  "music",
  "recipe",
  "gaming",
  "student loan",
  "prostate",
  "shooting",
  "homicide",
  "audiobook",
  "crossword",
  "speaker",
  "airpods",
  "skincare",
  "donut",
  "beer brand",
  "taylor swift",
  "ballet",
  "euromillions",
];

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function normalizeText(value: unknown) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^\w\s.$%-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function domainFromUrl(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function parseDate(value: unknown) {
  const raw = String(value || "").trim();

  if (!raw) return null;

  const date = new Date(raw);

  if (Number.isNaN(date.getTime())) return null;

  return date;
}

function ageDays(date: Date | null) {
  if (!date) return null;

  const diff = Date.now() - date.getTime();

  return Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)));
}

function freshnessBucket(days: number | null) {
  if (days === null) return "unknown_date";
  if (days <= 1) return "last_24h";
  if (days <= 3) return "last_3d";
  if (days <= 7) return "last_7d";
  return "stale";
}

function sourceTier(score: number) {
  if (score >= 90) return "tier_1";
  if (score >= 72) return "tier_2";
  return "tier_3";
}

function termMatches(text: string, terms: string[]) {
  return terms.filter((term) => {
    const normalized = normalizeText(term);

    if (!normalized) return false;

    return text.includes(normalized);
  });
}

// Words from a query that carry relevance (e.g. "China Steel tariffs" →
// ["china","steel","tariffs"]). Used to score relevance when a tracking query
// has no explicit required/signal terms (auto-seeded queries), so articles
// aren't all rejected for "low relevance".
const QUERY_TERM_STOPWORDS = new Set([
  "the", "and", "for", "with", "into", "from", "you", "your",
]);
function deriveQueryTerms(queryText: string): string[] {
  return String(queryText || "")
    .toLowerCase()
    .replace(/["']/g, " ")
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 3 && !QUERY_TERM_STOPWORDS.has(w));
}

function calculateArticleQuality(input: {
  article: CurrentsArticle;
  query: TrackingQuery;
  source: ReturnType<typeof scoreNewsSource>;
  days: number | null;
}) {
  const title = normalizeText(input.article.title || "");
  const description = normalizeText(input.article.description || "");
  const text = `${title} ${description}`;

  const noiseReason = getArticleNoiseReason({
    title: input.article.title,
    description: input.article.description,
    source: input.source,
  });

  const requiredTerms = input.query.required_terms || [];
  const signalTerms = input.query.signal_terms || [];
  const blockedTerms = [
    ...GLOBAL_BLOCKED_TERMS,
    ...(input.query.blocked_terms || []),
  ];

  const matchedRequired = termMatches(text, requiredTerms);
  const matchedSignals = termMatches(text, signalTerms);
  const matchedBlocked = termMatches(text, blockedTerms);

  if (noiseReason) {
    return {
      accepted: false,
      score: 0,
      matchedRequired,
      matchedSignals,
      reason: noiseReason,
    };
  }

  if (matchedBlocked.length > 0) {
    return {
      accepted: false,
      score: 0,
      matchedRequired,
      matchedSignals,
      reason: `Rejected blocked terms: ${matchedBlocked.join(", ")}`,
    };
  }

  if (requiredTerms.length > 0 && matchedRequired.length === 0) {
    return {
      accepted: false,
      score: 0,
      matchedRequired,
      matchedSignals,
      reason: `Rejected missing required terms: ${requiredTerms.join(", ")}`,
    };
  }

  if (signalTerms.length > 0 && matchedSignals.length === 0) {
    return {
      accepted: false,
      score: 0,
      matchedRequired,
      matchedSignals,
      reason: `Rejected missing signal terms: ${signalTerms.join(", ")}`,
    };
  }

  // Auto-seeded queries have no required/signal terms; derive relevance from the
  // query's own words so genuinely relevant articles aren't all rejected.
  const noConfiguredTerms = requiredTerms.length === 0 && signalTerms.length === 0;
  const derivedTerms = noConfiguredTerms ? deriveQueryTerms(input.query.query_text) : [];
  const matchedDerived = noConfiguredTerms ? termMatches(text, derivedTerms) : [];

  let score = 0;

  if (matchedRequired.length > 0) score += 45;

  score += Math.min(35, matchedSignals.length * 18);

  // Query-word relevance (only when no explicit terms were configured).
  if (noConfiguredTerms && matchedDerived.length > 0) {
    score += 40 + Math.min(40, matchedDerived.length * 18);
  }

  if (input.source.score >= 90) score += 18;
  else if (input.source.score >= 80) score += 12;
  else if (input.source.score >= 65) score += 7;
  else if (input.source.score >= 50) score += 3;

  if (input.days !== null) {
    if (input.days <= 1) score += 10;
    else if (input.days <= 3) score += 7;
    else if (input.days <= 7) score += 4;
  }

  const minScore = Number(input.query.min_relevance_score || 70);

  if (score < minScore) {
    return {
      accepted: false,
      score: Math.min(100, Math.max(0, Math.round(score))),
      matchedRequired,
      matchedSignals,
      reason: `Rejected low relevance score ${score}. Minimum ${minScore}. Required: ${matchedRequired.join(
        ", "
      )}. Signals: ${matchedSignals.join(", ")}. Source: ${
        input.source.reason
      }.`,
    };
  }

  const finalScore = Math.min(100, Math.max(0, Math.round(score)));

return {
  accepted: true,
  score: finalScore,
  matchedRequired,
  matchedSignals: noConfiguredTerms ? matchedDerived : matchedSignals,
  reason: `Accepted. Required: ${matchedRequired.join(
    ", "
  )}. Signals: ${matchedSignals.join(", ")}. Source: ${
    input.source.reason
  }. Source quality: ${input.source.score}. Age days: ${
    input.days
  }. Score ${finalScore}.`,
};
}

function startDateIso() {
  const date = new Date();

  date.setUTCDate(date.getUTCDate() - FRESH_DAYS);

  return date.toISOString();
}

async function loadTrackingQueries(companyId: string) {
  const { data, error } = await supabase
    .from("news_tracking_queries")
    .select("*")
    .eq("company_id", companyId)
    .eq("active", true)
    .order("created_at", { ascending: true });

  if (error) throw error;

  return (data || []) as TrackingQuery[];
}

async function fetchCurrentsQuery(query: string, cursor?: string | null) {
  const { data, error } = await supabase.functions.invoke(
    "fetch-currents-query",
    {
      body: {
        query,
        pageSize: PAGE_SIZE,
        startDate: startDateIso(),
        endDate: new Date().toISOString(),
        cursor: cursor || null,
      },
    }
  );

  if (error) {
    return {
      ok: false as const,
      type: "edge_invoke_error",
      articles: [] as CurrentsArticle[],
      nextCursor: null as string | null,
      message: error.message || "Supabase function invoke failed.",
    };
  }

  if (!data?.ok) {
    return {
      ok: false as const,
      type: data?.type || "currents_failure",
      articles: [] as CurrentsArticle[],
      nextCursor: null as string | null,
      message: data?.message || "Currents query failed.",
    };
  }

  return {
    ok: true as const,
    type: "success",
    articles: Array.isArray(data.articles)
      ? (data.articles as CurrentsArticle[])
      : [],
    nextCursor: data.next_cursor || null,
    message: data?.source_used
      ? `Used ${data.source_used}. Count ${data.count || 0}.`
      : "ok",
  };
}

function normalizeArticle(
  companyId: string,
  article: CurrentsArticle,
  query: TrackingQuery
): NormalizedArticle | null {
  const title = String(article.title || "").trim();
  const description = String(article.description || "").trim();
  const sourceUrl = String(article.url || "").trim();

  if (!title || !sourceUrl) return null;

  const domain = domainFromUrl(sourceUrl);
  const publishedDate = parseDate(article.published);
  const days = ageDays(publishedDate);

  if (!publishedDate || days === null) return null;
  if (days > FRESH_DAYS) return null;

  const source = scoreNewsSource({
    url: sourceUrl,
    sourceName: domain,
  });

  const quality = calculateArticleQuality({
    article,
    query,
    source,
    days,
  });

  if (!quality.accepted) return null;

  return {
    company_id: companyId,
    title,
    description: description || null,
    source_url: sourceUrl,
    source_name: domain,
    query_text: query.query_text,
    published_at: publishedDate.toISOString(),
    source_quality: quality.score,
    event_age_days: days,
    relevance_seed_score: quality.score,
    freshness_bucket: freshnessBucket(days),
    source_api: "currents_api",
    source_tier: sourceTier(source.score),
    tracking_query_id: isValidUuid(query.id) ? query.id : null,
    matched_terms: quality.matchedRequired,
    signal_terms: quality.matchedSignals,
    quality_reason: quality.reason,
  };
}

async function existingUrls(companyId: string, urls: string[]) {
  if (urls.length === 0) return new Set<string>();

  const uniqueUrls = [...new Set(urls)].slice(0, 500);

  const { data, error } = await supabase
    .from("raw_events")
    .select("source_url")
    .eq("company_id", companyId)
    .in("source_url", uniqueUrls);

  if (error) {
    console.log("Could not check existing raw_events URLs. Continuing safely.", error);
    return new Set<string>();
  }

  return new Set((data || []).map((row) => row.source_url).filter(Boolean));
}

async function backfillExistingDescriptions(
  companyId: string,
  rows: NormalizedArticle[]
) {
  const rowsWithDescriptions = rows.filter(
    (row) => row.source_url && row.description && row.description.trim()
  );

  if (rowsWithDescriptions.length === 0) return 0;

  let updated = 0;

  for (const row of rowsWithDescriptions) {
    const { error } = await supabase
      .from("raw_events")
      .update({
        description: row.description,
      })
      .eq("company_id", companyId)
      .eq("source_url", row.source_url)
      .or("description.is.null,description.eq.");

    if (!error) {
      updated += 1;
    } else {
      console.log("Could not backfill raw_event description", {
        title: row.title,
        source_url: row.source_url,
        error: error.message,
      });
    }
  }

  if (updated > 0) {
    console.log("Backfilled existing raw_event descriptions", {
      updated,
    });
  }

  return updated;
}
async function insertArticles(rows: NormalizedArticle[]) {
  if (rows.length === 0) return 0;

  const { error } = await supabase.from("raw_events").insert(rows);

  if (!error) return rows.length;

  console.log("raw_events insert error:", error.message);

const minimalRows = rows.map((row) => ({
  company_id: row.company_id,
  title: row.title,
  description: row.description,
  source_url: row.source_url,
  source_name: row.source_name,
  query_text: row.query_text,
  published_at: row.published_at,
  source_quality: row.source_quality,
  event_age_days: row.event_age_days,
  relevance_seed_score: row.relevance_seed_score,
  freshness_bucket: row.freshness_bucket,
  source_api: row.source_api,
  source_tier: row.source_tier,
}));

  const fallback = await supabase.from("raw_events").insert(minimalRows);

  if (fallback.error) {
    console.log("raw_events minimal insert skipped:", fallback.error.message);
    return 0;
  }

  return rows.length;
}

async function updateTrackingQueryStats(
  query: TrackingQuery,
  fetched: number,
  inserted: number,
  rejected: number
) {
  await supabase
    .from("news_tracking_queries")
    .update({
      last_run_at: new Date().toISOString(),
      last_fetched_count: fetched,
      last_inserted_count: inserted,
      last_rejected_count: rejected,
      updated_at: new Date().toISOString(),
    })
    .eq("id", query.id);
}

function progressMessage(done: number, total: number, stats: BatchStats) {
  const pct = Math.round((done / total) * 100);

  console.log(`Fresh intelligence progress ${done}/${total} (${pct}%)`, {
    checked: stats.checked,
    fetched: stats.fetched,
    inserted: stats.inserted,
    duplicates: stats.duplicates,
    rejected: stats.rejected,
    failedCalls: stats.failedCalls,
    rateLimited: stats.rateLimited,
  });
}

export function stopFreshIntelligenceBatch() {
  stopRequested = true;
  console.log("Fresh intelligence batch stop requested.");
}

export async function fetchFreshIntelligenceForCompany(companyId: string, options?: { silent?: boolean }) {
  const silent = options?.silent ?? false;
  stopRequested = false;

  const queries = await loadTrackingQueries(companyId);

  if (queries.length === 0) {
    if (!silent) alert("No active tracking queries found. Add rows to news_tracking_queries first.");
    return;
  }

  const stats: BatchStats = {
    checked: 0,
    fetched: 0,
    inserted: 0,
    duplicates: 0,
    rejected: 0,
    failedCalls: 0,
    rateLimited: 0,
  };

  const seenInThisRun = new Set<string>();

  console.log("Starting high-quality Currents intelligence batch", {
    targetFreshArticles: TARGET_FRESH_ARTICLES,
    pageSize: PAGE_SIZE,
    trackingQueries: queries.length,
    pagesPerQuery: PAGES_PER_QUERY,
  });

  let unitsDone = 0;
  const totalUnits = queries.length * PAGES_PER_QUERY;

  for (const query of queries) {
    if (stopRequested) break;
    if (stats.inserted >= TARGET_FRESH_ARTICLES) break;

    let cursor: string | null = null;
    let queryFetched = 0;
    let queryInserted = 0;
    let queryRejected = 0;

    for (let page = 0; page < PAGES_PER_QUERY; page++) {
      if (stopRequested) break;
      if (stats.inserted >= TARGET_FRESH_ARTICLES) break;

      const result = await fetchCurrentsQuery(query.query_text, cursor);

      unitsDone += 1;

      console.log("Tracking query result", {
        queryName: query.query_name,
        queryText: query.query_text,
        ok: result.ok,
        articles: result.articles.length,
        message: result.message,
      });

      if (!result.ok) {
        stats.failedCalls += 1;

        if (result.type === "rate_limit") {
          stats.rateLimited += 1;
          progressMessage(unitsDone, totalUnits, stats);
          await sleep(RATE_LIMIT_COOLDOWN_MS);
          continue;
        }

        progressMessage(unitsDone, totalUnits, stats);
        await sleep(QUERY_COOLDOWN_MS);
        continue;
      }

      stats.fetched += result.articles.length;
      queryFetched += result.articles.length;

      const normalized = result.articles
        .map((article) => normalizeArticle(companyId, article, query))
        .filter((row): row is NormalizedArticle => Boolean(row));
      
      console.log("Normalized article description check", {
  queryName: query.query_name,
  normalizedCount: normalized.length,
  withDescription: normalized.filter((row) => row.description).length,
  samples: normalized.slice(0, 3).map((row) => ({
    title: row.title,
    hasDescription: Boolean(row.description),
    descriptionPreview: row.description?.slice(0, 160),
  })),
});

      const rejectedThisPage = result.articles.length - normalized.length;

      if (rejectedThisPage > 0 && normalized.length === 0) {
        console.log("All articles rejected for query", {
          queryName: query.query_name,
          queryText: query.query_text,
          requiredTerms: query.required_terms,
          signalTerms: query.signal_terms,
          sampleTitles: result.articles
            .slice(0, 5)
            .map((article) => article.title),
        });
      }

      stats.rejected += Math.max(0, rejectedThisPage);
      queryRejected += Math.max(0, rejectedThisPage);

      const freshRows: NormalizedArticle[] = [];

      for (const row of normalized) {
        stats.checked += 1;

        const key = row.source_url || `${row.title}-${row.published_at}`;

        if (seenInThisRun.has(key)) {
          stats.duplicates += 1;
          continue;
        }

        seenInThisRun.add(key);
        freshRows.push(row);
      }

      const existing = await existingUrls(
  companyId,
  freshRows.map((row) => row.source_url)
);

await backfillExistingDescriptions(companyId, freshRows);

const newRows = freshRows.filter((row) => {
        if (existing.has(row.source_url)) {
          stats.duplicates += 1;
          return false;
        }

        return true;
      });

      const remainingCapacity = TARGET_FRESH_ARTICLES - stats.inserted;
      const rowsToInsert = newRows.slice(0, Math.max(0, remainingCapacity));

      const inserted = await insertArticles(rowsToInsert);
      stats.inserted += inserted;
      queryInserted += inserted;

      cursor = result.nextCursor;

      progressMessage(unitsDone, totalUnits, stats);

      if (!cursor) break;

      await sleep(NORMAL_COOLDOWN_MS);
    }

    await updateTrackingQueryStats(
      query,
      queryFetched,
      queryInserted,
      queryRejected
    );

    await sleep(QUERY_COOLDOWN_MS);
  }

  const message = `Fresh intelligence complete.

Source: Currents API
Mode: tracking query table + strict quality gate
Queries used: ${queries.length}
Inserted: ${stats.inserted}
Fetched: ${stats.fetched}
Checked: ${stats.checked}
Duplicates skipped: ${stats.duplicates}
Rejected by quality gate: ${stats.rejected}
Failed calls: ${stats.failedCalls}
Rate limited: ${stats.rateLimited}`;

  console.log(message);
  if (!silent) alert(message);
}

export async function fetchArticleContentForCompany(companyId: string) {
  const { data, error } = await supabase.functions.invoke(
    "fetch-article-content",
    {
      body: {
        companyId,
        limit: 15,
      },
    }
  );

  if (error) {
    console.error("Article body fetch failed", error);
    alert(error.message || "Article body fetch failed");
    return;
  }

  console.log("Article body fetch result", data);

  alert(`Article body fetch complete.

Checked: ${data?.checked || 0}
Updated: ${data?.updated || 0}
Failed: ${data?.failed || 0}`);
}