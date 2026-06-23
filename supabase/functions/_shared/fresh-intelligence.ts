// Server-side port of the browser "fresh intelligence" Currents fetch.
//
// This is the SAME high-quality Currents path the manual run used to execute in
// the browser (src/services/freshIntelligenceService.ts) — tracking-query table
// (news_tracking_queries) + strict relevance gate + dedupe + cap — now owned by
// the server so it survives the browser closing. It calls the existing
// fetch-currents-query edge function server-to-server with the service key and
// writes raw_events directly. The relevance/dedupe/cap behaviour is preserved
// faithfully (do-not-break list).
//
// Never logs secrets. The service key is only used as a bearer for the internal
// fetch-currents-query invoke.

// deno-lint-ignore-file no-explicit-any

// ── News source quality (ported verbatim from src/services/newsQuality.ts) ──

type NewsSourceQuality = {
  domain: string;
  sourceName: string;
  score: number;
  tier: "tier_1" | "tier_2" | "tier_3" | "blocked";
  blocked: boolean;
  reason: string;
};

const TIER_1_DOMAINS = new Set([
  "reuters.com", "apnews.com", "bloomberg.com", "wsj.com", "ft.com", "cnbc.com",
  "nasdaq.com", "marketwatch.com", "finance.yahoo.com", "federalregister.gov",
  "whitehouse.gov", "ustr.gov", "commerce.gov", "census.gov", "bls.gov",
  "bea.gov", "ismworld.org", "steel.org",
]);
const TIER_1_SOURCE_NAMES = [
  "reuters", "associated press", "ap news", "bloomberg", "wall street journal",
  "financial times", "cnbc", "nasdaq", "yahoo finance", "federal register",
  "u.s. census", "bureau of labor statistics", "bureau of economic analysis",
  "institute for supply management", "american iron and steel institute",
];
const TIER_2_DOMAINS = new Set([
  "supplychaindive.com", "constructiondive.com", "manufacturingdive.com",
  "industryweek.com", "freightwaves.com", "spglobal.com", "kitco.com",
  "gmk.center", "steelnews.biz", "eurometal.net", "worldsteel.org",
  "metalbulletin.com", "mining.com", "splash247.com", "maritimegateway.com",
  "logisticsmgmt.com", "dcvelocity.com", "mhnetwork.com", "businesswire.com",
  "prnewswire.com", "globenewswire.com",
]);
const TIER_2_SOURCE_NAMES = [
  "supply chain dive", "construction dive", "manufacturing dive", "industryweek",
  "freightwaves", "s&p global", "sp global", "kitco", "gmk center", "eurometal",
  "world steel", "business wire", "pr newswire", "globe newswire",
];
const BLOCKED_DOMAINS = new Set([
  "marketbeat.com", "simplywall.st", "moomoo.com", "ad-hoc-news.de",
  "ad-hoc-news.com", "thelegaladvocate.com", "kalkinemedia.com", "indexbox.io",
  "indexbox.com", "dev.to", "mirror.co.uk", "jalopnik.com", "soompi.com",
  "deadline.com", "esquire.com", "thetakeout.com", "wccftech.com",
  "androidheadlines.com", "walesonline.co.uk", "dailypost.ng", "thewrap.com",
  "techradar.com",
]);
const BLOCKED_SOURCE_NAMES = [
  "marketbeat", "simply wall st", "simplywall", "moomoo", "ad hoc news",
  "indexbox", "kalkine", "legal advocate",
];
const INVESTMENT_NOISE_TERMS = [
  "takes position", "new position", "grows stake", "increases holdings",
  "sells shares", "sells stock", "purchases shares", "bought by", "trims stock",
  "stock holdings", "price target", "analyst says", "analyst rating",
  "valuation check", "valuation after", "shareholder returns",
  "institutional investor", "asset management", "wealth management",
  "norges bank", "fideuram", "legal & general", "nomura", "jefferies",
  "morgan stanley adjusts", "wall street bullish", "wall street bearish",
  "stock price expected", "stock split", "insider buying", "director acquires",
  "shares acquired", "shares of stock",
];
const GLOBAL_NEWS_NOISE_TERMS = [
  "sports", "football", "soccer", "rugby", "lottery", "celebrity", "movie",
  "music", "recipe", "gaming", "student loan", "prostate", "shooting",
  "homicide", "audiobook", "crossword", "speaker", "airpods", "skincare",
  "donut", "beer brand", "taylor swift", "ballet", "euromillions", "world cup",
  "transfer:",
];

