// public-source-proxy — minimal, allowlisted server-side proxy for FREE/public sources.
// Solves the browser CORS / User-Agent limitations for BLS, SEC EDGAR, GDELT, World Bank.
//
// SECURITY (hard rules):
//   - Only the four known source IDs are allowed. No arbitrary URLs from the client.
//   - The proxy builds every upstream URL itself from validated structured params.
//   - No secrets are returned. SEC User-Agent is read server-side; only userAgentDetected
//     (a boolean) is reported back — never the email itself.
//   - No paid feeds. No service-role key usage. Read-only public data only.
//
// Local run:   supabase functions serve public-source-proxy --env-file supabase/.env.local
// Deploy:      supabase functions deploy public-source-proxy
// Env needed:  SEC_EDGAR_USER_AGENT="GroundSense your-email@example.com"  (optional; for SEC)

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

// ── Validation patterns ───────────────────────────────────────────────────────
const SERIES_RE = /^[A-Za-z0-9_\-]{1,40}$/;
const YEAR_RE = /^\d{4}$/;
const TICKER_RE = /^[A-Z]{1,6}$/;
const CIK_RE = /^\d{1,10}$/;
const COUNTRY_RE = /^[A-Za-z]{2,3}$/;
const INDICATOR_RE = /^[A-Za-z0-9.]{1,30}$/;

// Known ticker → CIK (non-secret). Expand as needed.
const CIK_MAP: Record<string, string> = { FAST: "0000815556" };

function padCik(cik: string): string {
  return cik.replace(/\D/g, "").padStart(10, "0");
}

// fetch with timeout; returns { ok, status, data, error }.
async function safeFetch(url: string, init: RequestInit | undefined, timeoutMs = 9000): Promise<{ ok: boolean; httpStatus: number; data: unknown; error: string | null }> {
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, { ...init, signal: controller.signal });
    clearTimeout(t);
    const text = await res.text();
    let data: unknown = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    return { ok: res.ok, httpStatus: res.status, data, error: res.ok ? null : `Upstream HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, httpStatus: 0, data: null, error: e instanceof Error ? e.message : "fetch failed" };
  }
}

// ── Source handlers ───────────────────────────────────────────────────────────

async function handleBls(operation: string, params: Record<string, unknown>) {
  if (operation !== "series") return json({ ok: false, status: "error", reason: "Unsupported BLS operation." }, 400);
  const ids = Array.isArray(params.seriesIds) ? params.seriesIds : params.seriesId ? [params.seriesId] : [];
  const seriesIds = ids.map((s) => String(s)).filter((s) => SERIES_RE.test(s)).slice(0, 25);
  if (seriesIds.length === 0) return json({ ok: false, status: "error", reason: "No valid seriesId(s)." }, 400);
  const startyear = YEAR_RE.test(String(params.startYear)) ? String(params.startYear) : undefined;
  const endyear = YEAR_RE.test(String(params.endYear)) ? String(params.endYear) : undefined;
  const r = await safeFetch("https://api.bls.gov/publicAPI/v1/timeseries/data/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ seriesid: seriesIds, ...(startyear ? { startyear } : {}), ...(endyear ? { endyear } : {}) }),
  });
  if (!r.ok) return json({ ok: false, status: "error", reason: r.error ?? "BLS fetch failed.", data: null });
  return json({ ok: true, status: "live", data: r.data });
}

async function handleSec(operation: string, params: Record<string, unknown>) {
  // Prefer server env; allow a client-provided User-Agent fallback (UA is not a secret).
  const envUa = Deno.env.get("SEC_EDGAR_USER_AGENT") ?? Deno.env.get("VITE_SEC_EDGAR_USER_AGENT");
  const clientUa = typeof params.userAgent === "string" ? params.userAgent : null;
  const ua = (envUa && envUa.trim()) || (clientUa && clientUa.trim()) || null;
  if (!ua) {
    return json({ ok: false, status: "needs_user_agent", userAgentDetected: false, reason: 'Set SEC_EDGAR_USER_AGENT="GroundSense your-email@example.com" on the proxy.' });
  }
  const headers = { "User-Agent": ua, Accept: "application/json" };

  if (operation === "ticker_lookup") {
    const r = await safeFetch("https://www.sec.gov/files/company_tickers.json", { headers });
    return r.ok ? json({ ok: true, status: "live", userAgentDetected: true, data: r.data }) : json({ ok: false, status: "error", userAgentDetected: true, reason: r.error });
  }

  // Resolve CIK for companyfacts / submissions.
  let cik: string | null = null;
  if (params.cik && CIK_RE.test(String(params.cik))) cik = padCik(String(params.cik));
  else if (params.ticker && TICKER_RE.test(String(params.ticker))) cik = CIK_MAP[String(params.ticker)] ?? null;
  if (!cik) return json({ ok: false, status: "error", userAgentDetected: true, reason: "Provide a valid ticker (known) or numeric cik." }, 400);

  if (operation === "companyfacts") {
    const r = await safeFetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, { headers });
    return r.ok ? json({ ok: true, status: "live", userAgentDetected: true, data: r.data }) : json({ ok: false, status: "error", userAgentDetected: true, reason: r.error });
  }
  if (operation === "submissions") {
    const r = await safeFetch(`https://data.sec.gov/submissions/CIK${cik}.json`, { headers });
    return r.ok ? json({ ok: true, status: "live", userAgentDetected: true, data: r.data }) : json({ ok: false, status: "error", userAgentDetected: true, reason: r.error });
  }
  return json({ ok: false, status: "error", userAgentDetected: true, reason: "Unsupported SEC operation." }, 400);
}

