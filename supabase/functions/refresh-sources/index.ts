// refresh-sources — SERVER-SIDE numeric source connector layer.
//
// Reads source API keys from Edge Function secrets, fetches real series, computes
// the latest numeric change, and writes the canonical numeric_shocks ledger +
// per-source source_health + a raw source_observations audit row per shock (so
// every official number is provably traceable to a real API response).
// Secrets are never returned or logged.

// deno-lint-ignore-file no-explicit-any
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
function admin() {
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
}

async function safeFetch(url: string, init?: RequestInit, timeoutMs = 12000): Promise<{ ok: boolean; status: number; data: any; text: string; error: string | null }> {
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, { ...init, signal: controller.signal });
    clearTimeout(t);
    const text = await res.text();
    let data: any = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    return { ok: res.ok, status: res.status, data, text, error: res.ok ? null : `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, status: 0, data: null, text: "", error: e instanceof Error ? e.message : "fetch failed" };
  }
}

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

// safeFetch + retry on transient throttling/5xx (e.g. UN Comtrade HTTP 429).
async function fetchWithRetry(url: string, init?: RequestInit, opts?: { timeoutMs?: number; retries?: number; backoffMs?: number }) {
  const retries = opts?.retries ?? 2;
  const backoff = opts?.backoffMs ?? 1500;
  let res = await safeFetch(url, init, opts?.timeoutMs);
  for (let attempt = 1; attempt <= retries && (res.status === 429 || res.status === 503 || res.status === 502); attempt++) {
    await sleep(backoff * attempt);
    res = await safeFetch(url, init, opts?.timeoutMs);
  }
  return res;
}

// Census/USITC return an HTML error page (HTTP 200 after redirect) for missing/invalid
// keys, which naive JSON parsing silently reads as "no data". Detect it explicitly so
// source_health surfaces the real cause (key vs query) instead of generic "insufficient data".
function detectHtmlError(text: string): string | null {
  const head = (text || "").slice(0, 400).toLowerCase();
  if (!head.includes("<html")) return null;
  if (head.includes("invalid key")) return "API returned 'Invalid Key' page — check the API key secret (expired/invalid).";
  if (head.includes("missing key") || head.includes("a valid")) return "API returned 'Missing Key' page — API key secret not being sent.";
  return "API returned an HTML error page instead of JSON.";
}

function pct(prev: number, cur: number): number | null {
  if (!Number.isFinite(prev) || !Number.isFinite(cur) || prev === 0) return null;
  return Math.round(((cur - prev) / Math.abs(prev)) * 1000) / 10;
}
function ageDays(periodEnd: string | null): number | null {
  if (!periodEnd) return null;
  const d = new Date(periodEnd);
  if (Number.isNaN(d.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86_400_000));
}
function freshness(periodEnd: string | null, cadence: "weekly" | "monthly"): string {
  const age = ageDays(periodEnd);
  if (age === null) return "context_only";
  if (cadence === "weekly") { if (age <= 14) return "fresh"; if (age <= 30) return "latest_official"; if (age <= 60) return "acceptable_lag"; return "stale"; }
  if (age <= 45) return "fresh"; if (age <= 80) return "latest_official"; if (age <= 130) return "acceptable_lag"; return "stale";
}
function driverCategory(driver: string): string {
  if (/trade_flow|import|export/.test(driver)) return "trade_flow";
  if (/freight|logistic|transport|warehous/.test(driver)) return "freight";
  if (/fuel|diesel|energy|oil|crude/.test(driver)) return "fuel";
  if (/steel|copper|aluminum|metal|commodity/.test(driver)) return "metals";
  if (/tariff|duty/.test(driver)) return "tariff";
  if (/fx|exchange|dollar|import_cost|import_price/.test(driver)) return "fx";
  if (/demand|manufactur|industrial|construction|orders/.test(driver)) return "demand";
  return "context";
}

type ShockInput = {
  source_key: string; source_name: string; source_url?: string | null;
  metric_id: string; metric_name: string; driver: string;
  commodity?: string | null; geography?: string | null;
  current_value: number; previous_value: number;
  period_end: string | null; period_start?: string | null; source_period?: string | null;
  cadence: "weekly" | "monthly"; change_type?: string; unit_raw?: string | null;
  context_only?: boolean; source_tier?: number;
  // raw audit
  endpoint: string; status_code: number; raw_payload: any;
};

// Returns { shock, obs } — obs is the raw source_observations audit row (id pre-set
// in JS so we can link shock.source_observation_id deterministically).
function buildOfficialShock(s: ShockInput, runSummaryId: string | null): { shock: any; obs: any } {
  const percent_change = pct(s.previous_value, s.current_value);
  const fresh = freshness(s.period_end, s.cadence);
  const direction = percent_change == null ? "unknown" : percent_change > 0 ? "up" : percent_change < 0 ? "down" : "mixed";
  const hasChange = percent_change != null;
  const stale = fresh === "stale";
  const canPublish = !s.context_only && hasChange && !stale;
  let reason: string | null = null;
  if (s.context_only) reason = "trade_flow_or_macro_context_needs_company_mapping";
  else if (!hasChange) reason = "no_computable_change";
  else if (stale) reason = "stale_period";

  const obsId = crypto.randomUUID();
  const nowIso = new Date().toISOString();
  const obs = {
    id: obsId,
    source_run_id: runSummaryId,
    source_name: s.source_name,
    endpoint: s.endpoint,
    request_params: { metric_id: s.metric_id, period: s.source_period ?? s.period_end },
    status_code: s.status_code,
    fetched_at: nowIso,
    source_series_id: s.metric_id,
    source_metric_name: s.metric_name,
    source_period: s.source_period ?? s.period_end,
    raw_current_value: String(s.current_value),
    raw_previous_value: String(s.previous_value),
    parsed_current_value: s.current_value,
    parsed_previous_value: s.previous_value,
    parsed_percent_change: percent_change,
    raw_payload: s.raw_payload ?? {},
    parse_status: "parsed",
    parse_error: null,
    numeric_shock_id: null as string | null, // set after shocks insert
  };

  const shock = {
    company_id: null,
    source_type: "official_structured_metric",
    source_name: s.source_name,
    source_tier: s.source_tier ?? 1,
    source_trust: "official",
    source_url: s.source_url ?? null,
    source_domain: null,
    source_period: s.source_period ?? s.period_end,
    period_start: s.period_start ?? null,
    period_end: s.period_end,
    observed_at: nowIso,
    refreshed_at: nowIso,
    driver: s.driver,
    driver_category: driverCategory(s.driver),
    commodity: s.commodity ?? null,
    geography: s.geography ?? "US",
    entity: null,
    metric_name: s.metric_name,
    metric_id: s.metric_id,
    claim_text: null,
    snippet: `${s.metric_name}: ${s.previous_value} -> ${s.current_value} (${percent_change == null ? "n/a" : (percent_change > 0 ? "+" : "") + percent_change + "%"}), ${s.source_period ?? s.period_end ?? ""}`.trim(),
    current_value: s.current_value,
    previous_value: s.previous_value,
    numeric_value: percent_change,
    numeric_unit: percent_change == null ? null : "pct",
    percent_change,
    percentage_point_change: null,
    bps_change: null,
    change_type: s.change_type ?? "percent_change",
    direction,
    freshness_level: fresh,
    confidence: s.context_only ? 0.6 : 0.95,
    extraction_method: "official_api",
    corroboration_status: s.context_only ? "context_only" : "official",
    can_publish: canPublish,
    cannot_publish_reason: reason,
    company_mapping_status: "context_only",
    shock_key: `${s.source_key}:${s.metric_id}:${s.period_end ?? "na"}`,
    run_summary_id: runSummaryId,
    source_observation_id: obsId,
    // Rich audit blob (raw values + endpoint + status) so a numeric_shock alone is auditable.
    raw_source_payload: {
      unit_raw: s.unit_raw ?? null, cadence: s.cadence, endpoint: s.endpoint, status_code: s.status_code,
      series_id: s.metric_id, raw_current_value: s.current_value, raw_previous_value: s.previous_value,
      source_period: s.source_period ?? s.period_end, fetched_at: nowIso,
    },
  };
  return { shock, obs };
}

const BLS_SERIES = [
  { id: "WPU101", name: "PPI: Iron and steel", driver: "steel_metal_price_pressure", commodity: "Steel" },
  { id: "WPU101707", name: "PPI: Cold rolled steel sheet and strip", driver: "steel_metal_price_pressure", commodity: "Steel" },
  { id: "WPU101704", name: "PPI: Hot rolled steel bars, plates, structural shapes", driver: "steel_metal_price_pressure", commodity: "Steel" },
  { id: "WPU1025", name: "PPI: Aluminum mill shapes", driver: "aluminum_price_pressure", commodity: "Aluminum" },
  { id: "WPU10260314", name: "PPI: Copper wire and cable", driver: "copper_price_pressure", commodity: "Copper" },
  { id: "WPU107", name: "PPI: Fabricated structural metal products", driver: "steel_metal_price_pressure", commodity: "Fabricated metal" },
  { id: "PCUOMFG--OMFG--", name: "PPI: Total manufacturing industries", driver: "manufacturing_price_pressure", commodity: null },
  { id: "PCU4841--4841--", name: "PPI: Truck transportation", driver: "freight_logistics_cost", commodity: null },
  { id: "PCU484121484121", name: "PPI: General freight trucking, long-distance TL", driver: "freight_logistics_cost", commodity: null },
  { id: "PCU488510488510", name: "PPI: Freight transportation arrangement", driver: "freight_logistics_cost", commodity: null },
  { id: "WPUFD4", name: "PPI: Final demand", driver: "macro_price_pressure", commodity: null },
];

const FRED_SERIES = [
  { id: "GASDESW", name: "US No. 2 Diesel Retail Price", driver: "fuel_energy_cost", unit: "usd_per_gal", cadence: "weekly" as const },
  { id: "DCOILWTICO", name: "Crude Oil WTI Spot", driver: "fuel_energy_cost", unit: "usd_per_bbl", cadence: "weekly" as const },
  { id: "INDPRO", name: "Industrial Production Index", driver: "manufacturing_demand", unit: "index", cadence: "monthly" as const },
  { id: "IPMAN", name: "Industrial Production: Manufacturing", driver: "manufacturing_demand", unit: "index", cadence: "monthly" as const },
  { id: "DGORDER", name: "Manufacturers' New Orders: Durable Goods", driver: "manufacturing_demand", unit: "usd", cadence: "monthly" as const },
  { id: "DTWEXBGS", name: "Trade-Weighted USD Index: Broad", driver: "fx_import_cost", unit: "index", cadence: "monthly" as const },
  { id: "IR", name: "Import Price Index: All Commodities", driver: "fx_import_cost", unit: "index", cadence: "monthly" as const },
  { id: "PPIACO", name: "PPI: All Commodities", driver: "macro_price_pressure", unit: "index", cadence: "monthly" as const },
];

type SourceResult = {
  source_key: string; source_name: string; configured: boolean; key_present: boolean;
  metrics_fetched: number; numeric_shocks_created: number; latest_period: string | null;
  freshness_level: string | null; last_success_at: string | null;
  errors: string[]; warnings: string[]; shocks: any[]; observations: any[];
};
function emptyResult(key: string, name: string): SourceResult {
  return { source_key: key, source_name: name, configured: false, key_present: false, metrics_fetched: 0, numeric_shocks_created: 0, latest_period: null, freshness_level: null, last_success_at: null, errors: [], warnings: [], shocks: [], observations: [] };
}
function record(r: SourceResult, built: { shock: any; obs: any }) {
  r.shocks.push(built.shock); r.observations.push(built.obs);
}

async function refreshBls(runId: string | null): Promise<SourceResult> {
  const r = emptyResult("bls", "BLS");
  const key = Deno.env.get("BLS_API_KEY") || "";
  r.key_present = !!key; r.configured = true;
  const now = new Date();
  const body: any = { seriesid: BLS_SERIES.map((s) => s.id), startyear: String(now.getFullYear() - 2), endyear: String(now.getFullYear()) };
  if (key) body.registrationkey = key;
  const url = key ? "https://api.bls.gov/publicAPI/v2/timeseries/data/" : "https://api.bls.gov/publicAPI/v1/timeseries/data/";
  const res = await safeFetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok || !res.data) { r.errors.push(res.error ?? "BLS upstream error"); return r; }
  if (res.data.status && res.data.status !== "REQUEST_SUCCEEDED") { r.errors.push(`BLS: ${(res.data.message || []).join("; ") || res.data.status}`); return r; }
  const byId = new Map<string, any[]>((res.data.Results?.series ?? []).map((s: any) => [s.seriesID, s.data ?? []]));
  let latest: string | null = null;
  for (const series of BLS_SERIES) {
    const obs = (byId.get(series.id) ?? []).filter((d: any) => d.value !== "" && d.value != null && !Number.isNaN(Number(d.value)));
    if (obs.length < 2) { r.warnings.push(`${series.id}: <2 observations`); continue; }
    r.metrics_fetched++;
    const cur = obs[0], prev = obs[1];
    const m = /^M(\d{2})$/.exec(cur.period);
    const periodEnd = m ? `${cur.year}-${m[1]}-01` : `${cur.year}-01-01`;
    const mp = /^M(\d{2})$/.exec(prev.period);
    const periodStart = mp ? `${prev.year}-${mp[1]}-01` : `${prev.year}-01-01`;
    if (!latest || periodEnd > latest) latest = periodEnd;
    record(r, buildOfficialShock({
      source_key: "bls", source_name: "BLS", source_url: `https://data.bls.gov/timeseries/${series.id}`,
      metric_id: series.id, metric_name: series.name, driver: series.driver, commodity: series.commodity,
      current_value: Number(cur.value), previous_value: Number(prev.value),
      period_end: periodEnd, period_start: periodStart, source_period: `${cur.periodName ?? cur.period} ${cur.year}`,
      cadence: "monthly", change_type: "index_change", unit_raw: "index",
      endpoint: url, status_code: res.status, raw_payload: { current: cur, previous: prev },
    }, runId));
  }
  r.numeric_shocks_created = r.shocks.length;
  r.latest_period = latest;
  r.freshness_level = latest ? freshness(latest, "monthly") : null;
  if (r.shocks.length > 0) r.last_success_at = new Date().toISOString();
  else if (r.errors.length === 0) r.warnings.push("BLS reachable but no usable series");
  return r;
}