function normalizeNewsText(value: unknown) {
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
function domainMatches(domain: string, knownDomain: string) {
  return domain === knownDomain || domain.endsWith(`.${knownDomain}`);
}
function setContainsDomain(set: Set<string>, domain: string) {
  for (const knownDomain of set) if (domainMatches(domain, knownDomain)) return true;
  return false;
}
function textContainsAny(text: string, terms: string[]) {
  return terms.find((term) => text.includes(normalizeNewsText(term))) || null;
}

function scoreNewsSource(input: { url?: string | null; sourceName?: string | null }): NewsSourceQuality {
  const domain = domainFromUrl(String(input.url || ""));
  const sourceName = normalizeNewsText(input.sourceName || domain);
  const combined = `${domain} ${sourceName}`;
  if (setContainsDomain(BLOCKED_DOMAINS, domain))
    return { domain, sourceName: sourceName || domain, score: 0, tier: "blocked", blocked: true, reason: `Blocked domain: ${domain}` };
  const blockedName = textContainsAny(combined, BLOCKED_SOURCE_NAMES);
  if (blockedName)
    return { domain, sourceName: sourceName || domain, score: 0, tier: "blocked", blocked: true, reason: `Blocked source name: ${blockedName}` };
  if (setContainsDomain(TIER_1_DOMAINS, domain))
    return { domain, sourceName: sourceName || domain, score: 95, tier: "tier_1", blocked: false, reason: `Tier 1 domain: ${domain}` };
  const tier1Name = textContainsAny(combined, TIER_1_SOURCE_NAMES);
  if (tier1Name)
    return { domain, sourceName: sourceName || tier1Name, score: 95, tier: "tier_1", blocked: false, reason: `Tier 1 source name: ${tier1Name}` };
  if (setContainsDomain(TIER_2_DOMAINS, domain))
    return { domain, sourceName: sourceName || domain, score: 82, tier: "tier_2", blocked: false, reason: `Tier 2 domain: ${domain}` };
  const tier2Name = textContainsAny(combined, TIER_2_SOURCE_NAMES);
  if (tier2Name)
    return { domain, sourceName: sourceName || tier2Name, score: 82, tier: "tier_2", blocked: false, reason: `Tier 2 source name: ${tier2Name}` };
  if (domain.endsWith(".gov"))
    return { domain, sourceName: sourceName || domain, score: 94, tier: "tier_1", blocked: false, reason: `Government source: ${domain}` };
  if (domain.endsWith(".edu"))
    return { domain, sourceName: sourceName || domain, score: 78, tier: "tier_2", blocked: false, reason: `Academic source: ${domain}` };
  if (domain.includes("business") || domain.includes("finance") || domain.includes("industry") || domain.includes("logistics") || domain.includes("manufacturing"))
    return { domain, sourceName: sourceName || domain, score: 65, tier: "tier_3", blocked: false, reason: `Business-adjacent source: ${domain}` };
  return { domain, sourceName: sourceName || domain || "unknown", score: 50, tier: "tier_3", blocked: false, reason: `Unclassified source: ${domain || sourceName || "unknown"}` };
}

function getArticleNoiseReason(input: { title?: string | null; description?: string | null; source?: NewsSourceQuality }) {
  const text = normalizeNewsText(`${input.title || ""} ${input.description || ""}`);
  if (input.source?.blocked) return input.source.reason;
  const investmentNoise = textContainsAny(text, INVESTMENT_NOISE_TERMS);
  if (investmentNoise) return `Rejected investment ownership or valuation noise: ${investmentNoise}`;
  const globalNoise = textContainsAny(text, GLOBAL_NEWS_NOISE_TERMS);
  if (globalNoise) return `Rejected general news noise: ${globalNoise}`;
  return null;
}

// ── Fresh-intelligence fetch (ported from freshIntelligenceService.ts) ──────

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
  title?: string;
  description?: string;
  url?: string;
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

export type FreshIntelligenceCounters = {
  raw_queries_generated: number;
  deduped_queries: number;
  capped_queries: number;
  queries_executed: number;
  articles_fetched: number;
  articles_normalized: number;
  articles_inserted: number;
  article_duplicates: number;
  articles_rejected: number;              // failed the relevance gate
  articles_failed_normalization: number;  // missing fields / unparseable or stale date
  articles_failed_insert: number;         // normalized + new, but the DB write failed
  articles_skipped: number;               // not processed (cap/remainder)
  failed_calls: number;
  rate_limited: number;
};

const TARGET_FRESH_ARTICLES = 500;
const PAGE_SIZE = 50;
const FRESH_DAYS = 7;
// Hard cap on distinct queries executed per run so a runaway query table can't
// blow the edge-function budget (preserves "query dedupe/cap").
const QUERY_CAP = 80;
const NORMAL_COOLDOWN_MS = 600;
const QUERY_COOLDOWN_MS = 900;
const RATE_LIMIT_COOLDOWN_MS = 15000;

const GLOBAL_BLOCKED_TERMS = [
  "market cap rank", "relative strength rating", "stock watch", "analyst rating",
  "shares crossed", "etf inflow", "etf outflow", "zacks", "investorplace",
  "simply wall st", "insider monkey", "motley fool", "stock market crash",
  "msci rebalancing", "msci index", "options now available", "quantitative value",
  "market neutral index", "fund commentary", "noteworthy etf",
  "norges bank acquires", "sports", "football", "soccer", "rugby", "lottery",
  "celebrity", "movie", "music", "recipe", "gaming", "student loan", "prostate",
  "shooting", "homicide", "audiobook", "crossword", "speaker", "airpods",
  "skincare", "donut", "beer brand", "taylor swift", "ballet", "euromillions",
];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function isValidUuid(v: unknown) { return typeof v === "string" && UUID_RE.test(v); }
function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }
function normalizeText(v: unknown) {
  return String(v || "").toLowerCase().replace(/[^\w\s.$%-]/g, " ").replace(/\s+/g, " ").trim();
}
function parseDate(v: unknown) {
  const raw = String(v || "").trim();
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}
function ageDays(d: Date | null) {
  if (!d) return null;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86_400_000));
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
    const n = normalizeText(term);
    return n ? text.includes(n) : false;
  });
}
const QUERY_TERM_STOPWORDS = new Set(["the", "and", "for", "with", "into", "from", "you", "your"]);
function deriveQueryTerms(queryText: string): string[] {
  return String(queryText || "")
    .toLowerCase().replace(/["']/g, " ").replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/).map((w) => w.trim())
    .filter((w) => w.length >= 3 && !QUERY_TERM_STOPWORDS.has(w));
}

function calculateArticleQuality(input: { article: CurrentsArticle; query: TrackingQuery; source: NewsSourceQuality; days: number | null }) {
  const title = normalizeText(input.article.title || "");
  const description = normalizeText(input.article.description || "");
  const text = `${title} ${description}`;
  const noiseReason = getArticleNoiseReason({ title: input.article.title, description: input.article.description, source: input.source });
  const requiredTerms = input.query.required_terms || [];
  const signalTerms = input.query.signal_terms || [];
  const blockedTerms = [...GLOBAL_BLOCKED_TERMS, ...(input.query.blocked_terms || [])];
  const matchedRequired = termMatches(text, requiredTerms);
  const matchedSignals = termMatches(text, signalTerms);
  const matchedBlocked = termMatches(text, blockedTerms);
  if (noiseReason) return { accepted: false, score: 0, matchedRequired, matchedSignals, reason: noiseReason };
  if (matchedBlocked.length > 0) return { accepted: false, score: 0, matchedRequired, matchedSignals, reason: `Rejected blocked terms: ${matchedBlocked.join(", ")}` };
  if (requiredTerms.length > 0 && matchedRequired.length === 0) return { accepted: false, score: 0, matchedRequired, matchedSignals, reason: `Rejected missing required terms: ${requiredTerms.join(", ")}` };
  if (signalTerms.length > 0 && matchedSignals.length === 0) return { accepted: false, score: 0, matchedRequired, matchedSignals, reason: `Rejected missing signal terms: ${signalTerms.join(", ")}` };

  const noConfiguredTerms = requiredTerms.length === 0 && signalTerms.length === 0;
  const derivedTerms = noConfiguredTerms ? deriveQueryTerms(input.query.query_text) : [];
  const matchedDerived = noConfiguredTerms ? termMatches(text, derivedTerms) : [];
  let score = 0;
  if (matchedRequired.length > 0) score += 45;
  score += Math.min(35, matchedSignals.length * 18);
  if (noConfiguredTerms && matchedDerived.length > 0) score += 40 + Math.min(40, matchedDerived.length * 18);
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
    return { accepted: false, score: Math.min(100, Math.max(0, Math.round(score))), matchedRequired, matchedSignals, reason: `Rejected low relevance score ${score}. Minimum ${minScore}.` };
  }
  const finalScore = Math.min(100, Math.max(0, Math.round(score)));
  return { accepted: true, score: finalScore, matchedRequired, matchedSignals: noConfiguredTerms ? matchedDerived : matchedSignals, reason: `Accepted. Score ${finalScore}. Source quality ${input.source.score}. Age ${input.days}.` };
}

function startDateIso() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - FRESH_DAYS);
  return d.toISOString();
}

