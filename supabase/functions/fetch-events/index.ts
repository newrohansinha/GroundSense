import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type TrackingQuery = {
  id: string | null;
  company_id: string;
  query_text: string;
  query_type: string | null;
};

type Article = {
  title: string;
  url: string;
  source: string;
  published_at: string | null;
  raw_text: string;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const badTitleTerms = [
  "job",
  "jobs",
  "internship",
  "student",
  "scholarship",
  "coupon",
  "promo",
  "recipe",
  "celebrity",
  "horoscope",
  "obituary",
];

const weakSourceTerms = [
  "ad hoc news",
  "simplywall",
  "gurufocus",
  "chartmill",
  "stock titan",
  "moomoo",
  "finviz",
  "kalkine",
  "sahm",
  "timothysykes",
  "cigar aficionado",
  "market.us",
  "vocal.media",
];

const premiumSourceTerms = [
  "reuters",
  "bloomberg",
  "wall street journal",
  "wsj",
  "financial times",
  "associated press",
  "ap news",
  "sec.gov",
  "business wire",
  "pr newswire",
  "industrial distribution",
  "modern distribution management",
  "manufacturing dive",
  "supply chain dive",
  "freightwaves",
  "engineering news-record",
  "enr",
];

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function normalize(value: string) {
  return value
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function significantTokens(value: string) {
  return normalize(value)
    .split(" ")
    .filter((token) => token.length >= 4);
}

function getAgeDays(publishedAt: string | null) {
  if (!publishedAt) return 9999;

  const date = new Date(publishedAt);
  if (Number.isNaN(date.getTime())) return 9999;

  const diff = Date.now() - date.getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

function freshnessBucket(ageDays: number) {
  if (ageDays <= 30) return "fresh";
  if (ageDays <= 90) return "recent";
  if (ageDays <= 180) return "aging";
  if (ageDays <= 365) return "background";
  return "stale";
}

function sourceQuality(source: string, url: string) {
  const sourceNorm = normalize(`${source} ${url}`);

  if (premiumSourceTerms.some((term) => sourceNorm.includes(normalize(term)))) {
    return 85;
  }

  if (weakSourceTerms.some((term) => sourceNorm.includes(normalize(term)))) {
    return 25;
  }

  if (sourceNorm.includes("yahoo finance")) return 55;
  if (sourceNorm.includes("pr newswire")) return 65;
  if (sourceNorm.includes("business wire")) return 70;

  return 50;
}

function extractQuotedPhrases(queryText: string) {
  const matches = [...queryText.matchAll(/"([^"]+)"/g)];
  return matches.map((match) => match[1]).filter(Boolean);
}

function exactPhraseAppears(title: string, phrase: string) {
  const titleNorm = normalize(title);
  const phraseNorm = normalize(phrase);
  const tokens = significantTokens(phraseNorm);

  if (!phraseNorm || tokens.length === 0) return true;
  if (titleNorm.includes(phraseNorm)) return true;

  const strongMatches = tokens.filter((token) => titleNorm.includes(token));
  return strongMatches.length >= Math.min(2, tokens.length);
}

function relevanceSeedScore(article: Article, query: TrackingQuery) {
  const text = normalize(`${article.title} ${article.source} ${query.query_text}`);

  let score = 0;

  const strategicTerms = [
    "tariff",
    "tariffs",
    "duties",
    "strike",
    "shutdown",
    "shortage",
    "prices",
    "price",
    "freight",
    "imports",
    "exports",
    "sanctions",
    "acquisition",
    "acquires",
    "merger",
    "earnings",
    "guidance",
    "margin",
    "distribution center",
    "plant",
    "factory",
    "production",
    "contract",
    "bankruptcy",
    "regulation",
    "recall",
    "supply",
    "demand",
    "expansion",
    "cost",
    "steel",
    "aluminum",
    "copper",
    "construction",
    "manufacturing",
    "utilities",
  ];

  for (const term of strategicTerms) {
    if (text.includes(term)) score += 6;
  }

  const quality = sourceQuality(article.source, article.url);
  score += Math.round(quality / 10);

  const ageDays = getAgeDays(article.published_at);
  if (ageDays <= 30) score += 25;
  else if (ageDays <= 90) score += 15;
  else if (ageDays <= 180) score += 5;
  else score -= 20;

  return Math.max(0, Math.min(100, score));
}

function passesQualityFilter(article: Article, query: TrackingQuery) {
  const titleNorm = normalize(article.title);
  const sourceNorm = normalize(article.source);
  const queryType = query.query_type || "";
  const queryText = query.query_text || "";

  const ageDays = getAgeDays(article.published_at);

  if (ageDays > 365) return false;

  for (const badTerm of badTitleTerms) {
    if (titleNorm.includes(` ${badTerm} `) || titleNorm.startsWith(`${badTerm} `)) {
      return false;
    }
  }

  for (const weakSource of weakSourceTerms) {
    if (sourceNorm.includes(normalize(weakSource)) && ageDays > 90) {
      return false;
    }
  }

  const quotedPhrases = extractQuotedPhrases(queryText);

  if (
    queryType.includes("exact") ||
    queryType.includes("competitor") ||
    queryType.includes("supplier") ||
    queryType.includes("customer")
  ) {
    if (quotedPhrases.length > 0) {
      return quotedPhrases.some((phrase) => exactPhraseAppears(article.title, phrase));
    }
  }

  return true;
}

function createEventHash(url: string, title: string) {
  return `${url}-${normalize(title)}`.toLowerCase();
}

function buildGoogleNewsUrl(query: string) {
  const queryWithFreshness = `${query} when:180d`;
  const encodedQuery = encodeURIComponent(queryWithFreshness);

  return (
    "https://news.google.com/rss/search" +
    `?q=${encodedQuery}` +
    "&hl=en-US" +
    "&gl=US" +
    "&ceid=US:en"
  );
}

function extractTagValue(xml: string, tag: string) {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const match = xml.match(regex);
  return match ? decodeXml(match[1].trim()) : "";
}

function decodeXml(value: string) {
  return value
    .replace(/<!\[CDATA\[/g, "")
    .replace(/\]\]>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function parseGoogleNewsRss(xml: string): Article[] {
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  const articles: Article[] = [];

  let match;

  while ((match = itemRegex.exec(xml)) !== null) {
    const item = match[1];

    const title = extractTagValue(item, "title");
    const link = extractTagValue(item, "link");
    const pubDate = extractTagValue(item, "pubDate");
    const source = extractTagValue(item, "source") || "Google News";

    if (!title || !link) continue;

    const parsedDate = pubDate ? new Date(pubDate) : null;

    const publishedAt =
      parsedDate && !Number.isNaN(parsedDate.getTime())
        ? parsedDate.toISOString()
        : null;

    articles.push({
      title,
      url: link,
      source,
      published_at: publishedAt,
      raw_text: item,
    });
  }

  return articles;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { companyId, maxQueries = 200, maxArticlesPerQuery = 25 } =
      await req.json();

    if (!companyId) {
      return jsonResponse({ error: "Missing companyId" }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse({ error: "Missing Supabase env vars" }, 500);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { data: queries, error: queryError } = await supabase
      .from("tracking_queries")
      .select("*")
      .eq("company_id", companyId)
      .limit(maxQueries);

    if (queryError) {
      return jsonResponse({ error: queryError.message }, 500);
    }

    let inserted = 0;
    let skipped = 0;
    let rejected = 0;
    let checked = 0;

    const seenTitles = new Set<string>();

    for (const query of (queries || []) as TrackingQuery[]) {
      if (!query.query_text) {
        skipped++;
        continue;
      }

      let response;

      try {
        response = await fetch(buildGoogleNewsUrl(query.query_text));
      } catch {
        skipped++;
        continue;
      }

      if (!response.ok) {
        skipped++;
        continue;
      }

      const xml = await response.text();
      const articles = parseGoogleNewsRss(xml).slice(0, maxArticlesPerQuery);

      for (const article of articles) {
        checked++;

        if (!passesQualityFilter(article, query)) {
          rejected++;
          continue;
        }

        const titleHash = normalize(article.title);

        if (seenTitles.has(titleHash)) {
          skipped++;
          continue;
        }

        seenTitles.add(titleHash);

        const eventHash = createEventHash(article.url, article.title);
        const ageDays = getAgeDays(article.published_at);
        const quality = sourceQuality(article.source, article.url);
        const seedScore = relevanceSeedScore(article, query);

        const { data: existingByHash } = await supabase
          .from("raw_events")
          .select("id")
          .eq("event_hash", eventHash)
          .maybeSingle();

        if (existingByHash) {
          skipped++;
          continue;
        }

        const { error: insertError } = await supabase.from("raw_events").insert({
          company_id: companyId,
          tracking_query_id: query.id,
          query_text: query.query_text,
          title: article.title,
          summary: article.title,
          source_url: article.url,
          source_name: article.source,
          category: "google_news",
          published_at: article.published_at,
          raw_text: article.raw_text,
          event_hash: eventHash,
          source_quality: quality,
          event_age_days: ageDays,
          freshness_bucket: freshnessBucket(ageDays),
          relevance_seed_score: seedScore,
        });

        if (insertError) {
          skipped++;
          continue;
        }

        inserted++;
      }
    }

    return jsonResponse({
      source: "google_news_rss",
      queries_checked: queries?.length || 0,
      articles_checked: checked,
      inserted,
      skipped,
      rejected,
    });
  } catch (error) {
    return jsonResponse({ error: String(error) }, 500);
  }
});