async function refreshFred(runId: string | null): Promise<SourceResult> {
  const r = emptyResult("fred", "FRED");
  const key = Deno.env.get("FRED_API_KEY") || "";
  r.key_present = !!key; r.configured = !!key;
  if (!key) { r.errors.push("FRED_API_KEY not set"); return r; }
  let latest: string | null = null;
  for (const series of FRED_SERIES) {
    const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${series.id}&api_key=${key}&file_type=json&sort_order=desc&limit=24`;
    const auditUrl = url.replace(key, "***");
    const res = await safeFetch(url);
    if (!res.ok || !res.data?.observations) { r.warnings.push(`${series.id}: ${res.error ?? "no data"}`); continue; }
    const obs = (res.data.observations as any[]).filter((o) => o.value !== "." && o.value != null && !Number.isNaN(Number(o.value)));
    if (obs.length < 2) { r.warnings.push(`${series.id}: <2 observations`); continue; }
    r.metrics_fetched++;
    const cur = obs[0], prev = obs[1];
    if (!latest || cur.date > latest) latest = cur.date;
    record(r, buildOfficialShock({
      source_key: "fred", source_name: "FRED", source_url: `https://fred.stlouisfed.org/series/${series.id}`,
      metric_id: series.id, metric_name: series.name, driver: series.driver,
      current_value: Number(cur.value), previous_value: Number(prev.value),
      period_end: cur.date, period_start: prev.date, source_period: cur.date,
      cadence: series.cadence, change_type: "price_change", unit_raw: series.unit,
      endpoint: auditUrl, status_code: res.status, raw_payload: { current: cur, previous: prev },
    }, runId));
  }
  r.numeric_shocks_created = r.shocks.length;
  r.latest_period = latest;
  r.freshness_level = latest ? freshness(latest, "monthly") : null;
  if (r.shocks.length > 0) r.last_success_at = new Date().toISOString();
  return r;
}