type ArticleBucket = "ok" | "bad_data" | "stale" | "relevance";

// Classifies an article into exactly one bucket so the run can reconcile every
// fetched article. bad_data/stale → failed_normalization; relevance → rejected.
function classifyArticle(companyId: string, article: CurrentsArticle, query: TrackingQuery): { row: NormalizedArticle | null; bucket: ArticleBucket; reason: string } {
  const title = String(article.title || "").trim();
  const description = String(article.description || "").trim();
  const sourceUrl = String(article.url || "").trim();
  if (!title || !sourceUrl) return { row: null, bucket: "bad_data", reason: "missing title or url" };
  const domain = domainFromUrl(sourceUrl);
  const publishedDate = parseDate(article.published);
  const days = ageDays(publishedDate);
  if (!publishedDate || days === null) return { row: null, bucket: "bad_data", reason: "unparseable published date" };
  if (days > FRESH_DAYS) return { row: null, bucket: "stale", reason: `older than ${FRESH_DAYS}d (${days}d)` };
  const source = scoreNewsSource({ url: sourceUrl, sourceName: domain });
  const quality = calculateArticleQuality({ article, query, source, days });
  if (!quality.accepted) return { row: null, bucket: "relevance", reason: quality.reason };
  return {
    bucket: "ok",
    reason: quality.reason,
    row: {
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
    },
  };
}

