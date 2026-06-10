import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

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

function clean(value: unknown) {
  return String(value || "").trim();
}

function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  const n = Number(value);

  if (!Number.isFinite(n)) return fallback;

  return Math.max(min, Math.min(max, n));
}

function isoDateDaysAgo(daysAgo: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - daysAgo);
  return date.toISOString();
}

async function fetchWithTimeout(url: string, timeoutMs: number) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": "GroundSense/1.0",
      },
    });
  } finally {
    clearTimeout(id);
  }
}

function buildSearchUrl(input: {
  apiKey: string;
  query: string;
  pageSize: number;
  cursor?: string | null;
  startDate?: string | null;
  endDate?: string | null;
}) {
  const params = new URLSearchParams({
    query: input.query,
    language: "en",
    type: "1",
    page_size: String(input.pageSize),
    apiKey: input.apiKey,
  });

  if (input.startDate) params.set("start_date", input.startDate);
  if (input.endDate) params.set("end_date", input.endDate);
  if (input.cursor) params.set("cursor", input.cursor);

  return `https://api.currentsapi.services/v2/search?${params.toString()}`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const apiKey = Deno.env.get("CURRENTS_API_KEY");

    if (!apiKey) {
      return jsonResponse({
        ok: false,
        type: "missing_secret",
        message: "Missing CURRENTS_API_KEY secret",
        articles: [],
      });
    }

    const body = await req.json();

    const query = clean(body.query);
    const pageSize = clampNumber(body.pageSize, 1, 50, 50);
    const cursor = clean(body.cursor) || null;
    const startDate = clean(body.startDate) || isoDateDaysAgo(7);
    const endDate = clean(body.endDate) || new Date().toISOString();

    if (!query) {
      return jsonResponse({
        ok: false,
        type: "bad_request",
        message: "Missing query",
        articles: [],
      });
    }

    const url = buildSearchUrl({
      apiKey,
      query,
      pageSize,
      cursor,
      startDate,
      endDate,
    });

    const response = await fetchWithTimeout(url, 25000);

    if (response.status === 401 || response.status === 403) {
      return jsonResponse({
        ok: false,
        type: "auth_error",
        status: response.status,
        message: "Currents API rejected the key. Check CURRENTS_API_KEY.",
        articles: [],
      });
    }

    if (response.status === 429) {
      return jsonResponse({
        ok: false,
        type: "rate_limit",
        status: response.status,
        message: "Currents API rate limit reached.",
        articles: [],
      });
    }

    if (!response.ok) {
      const text = await response.text();

      return jsonResponse({
        ok: false,
        type: "http_error",
        status: response.status,
        message: text.slice(0, 800),
        articles: [],
      });
    }

    const data = await response.json();
    const articles = Array.isArray(data?.news) ? data.news : [];

    return jsonResponse({
      ok: true,
      type: "success",
      source_used: "currents_api",
      query,
      count: articles.length,
      next_cursor: data?.next_cursor || null,
      page: data?.page || null,
      articles,
    });
  } catch (error) {
    return jsonResponse({
      ok: false,
      type: "edge_error",
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : null,
      articles: [],
    });
  }
});