async function refreshEia(runId: string | null): Promise<SourceResult> {
  const r = emptyResult("eia", "EIA");
  const key = Deno.env.get("EIA_API_KEY") || "";
  r.key_present = !!key; r.configured = !!key;
  if (!key) { r.errors.push("EIA_API_KEY not set"); return r; }
  const targets = [
    { url: `https://api.eia.gov/v2/petroleum/pri/gnd/data/?api_key=${key}&frequency=weekly&data[0]=value&facets[product][]=EPD2D&facets[duoarea][]=NUS&sort[0][column]=period&sort[0][direction]=desc&offset=0&length=12`,
      id: "EIA_DIESEL_NUS", name: "US On-Highway Diesel Retail Price", driver: "fuel_energy_cost", unit: "usd_per_gal", commodity: "Diesel" },
    { url: `https://api.eia.gov/v2/petroleum/pri/spt/data/?api_key=${key}&frequency=weekly&data[0]=value&facets[series][]=RWTC&sort[0][column]=period&sort[0][direction]=desc&offset=0&length=12`,
      id: "EIA_WTI", name: "Crude Oil WTI Spot (Cushing)", driver: "fuel_energy_cost", unit: "usd_per_bbl", commodity: "Crude oil" },
  ];
  let latest: string | null = null;
  for (const t of targets) {
    const res = await safeFetch(t.url);
    const rows = res.data?.response?.data;
    if (!res.ok || !Array.isArray(rows)) { r.warnings.push(`${t.id}: ${res.error ?? "no data"}`); continue; }
    const obs = rows.filter((o: any) => o.value != null && !Number.isNaN(Number(o.value)));
    if (obs.length < 2) { r.warnings.push(`${t.id}: <2 observations`); continue; }
    r.metrics_fetched++;
    const cur = obs[0], prev = obs[1];
    if (!latest || String(cur.period) > latest) latest = String(cur.period);
    record(r, buildOfficialShock({
      source_key: "eia", source_name: "EIA", source_url: "https://www.eia.gov/petroleum/",
      metric_id: t.id, metric_name: t.name, driver: t.driver, commodity: t.commodity,
      current_value: Number(cur.value), previous_value: Number(prev.value),
      period_end: String(cur.period), period_start: String(prev.period), source_period: String(cur.period),
      cadence: "weekly", change_type: "price_change", unit_raw: t.unit,
      endpoint: t.url.replace(key, "***"), status_code: res.status, raw_payload: { current: cur, previous: prev },
    }, runId));
  }
  r.numeric_shocks_created = r.shocks.length;
  r.latest_period = latest;
  r.freshness_level = latest ? freshness(latest, "weekly") : null;
  if (r.shocks.length > 0) r.last_success_at = new Date().toISOString();
  return r;
}

