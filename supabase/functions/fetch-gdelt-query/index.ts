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

function buildGdeltUrl(query: string, maxRecords: number, sort: string, days: number) {
  const finalQuery = `${query} sourcelang:english`;

  const params = new URLSearchParams({
    query: finalQuery,
    mode: "artlist",
    format: "json",
    maxrecords: String(maxRecords),
    sort,
    timespan: `${days}d`,
  });

  return `https://api.gdeltproject.org/api/v2/doc/doc?${params.toString()}`;
}

async function fetchWithTimeout(url: string, timeoutMs: number) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "GroundSense/1.0 research prototype",
        Accept: "application/json",
      },
    });
  } finally {
    clearTimeout(id);
  }
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

    const query = clean(body.query);
    const maxRecords = Math.min(Number(body.maxRecords || 25), 50);
    const days = Math.min(Number(body.days || 7), 14);

    if (!query) {
      return jsonResponse(
        {
          ok: false,
          type: "bad_request",
          articles: [],
          message: "Missing query",
        },
        400
      );
    }

    const attempts = [
      {
        sort: "datedesc",
        maxRecords,
        timeoutMs: 25000,
      },
      {
        sort: "hybridrel",
        maxRecords: Math.max(10, Math.floor(maxRecords / 2)),
        timeoutMs: 25000,
      },
    ];

    for (const attempt of attempts) {
      const url = buildGdeltUrl(query, attempt.maxRecords, attempt.sort, days);

      try {
        const response = await fetchWithTimeout(url, attempt.timeoutMs);

        if (response.status === 429) {
          return jsonResponse({
            ok: false,
            type: "rate_limit",
            articles: [],
            message: "GDELT returned 429 rate limit.",
            status: response.status,
          });
        }

        if (!response.ok) {
          return jsonResponse({
            ok: false,
            type: "http_error",
            articles: [],
            message: `GDELT returned HTTP ${response.status}`,
            status: response.status,
          });
        }

        const data = await response.json();
        const articles = Array.isArray(data?.articles) ? data.articles : [];

        return jsonResponse({
          ok: true,
          type: "success",
          articles,
          query,
          sort: attempt.sort,
          count: articles.length,
        });
      } catch (error) {
        const isAbort = error instanceof DOMException && error.name === "AbortError";

        if (isAbort) {
          continue;
        }

        return jsonResponse({
          ok: false,
          type: "network_error",
          articles: [],
          message: String(error),
        });
      }
    }

    return jsonResponse({
      ok: false,
      type: "timeout",
      articles: [],
      message: "GDELT timed out after retries.",
    });
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        type: "edge_error",
        articles: [],
        message: String(error),
      },
      500
    );
  }
});