function normalizeArticle(companyId: string, article: CurrentsArticle, query: TrackingQuery): NormalizedArticle | null {
  return classifyArticle(companyId, article, query).row;
}

export type FreshFetchOptions = {
  supabaseUrl: string;
  serviceKey: string;
  // Called after each query so the caller can write a server heartbeat.
  onProgress?: (p: { executed: number; total: number; counters: FreshIntelligenceCounters }) => void | Promise<void>;
  // Ultra-debug / dry-run controls.
  queryCap?: number;            // override the default distinct-query cap
  maxArticlesPerQuery?: number; // cap articles processed per query
  dryRun?: boolean;             // fetch + normalize but DO NOT insert raw_events
};

function emptyCounters(): FreshIntelligenceCounters {
  return {
    raw_queries_generated: 0, deduped_queries: 0, capped_queries: 0,
    queries_executed: 0, articles_fetched: 0, articles_normalized: 0,
    articles_inserted: 0, article_duplicates: 0, articles_rejected: 0,
    articles_failed_normalization: 0, articles_failed_insert: 0, articles_skipped: 0,
    failed_calls: 0, rate_limited: 0,
  };
}

// Loads the company's active tracking queries and applies dedupe + cap. The
// result is DETERMINISTIC (stable order) so a resumable chunked run sees the
// same list + indices across invocations.
async function loadCappedQueries(db: any, companyId: string, queryCapOpt?: number): Promise<{
  capped: TrackingQuery[]; rawCount: number; dedupedRemoved: number; cappedRemoved: number;
}> {
  const { data: rawQueries, error } = await db
    .from("news_tracking_queries")
    .select("*")
    .eq("company_id", companyId)
    .eq("active", true)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  if (error) throw new Error(`load tracking queries: ${error.message}`);

  const all = (rawQueries || []) as TrackingQuery[];
  const seenText = new Set<string>();
  const deduped: TrackingQuery[] = [];
  for (const q of all) {
    const key = normalizeText(q.query_text);
    if (!key || seenText.has(key)) continue;
    seenText.add(key);
    deduped.push(q);
  }
  const effectiveQueryCap = Math.max(1, Math.min(QUERY_CAP, queryCapOpt ?? QUERY_CAP));
  const capped = deduped.slice(0, effectiveQueryCap);
  return {
    capped,
    rawCount: all.length,
    dedupedRemoved: all.length - deduped.length,
    cappedRemoved: Math.max(0, deduped.length - capped.length),
  };
}