async function refreshCensus(runId: string | null): Promise<SourceResult> {
  const r = emptyResult("census", "Census");
  const key = Deno.env.get("CENSUS_API_KEY") || "";
  r.key_present = !!key; r.configured = !!key;
  if (!key) { r.errors.push("CENSUS_API_KEY not set"); return r; }
  const commodities = [
    { hs: "72", name: "Imports: Iron and steel (HS72)", driver: "steel_trade_flow", commodity: "Steel" },
    { hs: "73", name: "Imports: Articles of iron or steel (HS73, incl. fasteners)", driver: "steel_trade_flow", commodity: "Fasteners" },
    { hs: "76", name: "Imports: Aluminum (HS76)", driver: "aluminum_trade_flow", commodity: "Aluminum" },
    { hs: "74", name: "Imports: Copper (HS74)", driver: "copper_trade_flow", commodity: "Copper" },
  ];
  // Relative window: previous calendar year onward (Census imports lag ~5-6 weeks).
  const fromYear = new Date().getFullYear() - 1;
  let latest: string | null = null;
  let htmlErr: string | null = null;
  for (const c of commodities) {
    const url = `https://api.census.gov/data/timeseries/intltrade/imports/hs?get=GEN_VAL_MO&I_COMMODITY=${c.hs}&COMM_LVL=HS2&time=from+${fromYear}-01&key=${key}`;
    const auditUrl = url.replace(key, "***");
    const res = await safeFetch(url, undefined, 14000);
    const html = detectHtmlError(res.text);
    if (html) { htmlErr = html; r.warnings.push(`HS${c.hs}: ${html}`); continue; }
    if (!res.ok || !Array.isArray(res.data) || res.data.length < 3) {
      const snippet = res.error ?? (Array.isArray(res.data) ? `only ${res.data.length} row(s)` : `non-array body: ${(res.text || "").slice(0, 120)}`);
      r.warnings.push(`HS${c.hs}: ${snippet}`); continue;
    }
    const header = res.data[0] as string[];
    const valIdx = header.indexOf("GEN_VAL_MO"); const timeIdx = header.indexOf("time");
    const rows = (res.data.slice(1) as any[][]).map((row) => ({ value: Number(row[valIdx]), time: String(row[timeIdx]) }))
      .filter((x) => Number.isFinite(x.value)).sort((a, b) => a.time.localeCompare(b.time));
    if (rows.length < 2) { r.warnings.push(`HS${c.hs}: <2 months`); continue; }
    r.metrics_fetched++;
    const cur = rows[rows.length - 1], prev = rows[rows.length - 2];
    const periodEnd = `${cur.time}-01`;
    if (!latest || periodEnd > latest) latest = periodEnd;
    record(r, buildOfficialShock({
      source_key: "census", source_name: "Census", source_url: "https://www.census.gov/foreign-trade/",
      metric_id: `CENSUS_IMP_HS${c.hs}`, metric_name: c.name, driver: c.driver, commodity: c.commodity,
      current_value: cur.value, previous_value: prev.value,
      period_end: periodEnd, period_start: `${prev.time}-01`, source_period: cur.time,
      cadence: "monthly", change_type: "volume_change", unit_raw: "usd", context_only: true, source_tier: 1,
      endpoint: auditUrl, status_code: res.status, raw_payload: { current: cur, previous: prev },
    }, runId));
  }
  r.numeric_shocks_created = r.shocks.length;
  r.latest_period = latest;
  r.freshness_level = latest ? freshness(latest, "monthly") : null;
  if (r.shocks.length > 0) r.last_success_at = new Date().toISOString();
  else if (htmlErr) r.errors.push(`Census key issue: ${htmlErr}`); // promote to error so it's visible, not silent
  else if (r.errors.length === 0) r.warnings.push("Census reachable but no usable trade months");
  return r;
}

