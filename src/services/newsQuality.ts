export type NewsSourceQuality = {
  domain: string;
  sourceName: string;
  score: number;
  tier: "tier_1" | "tier_2" | "tier_3" | "blocked";
  blocked: boolean;
  reason: string;
};

const TIER_1_DOMAINS = new Set([
  "reuters.com",
  "apnews.com",
  "bloomberg.com",
  "wsj.com",
  "ft.com",
  "cnbc.com",
  "nasdaq.com",
  "marketwatch.com",
  "finance.yahoo.com",
  "federalregister.gov",
  "whitehouse.gov",
  "ustr.gov",
  "commerce.gov",
  "census.gov",
  "bls.gov",
  "bea.gov",
  "ismworld.org",
  "steel.org",
]);

const TIER_1_SOURCE_NAMES = [
  "reuters",
  "associated press",
  "ap news",
  "bloomberg",
  "wall street journal",
  "financial times",
  "cnbc",
  "nasdaq",
  "yahoo finance",
  "federal register",
  "u.s. census",
  "bureau of labor statistics",
  "bureau of economic analysis",
  "institute for supply management",
  "american iron and steel institute",
];

const TIER_2_DOMAINS = new Set([
  "supplychaindive.com",
  "constructiondive.com",
  "manufacturingdive.com",
  "industryweek.com",
  "freightwaves.com",
  "spglobal.com",
  "kitco.com",
  "gmk.center",
  "steelnews.biz",
  "eurometal.net",
  "worldsteel.org",
  "metalbulletin.com",
  "mining.com",
  "splash247.com",
  "maritimegateway.com",
  "logisticsmgmt.com",
  "dcvelocity.com",
  "mhnetwork.com",
  "businesswire.com",
  "prnewswire.com",
  "globenewswire.com",
]);

const TIER_2_SOURCE_NAMES = [
  "supply chain dive",
  "construction dive",
  "manufacturing dive",
  "industryweek",
  "freightwaves",
  "s&p global",
  "sp global",
  "kitco",
  "gmk center",
  "eurometal",
  "world steel",
  "business wire",
  "pr newswire",
  "globe newswire",
];

const BLOCKED_DOMAINS = new Set([
  "marketbeat.com",
  "simplywall.st",
  "moomoo.com",
  "ad-hoc-news.de",
  "ad-hoc-news.com",
  "thelegaladvocate.com",
  "kalkinemedia.com",
  "indexbox.io",
  "indexbox.com",
  "dev.to",
  "mirror.co.uk",
  "jalopnik.com",
  "soompi.com",
  "deadline.com",
  "esquire.com",
  "thetakeout.com",
  "wccftech.com",
  "androidheadlines.com",
  "walesonline.co.uk",
  "dailypost.ng",
  "thewrap.com",
  "techradar.com",
]);

const BLOCKED_SOURCE_NAMES = [
  "marketbeat",
  "simply wall st",
  "simplywall",
  "moomoo",
  "ad hoc news",
  "indexbox",
  "kalkine",
  "legal advocate",
];

export const INVESTMENT_NOISE_TERMS = [
  "takes position",
  "new position",
  "grows stake",
  "increases holdings",
  "sells shares",
  "sells stock",
  "purchases shares",
  "bought by",
  "trims stock",
  "stock holdings",
  "price target",
  "analyst says",
  "analyst rating",
  "valuation check",
  "valuation after",
  "shareholder returns",
  "institutional investor",
  "asset management",
  "wealth management",
  "norges bank",
  "fideuram",
  "legal & general",
  "nomura",
  "jefferies",
  "morgan stanley adjusts",
  "wall street bullish",
  "wall street bearish",
  "stock price expected",
  "stock split",
  "insider buying",
  "director acquires",
  "shares acquired",
  "shares of stock",
];

export const GLOBAL_NEWS_NOISE_TERMS = [
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
  "world cup",
  "transfer:",
];

export function normalizeNewsText(value: unknown) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^\w\s.$%-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function domainFromUrl(url: string) {
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
  for (const knownDomain of set) {
    if (domainMatches(domain, knownDomain)) return true;
  }

  return false;
}

