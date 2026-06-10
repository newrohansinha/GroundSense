import { supabase } from "../lib/supabase";
import {
  scoreNewsSource,
  getArticleNoiseReason,
  normalizeNewsText,
} from "./newsQuality";

type RawEvent = {
  id: string;
  company_id: string;
  title: string | null;
  description?: string | null;
  source_url: string | null;
  source_name: string | null;
  published_at: string | null;
  source_quality?: number | null;
  source_tier?: string | null;
  relevance_seed_score?: number | null;
  event_age_days?: number | null;
  matched_terms?: string[] | null;
  signal_terms?: string[] | null;
  quality_reason?: string | null;
  source_api?: string | null;
  query_text?: string | null;
};

type CleanEvent = RawEvent & {
  corrected_source_quality: number;
  corrected_source_tier: string;
  source_quality_reason: string;
  fallback_relevance_score: number;
  final_relevance_score: number;
  scorer_rank_score: number;
};

const MAX_EVENTS_TO_LOAD = 5000;
const SCORE_BATCH_SIZE = 100;

const MIN_FINAL_RELEVANCE_SCORE = 35;
const MIN_SOURCE_QUALITY = 45;

const HARD_REJECT_TITLE_TERMS = [
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

const HIGH_SIGNAL_TERMS = [
  "fastenal",
  "grainger",
  "msc industrial",
  "applied industrial",
  "steel",
  "tariff",
  "duties",
  "imports",
  "fasteners",
  "manufacturing",
  "industrial",
  "construction",
  "freight",
  "logistics",
  "supply chain",
  "supplier",
  "shortage",
  "disruption",
  "port",
  "rail",
  "truckload",
  "inventory",
  "fulfillment",
  "backlog",
  "pmi",
  "ism",
  "factory orders",
  "industrial production",
  "earnings",
  "guidance",
  "margin",
  "pricing",
  "sales",
  "distribution center",
  "branch",
  "acquisition",
];

const LOW_VALUE_SOURCE_NAMES = [
  "marketbeat",
  "simplywall",
  "simply wall st",
  "moomoo",
  "ad hoc news",
  "indexbox",
  "kalkine",
];

function numberValue(value: unknown, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function hasAnyText(text: string, terms: string[]) {
  const normalized = normalizeNewsText(text);
  return terms.some((term) => normalized.includes(normalizeNewsText(term)));
}

function countMatches(text: string, terms: string[]) {
  const normalized = normalizeNewsText(text);

  return terms.filter((term) => normalized.includes(normalizeNewsText(term))).length;
}

function inferFallbackRelevance(event: RawEvent) {
  const text = `${event.title || ""} ${event.description || ""} ${event.query_text || ""}`;
  const normalized = normalizeNewsText(text);

  let score = 0;

  const highSignalMatches = countMatches(normalized, HIGH_SIGNAL_TERMS);

  score += Math.min(55, highSignalMatches * 8);

  if (normalized.includes("fastenal")) score += 25;
  if (normalized.includes("grainger")) score += 18;
  if (normalized.includes("msc industrial")) score += 18;
  if (normalized.includes("applied industrial")) score += 18;

  if (normalized.includes("steel") && normalized.includes("tariff")) score += 25;
  if (normalized.includes("steel") && normalized.includes("import")) score += 20;
  if (normalized.includes("fastener") && normalized.includes("tariff")) score += 22;
  if (normalized.includes("manufacturing") && normalized.includes("pmi")) score += 22;
  if (normalized.includes("construction") && normalized.includes("spending")) score += 18;
  if (normalized.includes("freight") && normalized.includes("rates")) score += 18;
  if (normalized.includes("supply chain") && normalized.includes("disruption")) score += 18;

  const matchedTerms = Array.isArray(event.matched_terms) ? event.matched_terms.length : 0;
  const signalTerms = Array.isArray(event.signal_terms) ? event.signal_terms.length : 0;

  score += matchedTerms * 8;
  score += signalTerms * 10;

  return Math.min(100, score);
}

function shouldHardReject(event: RawEvent, sourceReason: string) {
  const text = `${event.title || ""} ${event.description || ""} ${event.source_name || ""}`;

  if (hasAnyText(text, HARD_REJECT_TITLE_TERMS)) {
    return "Rejected investment ownership / valuation noise";
  }

  if (hasAnyText(event.source_name || "", LOW_VALUE_SOURCE_NAMES)) {
    return `Rejected low-value source name: ${event.source_name}`;
  }

  if (sourceReason.toLowerCase().includes("blocked")) {
    return sourceReason;
  }

  return null;
}

function scoreCleanEvent(event: RawEvent): CleanEvent | null {
  const title = event.title || "";
  const description = event.description || "";

  if (!title.trim()) return null;

  const source = scoreNewsSource({
    url: event.source_url,
    sourceName: event.source_name,
  });

  const hardRejectReason = shouldHardReject(event, source.reason);

  if (hardRejectReason) return null;

  const noiseReason = getArticleNoiseReason({
    title,
    description,
    source,
  });

  if (noiseReason) return null;

  const originalSourceQuality = numberValue(event.source_quality, 0);
  const correctedSourceQuality = Math.max(originalSourceQuality, source.score);

  if (correctedSourceQuality < MIN_SOURCE_QUALITY) return null;

  const originalRelevance = numberValue(event.relevance_seed_score, 0);
  const fallbackRelevance = inferFallbackRelevance(event);
  const finalRelevance = Math.max(originalRelevance, fallbackRelevance);

  if (finalRelevance < MIN_FINAL_RELEVANCE_SCORE) return null;

  const ageDays = numberValue(event.event_age_days, 7);

  const matchedTermBoost = Array.isArray(event.matched_terms)
    ? event.matched_terms.length * 4
    : 0;

  const signalTermBoost = Array.isArray(event.signal_terms)
    ? event.signal_terms.length * 5
    : 0;

  const freshnessPenalty = Math.min(20, ageDays * 1.5);

  const scorerRankScore =
    finalRelevance * 0.55 +
    correctedSourceQuality * 0.35 +
    matchedTermBoost +
    signalTermBoost -
    freshnessPenalty;

  return {
    ...event,
    source_quality: correctedSourceQuality,
    source_tier: source.tier,
    corrected_source_quality: correctedSourceQuality,
    corrected_source_tier: source.tier,
    source_quality_reason: source.reason,
    fallback_relevance_score: fallbackRelevance,
    final_relevance_score: finalRelevance,
    scorer_rank_score: scorerRankScore,
  };
}

async function loadRawEvents(companyId: string) {
  const { data, error } = await supabase
    .from("raw_events")
    .select("*")
    .eq("company_id", companyId)
    .order("published_at", { ascending: false, nullsFirst: false })
    .limit(MAX_EVENTS_TO_LOAD);

  if (error) throw error;

  return (data || []) as RawEvent[];
}

async function markRejectedEvents(rejectedEvents: RawEvent[]) {
  if (rejectedEvents.length === 0) return;

  const ids = rejectedEvents.map((event) => event.id).filter(Boolean);

  if (ids.length === 0) return;

  await supabase
    .from("raw_events")
    .update({
      rejected_reason: "Rejected by scorer source-quality/relevance gate",
    })
    .in("id", ids);
}

async function updateCorrectedQuality(cleanEvents: CleanEvent[]) {
  if (cleanEvents.length === 0) return;

  for (const event of cleanEvents) {
    await supabase
      .from("raw_events")
      .update({
        source_quality: event.corrected_source_quality,
        source_tier: event.corrected_source_tier,
        relevance_seed_score: event.final_relevance_score,
        quality_reason: event.quality_reason
          ? `${event.quality_reason} | Scorer source check: ${event.source_quality_reason} | Final relevance: ${event.final_relevance_score}`
          : `Scorer source check: ${event.source_quality_reason} | Final relevance: ${event.final_relevance_score}`,
      })
      .eq("id", event.id);
  }
}
function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];

  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }

  return chunks;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function scoreEventsForCompany(companyId: string) {
  const rawEvents = await loadRawEvents(companyId);

  const cleanEvents: CleanEvent[] = [];
  const rejectedEvents: RawEvent[] = [];

  const rejectionSamples: Array<{
    title: string | null;
    source: string | null;
    source_quality?: number | null;
    relevance?: number | null;
    fallback_relevance: number;
  }> = [];

  for (const event of rawEvents) {
    const fallback = inferFallbackRelevance(event);
    const clean = scoreCleanEvent(event);

    if (clean) {
      cleanEvents.push(clean);
    } else {
      rejectedEvents.push(event);

      if (rejectionSamples.length < 15) {
        rejectionSamples.push({
          title: event.title,
          source: event.source_name,
          source_quality: event.source_quality,
          relevance: event.relevance_seed_score,
          fallback_relevance: fallback,
        });
      }
    }
  }

  const candidateEvents = cleanEvents.sort(
    (a, b) => b.scorer_rank_score - a.scorer_rank_score
  );

  console.log("Score events source-quality filter", {
    raw_events_loaded: rawEvents.length,
    after_source_quality_filter: cleanEvents.length,
    rejected: rejectedEvents.length,
    sent_to_scorer: candidateEvents.length,
    rejection_samples: rejectionSamples,
    top_candidates: candidateEvents.slice(0, 10).map((event) => ({
      title: event.title,
      source: event.source_name,
      source_quality: event.corrected_source_quality,
      source_tier: event.corrected_source_tier,
      original_relevance: event.relevance_seed_score,
      fallback_relevance: event.fallback_relevance_score,
      final_relevance: event.final_relevance_score,
      rank_score: Math.round(event.scorer_rank_score),
      reason: event.source_quality_reason,
    })),
  });

  await markRejectedEvents(rejectedEvents);
  await updateCorrectedQuality(candidateEvents);

  if (candidateEvents.length > 0) {
    await supabase
      .from("raw_events")
      .update({
        rejected_reason: null,
      })
      .in(
        "id",
        candidateEvents.map((event) => event.id)
      );
  }

  if (candidateEvents.length === 0) {
    console.log("Score events skipped. No clean candidate events found.");

    return {
      mode: "client_prefilter_batched",
      raw_events_loaded: rawEvents.length,
      clean_events: cleanEvents.length,
      sent_to_scorer: 0,
      scored: 0,
      message: "No clean candidate events found after source-quality filtering.",
    };
  }

  // IMPORTANT: delete old scoring rows once before the batch loop.
  // Do not delete inside each batch or later batches will wipe earlier scores.
  const { error: deleteOldAssessmentsError } = await supabase
    .from("event_assessments")
    .delete()
    .eq("company_id", companyId);

  if (deleteOldAssessmentsError) {
    throw deleteOldAssessmentsError;
  }

  const candidateBatches = chunkArray(candidateEvents, SCORE_BATCH_SIZE);

  const totals = {
    mode: "client_prefilter_batched",
    scorer_version: "client-prefilter-batched-v1",
    batch_size: SCORE_BATCH_SIZE,
    batches_attempted: 0,
    raw_events_loaded: rawEvents.length,
    clean_events: cleanEvents.length,
    rejected_events: rejectedEvents.length,
    requested_candidate_ids: 0,
    scored: 0,
    inserted: 0,
    relevant: 0,
    irrelevant: 0,
    parseErrors: 0,
    geminiErrors: 0,
    insertErrors: 0,
    failedBatches: 0,
    batchResults: [] as any[],
  };

  for (let batchIndex = 0; batchIndex < candidateBatches.length; batchIndex++) {
    const batch = candidateBatches[batchIndex];
    const candidateRawEventIds = batch.map((event) => event.id);

    console.log(`Scoring batch ${batchIndex + 1}/${candidateBatches.length}`, {
      batchSize: candidateRawEventIds.length,
      firstId: candidateRawEventIds[0],
    });

    totals.batches_attempted += 1;
    totals.requested_candidate_ids += candidateRawEventIds.length;

    const { data, error } = await supabase.functions.invoke("score-events", {
      body: {
        companyId,
        mode: "batch",

        // THIS IS THE KEY YOUR EDGE FUNCTION EXPECTS.
        candidateRawEventIds,

        // Compatibility aliases. Safe to include.
        candidate_raw_event_ids: candidateRawEventIds,
        candidateIds: candidateRawEventIds,
        candidate_ids: candidateRawEventIds,
        rawEventIds: candidateRawEventIds,
        raw_event_ids: candidateRawEventIds,

        maxEvents: candidateRawEventIds.length,
        sourceQualityFiltered: true,
        batchIndex: batchIndex + 1,
        batchSize: candidateRawEventIds.length,
      },
    });

    console.log(`Score events batch ${batchIndex + 1} data:`, data);
    console.log(`Score events batch ${batchIndex + 1} error:`, error);

    if (error) {
      totals.failedBatches += 1;
      throw error;
    }

    if (!data) {
      totals.failedBatches += 1;
      throw new Error(`score-events batch ${batchIndex + 1} returned no data`);
    }

    if (
      candidateRawEventIds.length > 0 &&
      Number(data.requested_candidate_ids || 0) === 0
    ) {
      throw new Error(
        `score-events ignored candidateRawEventIds for batch ${
          batchIndex + 1
        }. Sent ${candidateRawEventIds.length}, but Edge Function returned requested_candidate_ids=0.`
      );
    }

    totals.scored += Number(data.scored || 0);
    totals.inserted += Number(data.inserted || 0);
    totals.relevant += Number(data.relevant || 0);
    totals.irrelevant += Number(data.irrelevant || 0);
    totals.parseErrors += Number(data.parseErrors || 0);
    totals.geminiErrors += Number(data.geminiErrors || 0);
    totals.insertErrors += Number(data.insertErrors || 0);

    totals.batchResults.push({
      batch: batchIndex + 1,
      candidateIds: candidateRawEventIds.length,
      requested_candidate_ids: Number(data.requested_candidate_ids || 0),
      raw_events_loaded: Number(data.raw_events_loaded || 0),
      scored: Number(data.scored || 0),
      inserted: Number(data.inserted || 0),
      relevant: Number(data.relevant || 0),
      irrelevant: Number(data.irrelevant || 0),
      parseErrors: Number(data.parseErrors || 0),
      geminiErrors: Number(data.geminiErrors || 0),
      insertErrors: Number(data.insertErrors || 0),
    });

    await sleep(500);
  }

  console.log("Score events complete:", totals);

  return {
    ...totals,
    client_prefilter: {
      raw_events_loaded: rawEvents.length,
      clean_events: cleanEvents.length,
      rejected_events: rejectedEvents.length,
      sent_to_scorer: candidateEvents.length,
      candidate_raw_event_ids: candidateEvents.map((event) => event.id),
    },
  };
}

export async function scoreEvents(companyId: string) {
  return scoreEventsForCompany(companyId);
}