async function refreshUsitc(runId: string | null): Promise<SourceResult> {
  const r = emptyResult("usitc", "USITC");
  const key = Deno.env.get("USITC_API_KEY") || "";
  r.key_present = !!key; r.configured = !!key;
  if (!key) { r.errors.push("USITC_API_KEY not set"); return r; }

  // Confirm auth/connectivity against a documented GET first (the old getAllReleases path 404'd).
  const globals = await safeFetch("https://datawebws.usitc.gov/dataweb/api/v2/query/getGlobalVars", {
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
  });
  if (!globals.ok) {
    r.errors.push(`USITC getGlobalVars HTTP ${globals.status || "0"}: ${(globals.text || globals.error || "unreachable").slice(0, 140)}`);
    return r;
  }
  const curYear = globals.data?.currentYear ?? globals.data?.year ?? new Date().getFullYear();

  // Real data query: POST runReport with a minimal SavedQuery (annual HTS imports, HS72 steel + HS76 aluminum).
  const targets = [
    { hts: "72", name: "US imports: Iron and steel (HS72)", driver: "steel_trade_flow", commodity: "Steel" },
    { hts: "76", name: "US imports: Aluminum (HS76)", driver: "aluminum_trade_flow", commodity: "Aluminum" },
  ];
  let latest: string | null = null;
  for (const t of targets) {
    const body = {
      savedQueryName: "", savedQueryDesc: "", isOwner: true, runMonthly: false,
      reportOptions: {
        tradeType: "Import", classificationSystem: "HTS",
        timeframeSelectType: "fullYears", timeline: "Annual",
        years: [String(curYear - 2), String(curYear - 1)],
        dataToReport: ["GEN_VAL_MO"],
        commodities: [t.hts], commoditySelectType: "List", granularity: 2, commoditiesAgg: "AGG",
        countries: [], countriesSelectType: "all", countriesAgg: "AGG",
        importPrograms: [], programsSelectType: "all",
      },
    };
    const res = await fetchWithRetry("https://datawebws.usitc.gov/dataweb/api/v2/report2/runReport", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }, { timeoutMs: 20000, retries: 2, backoffMs: 2000 });
    await sleep(600);
    if (!res.ok) {
      r.warnings.push(`HS${t.hts}: runReport HTTP ${res.status} ${(res.text || res.error || "").slice(0, 160)}`);
      continue;
    }
    // QueryResults table — find the two most recent annual values for this commodity.
    const parsed = parseUsitcAnnual(res.data);
    if (!parsed || parsed.length < 2) {
      r.warnings.push(`HS${t.hts}: runReport OK but could not parse 2 annual values; body: ${JSON.stringify(res.data).slice(0, 180)}`);
      continue;
    }
    parsed.sort((a, b) => a.year - b.year);
    const cur = parsed[parsed.length - 1], prev = parsed[parsed.length - 2];
    r.metrics_fetched++;
    const periodEnd = `${cur.year}-12-31`;
    if (!latest || periodEnd > latest) latest = periodEnd;
    record(r, buildOfficialShock({
      source_key: "usitc", source_name: "USITC", source_url: "https://dataweb.usitc.gov/",
      metric_id: `USITC_IMP_HS${t.hts}`, metric_name: t.name, driver: t.driver, commodity: t.commodity,
      current_value: cur.value, previous_value: prev.value,
      period_end: periodEnd, period_start: `${prev.year}-12-31`, source_period: String(cur.year),
      cadence: "monthly", change_type: "volume_change", unit_raw: "usd", context_only: true, source_tier: 1,
      endpoint: "POST /api/v2/report2/runReport", status_code: res.status, raw_payload: { current: cur, previous: prev },
    }, runId));
  }
  r.numeric_shocks_created = r.shocks.length;
  r.latest_period = latest;
  r.freshness_level = latest ? "acceptable_lag" : null;
  if (r.shocks.length > 0) r.last_success_at = new Date().toISOString();
  else if (r.errors.length === 0) { r.warnings.push("USITC auth OK (getGlobalVars); runReport returned no parseable annual values this run."); r.last_success_at = new Date().toISOString(); }
  return r;
}

