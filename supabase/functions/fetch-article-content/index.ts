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

function cleanText(value: string) {
  return String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<header[\s\S]*?<\/header>/gi, " ")
    .replace(/<aside[\s\S]*?<\/aside>/gi, " ")
    .replace(/<form[\s\S]*?<\/form>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&rsquo;/gi, "'")
    .replace(/&lsquo;/gi, "'")
    .replace(/&rdquo;/gi, '"')
    .replace(/&ldquo;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function metaContent(html: string, key: string) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const patterns = [
    new RegExp(
      `<meta[^>]+(?:name|property)=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`,
      "i"
    ),
    new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']${escaped}["'][^>]*>`,
      "i"
    ),
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return cleanText(match[1]);
  }

  return "";
}

function extractArticleText(html: string) {
  const metaDescription =
    metaContent(html, "og:description") ||
    metaContent(html, "twitter:description") ||
    metaContent(html, "description");

  const articleMatch = html.match(/<article[\s\S]*?<\/article>/i);
  const mainMatch = html.match(/<main[\s\S]*?<\/main>/i);

  const articleText = articleMatch ? cleanText(articleMatch[0]) : "";
  const mainText = mainMatch ? cleanText(mainMatch[0]) : "";
  const bodyText = cleanText(html);

  const bestBody = [articleText, mainText, bodyText]
    .filter((text) => text.length > 250)
    .sort((a, b) => b.length - a.length)[0];

  return [metaDescription, bestBody]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .slice(0, 20000)
    .trim();
}

async function fetchWithTimeout(url: string, timeoutMs = 8000) {
  const controller = new AbortController();

  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; GroundSenseBot/1.0; source verification)",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });

    return response;
  } finally {
    clearTimeout(timeout);
  }
}

serve(async (req) => {
  // CRITICAL: preflight must return immediately.
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse(
        {
          ok: false,
          message: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.",
        },
        500
      );
    }

    const body = await req.json().catch(() => ({}));
    const companyId = String(body.companyId || "");

    // Keep this small. Edge Functions are not good for 50 article scrapes at once.
    const limit = Math.min(Math.max(Number(body.limit || 8), 1), 10);

    if (!companyId) {
      return jsonResponse(
        {
          ok: false,
          message: "Missing companyId.",
        },
        400
      );
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { data: events, error } = await supabase
      .from("raw_events")
      .select("id, title, source_url, description, source_quality")
      .eq("company_id", companyId)
      .is("content_text", null)
      .not("source_url", "is", null)
      .order("source_quality", { ascending: false, nullsFirst: false })
      .limit(limit);

    if (error) throw error;

    let updated = 0;
    let failed = 0;

    const failures: any[] = [];

    for (const event of events || []) {
      const url = String(event.source_url || "");

      try {
        const response = await fetchWithTimeout(url, 8000);

        if (!response.ok) {
          failed += 1;

          failures.push({
            title: event.title,
            status: response.status,
            statusText: response.statusText,
          });

          await supabase
            .from("raw_events")
            .update({
              content_fetch_status: `http_${response.status}`,
              content_fetch_error: response.statusText,
              content_fetched_at: new Date().toISOString(),
            })
            .eq("id", event.id);

          continue;
        }

        const html = await response.text();
        const contentText = extractArticleText(html);

        if (!contentText || contentText.length < 160) {
          failed += 1;

          failures.push({
            title: event.title,
            status: "empty_or_too_short",
          });

          await supabase
            .from("raw_events")
            .update({
              content_fetch_status: "empty_or_too_short",
              content_fetch_error: "No meaningful article text extracted.",
              content_fetched_at: new Date().toISOString(),
            })
            .eq("id", event.id);

          continue;
        }

        await supabase
          .from("raw_events")
          .update({
            content_text: contentText,
            content_fetch_status: "ok",
            content_fetch_error: null,
            content_fetched_at: new Date().toISOString(),
          })
          .eq("id", event.id);

        updated += 1;
      } catch (err) {
        failed += 1;

        failures.push({
          title: event.title,
          error: err instanceof Error ? err.message : String(err),
        });

        await supabase
          .from("raw_events")
          .update({
            content_fetch_status: "fetch_error",
            content_fetch_error:
              err instanceof Error ? err.message : String(err),
            content_fetched_at: new Date().toISOString(),
          })
          .eq("id", event.id);
      }
    }

    return jsonResponse({
      ok: true,
      checked: events?.length || 0,
      updated,
      failed,
      failures: failures.slice(0, 5),
    });
  } catch (err) {
    return jsonResponse(
      {
        ok: false,
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : null,
      },
      500
    );
  }
});