function makeCurrentsFetcher(supabaseUrl: string, serviceKey: string) {
  return async function fetchCurrents(query: string) {
    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/fetch-currents-query`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}`, apiKey: serviceKey },
        body: JSON.stringify({ query, pageSize: PAGE_SIZE, startDate: startDateIso(), endDate: new Date().toISOString(), cursor: null }),
      });
      if (!res.ok) return { ok: false as const, type: "http_error", articles: [] as CurrentsArticle[] };
      const data = await res.json().catch(() => ({}));
      if (!data?.ok) return { ok: false as const, type: data?.type || "currents_failure", articles: [] as CurrentsArticle[] };
      return { ok: true as const, type: "success", articles: Array.isArray(data.articles) ? (data.articles as CurrentsArticle[]) : [] };
    } catch {
      return { ok: false as const, type: "edge_invoke_error", articles: [] as CurrentsArticle[] };
    }
  };
}

// Processes ONE tracking query, MUTATING the provided counters. Cross-invocation
// dedupe is handled by the raw_events existing-URL check, so this is idempotent
// when a chunk is retried.
async function processOneQuery(
  db: any,
  companyId: string,
  query: TrackingQuery,
  fetchCurrents: (q: string) => Promise<{ ok: boolean; type: string; articles: CurrentsArticle[] }>,
  seenInRun: Set<string>,
  counters: FreshIntelligenceCounters,
  opts: { maxArticlesPerQuery?: number; dryRun?: boolean },
): Promise<void> {
  counters.queries_executed += 1;
  const result = await fetchCurrents(query.query_text);
  if (!result.ok) {
    counters.failed_calls += 1;
    if (result.type === "rate_limit") { counters.rate_limited += 1; await sleep(RATE_LIMIT_COOLDOWN_MS); }
    else { await sleep(QUERY_COOLDOWN_MS); }
    return;
  }

  const consideredArticles = opts.maxArticlesPerQuery && opts.maxArticlesPerQuery > 0
    ? result.articles.slice(0, opts.maxArticlesPerQuery)
    : result.articles;
  counters.articles_fetched += consideredArticles.length;

  // Bucket every fetched article so the run reconciles (BUG 1).
  const normalized: NormalizedArticle[] = [];
  for (const a of consideredArticles) {
    const c = classifyArticle(companyId, a, query);
    if (c.bucket === "ok" && c.row) { normalized.push(c.row); }
    else if (c.bucket === "relevance") counters.articles_rejected += 1;
    else counters.articles_failed_normalization += 1; // bad_data | stale
  }
  counters.articles_normalized += normalized.length;

  const freshRows: NormalizedArticle[] = [];
  for (const row of normalized) {
    const key = row.source_url || `${row.title}-${row.published_at}`;
    if (seenInRun.has(key)) { counters.article_duplicates += 1; continue; }
    seenInRun.add(key);
    freshRows.push(row);
  }

  const urls = [...new Set(freshRows.map((r) => r.source_url))].slice(0, 500);
  let existing = new Set<string>();
  if (urls.length > 0) {
    const { data: ex } = await db.from("raw_events").select("source_url").eq("company_id", companyId).in("source_url", urls);
    existing = new Set((ex || []).map((r: any) => r.source_url).filter(Boolean));
  }
  const newRows = freshRows.filter((r) => {
    if (existing.has(r.source_url)) { counters.article_duplicates += 1; return false; }
    return true;
  });

  if (newRows.length > 0 && !opts.dryRun) {
    // Insert; on schema/column error fall back to a minimal known-good column
    // set (mirrors the old client path) so an extra column never silently drops
    // a whole batch. Anything still failing is counted, never lost.
    const { error: insErr } = await db.from("raw_events").insert(newRows);
    if (!insErr) {
      counters.articles_inserted += newRows.length;
    } else {
      const minimal = newRows.map((r) => ({
        company_id: r.company_id, title: r.title, description: r.description,
        source_url: r.source_url, source_name: r.source_name, query_text: r.query_text,
        published_at: r.published_at, source_quality: r.source_quality,
        event_age_days: r.event_age_days, relevance_seed_score: r.relevance_seed_score,
        freshness_bucket: r.freshness_bucket, source_api: r.source_api, source_tier: r.source_tier,
      }));
      const { error: minErr } = await db.from("raw_events").insert(minimal);
      if (!minErr) counters.articles_inserted += newRows.length;
      else counters.articles_failed_insert += newRows.length;
    }
  } else if (newRows.length > 0 && opts.dryRun) {
    counters.articles_skipped += newRows.length; // dry_run: would-insert, not written
  }

  await db.from("news_tracking_queries").update({ last_run_at: new Date().toISOString() }).eq("id", query.id);
}