// Best-effort extractor for USITC runReport: walks the nested QueryResults table and
// returns {year, value} pairs. The exact shape is verified via live diagnostics, so this
// scans defensively for year-labelled numeric cells rather than assuming fixed indices.
function parseUsitcAnnual(data: any): Array<{ year: number; value: number }> | null {
  if (!data) return null;
  const out: Array<{ year: number; value: number }> = [];
  const seen = new Set<number>();
  const visit = (node: any) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { node.forEach(visit); return; }
    // Common DataWeb cell shapes: {year, value} / {column, value} / {rowEntries:[...]}
    const yr = Number(node.year ?? node.column ?? node.label);
    const val = Number(node.value ?? node.val ?? node.total);
    if (Number.isFinite(yr) && yr > 2000 && yr < 2100 && Number.isFinite(val) && val > 0 && !seen.has(yr)) {
      seen.add(yr); out.push({ year: yr, value: val });
    }
    for (const k of Object.keys(node)) visit(node[k]);
  };
  visit(data);
  return out.length ? out : null;
}

async function refreshUnComtrade(runId: string | null): Promise<SourceResult> {
  const r = emptyResult("un_comtrade", "UN Comtrade");
  const key = Deno.env.get("UN_COMTRADE_API_KEY") || "";
  r.key_present = !!key; r.configured = !!key;
  if (!key) { r.errors.push("UN_COMTRADE_API_KEY not set"); return r; }
  const now = new Date().getFullYear();
  const targets = [
    { cmd: "72", name: "US imports: Iron and steel (HS72)", driver: "steel_trade_flow", commodity: "Steel" },
    { cmd: "76", name: "US imports: Aluminum (HS76)", driver: "aluminum_trade_flow", commodity: "Aluminum" },
  ];
  let latest: string | null = null;
  for (const t of targets) {
    const period = `${now - 2},${now - 1}`;
    const url = `https://comtradeapi.un.org/data/v1/get/C/A/HS?reporterCode=842&flowCode=M&cmdCode=${t.cmd}&period=${period}&partnerCode=0&partner2Code=0&customsCode=C00&motCode=0`;
    // Comtrade throttles bursts (HTTP 429); retry with backoff and space sequential requests.
    const res = await fetchWithRetry(url, { headers: { "Ocp-Apim-Subscription-Key": key, Accept: "application/json" } }, { timeoutMs: 14000, retries: 3, backoffMs: 2000 });
    await sleep(800);
    const rows = res.data?.data;
    if (!res.ok || !Array.isArray(rows) || rows.length < 2) { r.warnings.push(`HS${t.cmd}: ${res.error ?? "insufficient data"}`); continue; }
    const series = rows.map((d: any) => ({ year: Number(d.period ?? d.refYear), value: Number(d.primaryValue ?? d.TradeValue) }))
      .filter((x: any) => Number.isFinite(x.year) && Number.isFinite(x.value)).sort((a: any, b: any) => a.year - b.year);
    if (series.length < 2) { r.warnings.push(`HS${t.cmd}: <2 years`); continue; }
    r.metrics_fetched++;
    const cur = series[series.length - 1], prev = series[series.length - 2];
    const periodEnd = `${cur.year}-12-31`;
    if (!latest || periodEnd > latest) latest = periodEnd;
    record(r, buildOfficialShock({
      source_key: "un_comtrade", source_name: "UN Comtrade", source_url: "https://comtradeplus.un.org/",
      metric_id: `COMTRADE_US_IMP_HS${t.cmd}`, metric_name: t.name, driver: t.driver, commodity: t.commodity,
      current_value: cur.value, previous_value: prev.value,
      period_end: periodEnd, period_start: `${prev.year}-12-31`, source_period: String(cur.year),
      cadence: "monthly", change_type: "volume_change", unit_raw: "usd", context_only: true, source_tier: 1,
      endpoint: url, status_code: res.status, raw_payload: { current: cur, previous: prev },
    }, runId));
  }
  r.numeric_shocks_created = r.shocks.length;
  r.latest_period = latest;
  r.freshness_level = latest ? "acceptable_lag" : null;
  if (r.shocks.length > 0) r.last_success_at = new Date().toISOString();
  return r;
}