function textContainsAny(text: string, terms: string[]) {
  return terms.find((term) => text.includes(normalizeNewsText(term))) || null;
}

export function scoreNewsSource(input: {
  url?: string | null;
  sourceName?: string | null;
}): NewsSourceQuality {
  const domain = domainFromUrl(String(input.url || ""));
  const sourceName = normalizeNewsText(input.sourceName || domain);
  const combined = `${domain} ${sourceName}`;

  if (setContainsDomain(BLOCKED_DOMAINS, domain)) {
    return {
      domain,
      sourceName: sourceName || domain,
      score: 0,
      tier: "blocked",
      blocked: true,
      reason: `Blocked domain: ${domain}`,
    };
  }

  const blockedName = textContainsAny(combined, BLOCKED_SOURCE_NAMES);

  if (blockedName) {
    return {
      domain,
      sourceName: sourceName || domain,
      score: 0,
      tier: "blocked",
      blocked: true,
      reason: `Blocked source name: ${blockedName}`,
    };
  }

  if (setContainsDomain(TIER_1_DOMAINS, domain)) {
    return {
      domain,
      sourceName: sourceName || domain,
      score: 95,
      tier: "tier_1",
      blocked: false,
      reason: `Tier 1 domain: ${domain}`,
    };
  }

  const tier1Name = textContainsAny(combined, TIER_1_SOURCE_NAMES);

  if (tier1Name) {
    return {
      domain,
      sourceName: sourceName || tier1Name,
      score: 95,
      tier: "tier_1",
      blocked: false,
      reason: `Tier 1 source name: ${tier1Name}`,
    };
  }

  if (setContainsDomain(TIER_2_DOMAINS, domain)) {
    return {
      domain,
      sourceName: sourceName || domain,
      score: 82,
      tier: "tier_2",
      blocked: false,
      reason: `Tier 2 domain: ${domain}`,
    };
  }

  const tier2Name = textContainsAny(combined, TIER_2_SOURCE_NAMES);

  if (tier2Name) {
    return {
      domain,
      sourceName: sourceName || tier2Name,
      score: 82,
      tier: "tier_2",
      blocked: false,
      reason: `Tier 2 source name: ${tier2Name}`,
    };
  }

  if (domain.endsWith(".gov")) {
    return {
      domain,
      sourceName: sourceName || domain,
      score: 94,
      tier: "tier_1",
      blocked: false,
      reason: `Government source: ${domain}`,
    };
  }

  if (domain.endsWith(".edu")) {
    return {
      domain,
      sourceName: sourceName || domain,
      score: 78,
      tier: "tier_2",
      blocked: false,
      reason: `Academic source: ${domain}`,
    };
  }

  if (
    domain.includes("business") ||
    domain.includes("finance") ||
    domain.includes("industry") ||
    domain.includes("logistics") ||
    domain.includes("manufacturing")
  ) {
    return {
      domain,
      sourceName: sourceName || domain,
      score: 65,
      tier: "tier_3",
      blocked: false,
      reason: `Business-adjacent source: ${domain}`,
    };
  }

  return {
    domain,
    sourceName: sourceName || domain || "unknown",
    score: 50,
    tier: "tier_3",
    blocked: false,
    reason: `Unclassified source: ${domain || sourceName || "unknown"}`,
  };
}

export function getArticleNoiseReason(input: {
  title?: string | null;
  description?: string | null;
  source?: NewsSourceQuality;
}) {
  const text = normalizeNewsText(`${input.title || ""} ${input.description || ""}`);

  if (input.source?.blocked) {
    return input.source.reason;
  }

  const investmentNoise = textContainsAny(text, INVESTMENT_NOISE_TERMS);

  if (investmentNoise) {
    return `Rejected investment ownership or valuation noise: ${investmentNoise}`;
  }

  const globalNoise = textContainsAny(text, GLOBAL_NEWS_NOISE_TERMS);

  if (globalNoise) {
    return `Rejected general news noise: ${globalNoise}`;
  }

  return null;
}