async function handleGdelt(operation: string, params: Record<string, unknown>) {
  if (operation !== "doc_search") return json({ ok: false, status: "error", reason: "Unsupported GDELT operation." }, 400);
  const query = String(params.query ?? "").slice(0, 200);
  if (!query.trim()) return json({ ok: false, status: "error", reason: "Empty GDELT query." }, 400);
  const mode = ["artlist", "timelinevol", "tonechart"].includes(String(params.mode)) ? String(params.mode) : "artlist";
  const maxRecords = Math.min(50, Math.max(1, Number(params.maxRecords) || 5));
  const timespan = /^[0-9]{1,3}(d|h|w|m)$/.test(String(params.timespan)) ? String(params.timespan) : "30d";
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(query)}&mode=${mode}&maxrecords=${maxRecords}&timespan=${timespan}&format=json`;
  const r = await safeFetch(url);
  const docs = (r.data && typeof r.data === "object" && Array.isArray((r.data as { articles?: unknown[] }).articles))
    ? (r.data as { articles: unknown[] }).articles.length : 0;
  // GDELT is context only — never numeric metrics.
  return json({ ok: r.ok, status: "context_only", docsFound: docs, data: r.ok ? r.data : null, reason: r.ok ? null : (r.error ?? "GDELT fetch failed") });
}

async function handleWorldBank(operation: string, params: Record<string, unknown>) {
  if (operation !== "indicator") return json({ ok: false, status: "error", reason: "Unsupported World Bank operation." }, 400);
  const country = String(params.countryCode ?? "US");
  const indicator = String(params.indicatorCode ?? "");
  if (!COUNTRY_RE.test(country) || !INDICATOR_RE.test(indicator)) return json({ ok: false, status: "error", reason: "Invalid country or indicator." }, 400);
  const r = await safeFetch(`https://api.worldbank.org/v2/country/${country}/indicator/${indicator}?format=json&per_page=10`);
  return r.ok ? json({ ok: true, status: "live", data: r.data }) : json({ ok: false, status: "error", reason: r.error });
}

// ── Entry ─────────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, status: "error", reason: "Method not allowed." }, 405);

  let body: { source?: string; operation?: string; params?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, status: "error", reason: "Invalid JSON body." }, 400);
  }

  const source = String(body.source ?? "");
  const operation = String(body.operation ?? "");
  const params = (body.params ?? {}) as Record<string, unknown>;

  try {
    switch (source) {
      case "bls": return await handleBls(operation, params);
      case "sec": return await handleSec(operation, params);
      case "gdelt": return await handleGdelt(operation, params);
      case "world_bank": return await handleWorldBank(operation, params);
      default: return json({ ok: false, status: "error", reason: `Unknown source "${source}". Allowed: bls, sec, gdelt, world_bank.` }, 400);
    }
  } catch (e) {
    return json({ ok: false, status: "error", reason: e instanceof Error ? e.message : "Proxy error." }, 500);
  }
});