async function persist(db: any, results: SourceResult[]) {
  for (const r of results) {
    // Full-refresh: replace this source's official shocks + observations, then insert.
    await db.from("numeric_shocks").delete().eq("source_name", r.source_name).eq("source_type", "official_structured_metric");
    await db.from("source_observations").delete().eq("source_name", r.source_name);
    if (r.observations.length > 0) {
      const { error: oerr } = await db.from("source_observations").insert(r.observations);
      if (oerr) r.errors.push(`obs insert: ${oerr.message}`);
    }
    if (r.shocks.length > 0) {
      const { error } = await db.from("numeric_shocks").insert(r.shocks);
      if (error) r.errors.push(`ledger insert: ${error.message}`);
      else {
        // Back-link observations → numeric_shocks by shock_key→observation_id map.
        const { data: inserted } = await db.from("numeric_shocks")
          .select("id, source_observation_id").eq("source_name", r.source_name).eq("source_type", "official_structured_metric");
        for (const row of (inserted ?? [])) {
          if (row.source_observation_id) {
            await db.from("source_observations").update({ numeric_shock_id: row.id }).eq("id", row.source_observation_id);
          }
        }
      }
    }
    await db.from("source_health").upsert({
      source_key: r.source_key, source_name: r.source_name, configured: r.configured, key_present: r.key_present,
      last_run_at: new Date().toISOString(), last_success_at: r.last_success_at,
      last_error: r.errors.length ? r.errors.join(" | ").slice(0, 1000) : null,
      metrics_fetched: r.metrics_fetched, numeric_shocks_created: r.numeric_shocks_created,
      latest_period: r.latest_period, freshness_level: r.freshness_level,
      warnings: r.warnings.slice(0, 30), errors: r.errors.slice(0, 30), updated_at: new Date().toISOString(),
    }, { onConflict: "source_key" });
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  let body: any = {};
  try { body = await req.json(); } catch { /* allow empty */ }
  const runId: string | null = body?.runSummaryId ?? null;
  const only: string[] | null = Array.isArray(body?.only) ? body.only : null;

  const db = admin();
  const all: Array<[string, (id: string | null) => Promise<SourceResult>]> = [
    ["bls", refreshBls], ["fred", refreshFred], ["eia", refreshEia],
    ["census", refreshCensus], ["usitc", refreshUsitc], ["un_comtrade", refreshUnComtrade],
  ];
  const selected = only ? all.filter(([k]) => only.includes(k)) : all;

  const results: SourceResult[] = [];
  for (const [, fn] of selected) {
    try { results.push(await fn(runId)); }
    catch (e) { results.push({ ...emptyResult("unknown", "unknown"), errors: [e instanceof Error ? e.message : "connector crashed"] }); }
  }
  await persist(db, results);

  const succeeded = results.filter((r) => r.last_success_at).length;
  const failed = results.filter((r) => r.errors.length > 0).length;
  const observations = results.reduce((a, r) => a + r.observations.length, 0);

  const summary = {
    ok: true,
    sources_attempted: results.length,
    sources_succeeded: succeeded,
    sources_failed: failed,
    source_observations_created: observations,
    bls_metrics_refreshed: results.find((r) => r.source_key === "bls")?.numeric_shocks_created ?? 0,
    fred_metrics_refreshed: results.find((r) => r.source_key === "fred")?.numeric_shocks_created ?? 0,
    eia_metrics_refreshed: results.find((r) => r.source_key === "eia")?.numeric_shocks_created ?? 0,
    census_metrics_refreshed: results.find((r) => r.source_key === "census")?.numeric_shocks_created ?? 0,
    usitc_metrics_refreshed: results.find((r) => r.source_key === "usitc")?.numeric_shocks_created ?? 0,
    un_comtrade_metrics_refreshed: results.find((r) => r.source_key === "un_comtrade")?.numeric_shocks_created ?? 0,
    numeric_shocks_created: results.reduce((a, r) => a + r.numeric_shocks_created, 0),
    source_refresh_errors: results.reduce((a, r) => a + r.errors.length, 0),
    sources: results.map((r) => ({
      source_key: r.source_key, configured: r.configured, key_present: r.key_present,
      metrics_fetched: r.metrics_fetched, numeric_shocks_created: r.numeric_shocks_created,
      latest_period: r.latest_period, freshness_level: r.freshness_level,
      errors: r.errors, warnings: r.warnings.slice(0, 8),
    })),
  };
  return json(summary);
});