// Runs the FULL Currents fetch in one call (used by the synchronous/background
// orchestrator). For the resumable runner use runFreshIntelligenceChunk.
export async function runFreshIntelligenceFetch(db: any, companyId: string, opts: FreshFetchOptions): Promise<FreshIntelligenceCounters> {
  const counters = emptyCounters();
  const { capped, rawCount, dedupedRemoved, cappedRemoved } = await loadCappedQueries(db, companyId, opts.queryCap);
  counters.raw_queries_generated = rawCount;
  counters.deduped_queries = dedupedRemoved;
  counters.capped_queries = cappedRemoved;
  if (capped.length === 0) return counters;

  const fetchCurrents = makeCurrentsFetcher(opts.supabaseUrl, opts.serviceKey);
  const seenInRun = new Set<string>();
  for (const query of capped) {
    if (counters.articles_inserted >= TARGET_FRESH_ARTICLES) break;
    await processOneQuery(db, companyId, query, fetchCurrents, seenInRun, counters, opts);
    if (opts.onProgress) await opts.onProgress({ executed: counters.queries_executed, total: capped.length, counters });
    await sleep(NORMAL_COOLDOWN_MS);
  }
  return counters;
}

// ── Resumable chunk (Option B staged runner) ────────────────────────────────
export type FreshChunkResult = {
  delta: FreshIntelligenceCounters; // counters for THIS chunk only (caller accumulates)
  totalQueries: number;
  rawQueries: number;
  dedupedRemoved: number;
  cappedRemoved: number;
  nextIndex: number;
  done: boolean;
};

// Processes queries [startIndex, startIndex+chunkSize) and returns the delta.
// The caller persists cumulative counters + nextIndex on the run row, then
// re-invokes until done — so no single invocation runs the whole fetch.
export async function runFreshIntelligenceChunk(
  db: any,
  companyId: string,
  opts: FreshFetchOptions & { startIndex: number; chunkSize: number },
): Promise<FreshChunkResult> {
  const delta = emptyCounters();
  const { capped, rawCount, dedupedRemoved, cappedRemoved } = await loadCappedQueries(db, companyId, opts.queryCap);
  const total = capped.length;
  const start = Math.max(0, Math.floor(opts.startIndex || 0));
  const end = Math.min(total, start + Math.max(1, Math.floor(opts.chunkSize || 8)));

  const fetchCurrents = makeCurrentsFetcher(opts.supabaseUrl, opts.serviceKey);
  const seenInRun = new Set<string>(); // within-chunk; cross-chunk dedupe via raw_events
  for (let i = start; i < end; i++) {
    await processOneQuery(db, companyId, capped[i], fetchCurrents, seenInRun, delta, opts);
    if (opts.onProgress) await opts.onProgress({ executed: i - start + 1, total: end - start, counters: delta });
    await sleep(NORMAL_COOLDOWN_MS);
  }

  return { delta, totalQueries: total, rawQueries: rawCount, dedupedRemoved, cappedRemoved, nextIndex: end, done: end >= total };
}
