import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import type { MetricCsvCategory } from "../services/sources/manualMetricImportService";
import ManualMetricImportPanel from "../components/sources/ManualMetricImportPanel";
import { SOURCE_HUB_CSS } from "../components/sources/sourceHubStyles";
import { isDemoMode, canViewAdminControls } from "../services/companyService";

// Source Hub — ONE truth system. Every panel reads the server-side numeric ledger
// (source_health_v + numeric_shocks + source_observations + article_metric_claims),
// never the old browser connectors or VITE_ key checks. Keys live in Edge Function
// secrets; key_present comes from source_health.

type Tab = "overview" | "shocks" | "observations" | "claims" | "imports";
const TABS: { key: Tab; label: string }[] = [
  { key: "overview", label: "Connectors" },
  { key: "shocks", label: "Numeric Shocks" },
  { key: "observations", label: "Raw Source Audit" },
  { key: "claims", label: "Article Claims" },
  { key: "imports", label: "Manual CSV Imports" },
];

type HealthRow = {
  source_key: string; source_name: string | null; configured: boolean; key_present: boolean;
  last_run_at: string | null; last_success_at: string | null; last_error: string | null;
  metrics_fetched: number; numeric_shocks_created: number; latest_period: string | null;
  freshness_level: string | null; metrics_stored: number; numeric_shocks_stored: number;
  publishable_shocks: number; warnings: unknown; errors: unknown;
};

// Human-friendly period label — executive UI should never show a raw ISO date
// like "2026-05-01" (that stays in the Raw Source Audit tab only).
function friendlyPeriod(sourceName: string | null, period: string | null): string {
  if (!period) return "—";
  const iso = period.length === 10 ? `${period}T00:00:00` : period;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return period;
  const monthYear = d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const src = (sourceName || "").toUpperCase();
  if (/-01$/.test(period)) return `${monthYear} · latest official monthly ${src} release`;
  const day = d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return `week of ${day} · latest official ${src} reading`;
}

// A key is "invalid" when the connector surfaced a credential error (e.g. Census
// invalid/expired key) even though the secret is present.
function keyInvalid(h: HealthRow): boolean {
  return h.key_present && /key/i.test(String(h.last_error ?? ""));
}

// What kind of source each connector is (display only).
const SOURCE_KIND: Record<string, string> = {
  bls: "Official metric", fred: "Official metric", eia: "Official metric",
  census: "Official trade", usitc: "Official trade", un_comtrade: "Official trade (context)",
};
function connectorState(h: HealthRow): { label: string; cls: string } {
  const err = String(h.last_error ?? "").toLowerCase();
  // An invalid/expired key is a config issue, not a connector failure — make it
  // actionable rather than a scary generic "error".
  if (err.includes("key")) return { label: "key invalid/expired", cls: "scenario_only" };
  if (h.last_error) return { label: "error", cls: "error" };
  if (h.publishable_shocks > 0) return { label: "live", cls: "verified" };
  if (h.numeric_shocks_stored > 0) return { label: "live (context)", cls: "manual" };
  // Auth + endpoint reachable but the query returned no rows (e.g. USITC runReport
  // returns HTTP 200 with empty tables). That is NOT a hard error.
  if (h.key_present && h.last_success_at) return { label: "reachable · no rows", cls: "scenario_only" };
  if (h.key_present) return { label: "configured · no rows", cls: "scenario_only" };
  return { label: "not configured", cls: "not_configured" };
}

// Honest, source-specific explanation line for the connector card.
function connectorReason(h: HealthRow): string {
  const err = String(h.last_error ?? "").toLowerCase();
  if (err.includes("key")) {
    return `Invalid/expired key — rotate ${h.source_key.toUpperCase()}_API_KEY server-side secret. This is a credential issue, not a query or data problem.`;
  }
  if (h.last_error) return `Error: ${h.last_error}`;
  // Reachable + authenticated but no rows returned (USITC runReport empty tables).
  if (h.key_present && h.last_success_at && h.numeric_shocks_stored === 0) {
    const note = h.source_key === "usitc"
      ? " UN Comtrade currently covers HS72/HS76 trade-flow context."
      : "";
    return `Auth + endpoint reachable; no rows returned this run.${note}`;
  }
  if (h.last_success_at) {
    return `Last success ${new Date(h.last_success_at).toLocaleString()} · ${h.metrics_fetched} series fetched · freshness ${h.freshness_level ?? "—"}.`;
  }
  return "Configured; awaiting first successful fetch.";
}

export default function SourceHubPage() {
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState<string>("");
  const [health, setHealth] = useState<HealthRow[]>([]);
  const [shocks, setShocks] = useState<Record<string, unknown>[]>([]);
  const [observations, setObservations] = useState<Record<string, unknown>[]>([]);
  const [claims, setClaims] = useState<Record<string, unknown>[]>([]);
  const [tab, setTab] = useState<Tab>("overview");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshNote, setRefreshNote] = useState<string | null>(null);
  const [importFor] = useState<MetricCsvCategory | null>(null);

  useEffect(() => { void load(); }, []);

  async function load() {
    setLoading(true);
    const saved = localStorage.getItem("groundsense_company_id");
    let q = supabase.from("companies").select("id,name");
    q = saved ? q.eq("id", saved) : q.order("created_at", { ascending: false }).limit(1);
    const { data: companies } = await q;
    const c = companies?.[0] as { id: string; name: string } | undefined;
    if (c) { setCompanyId(c.id); setCompanyName(c.name); }
    await reload(c?.id ?? null);
    setLoading(false);
  }

  async function reload(cid: string | null) {
    const [h, s, o, cl] = await Promise.all([
      supabase.from("source_health_v").select("*").order("source_key"),
      supabase.from("numeric_shocks").select("source_name, metric_name, driver, driver_category, commodity, current_value, previous_value, percent_change, numeric_unit, source_period, can_publish, source_url, source_type").eq("source_type", "official_structured_metric").order("source_name"),
      supabase.from("source_observations").select("source_name, source_metric_name, endpoint, status_code, raw_current_value, raw_previous_value, parsed_percent_change, source_period, fetched_at").order("fetched_at", { ascending: false }).limit(60),
      cid ? supabase.from("numeric_shocks").select("claim_text, numeric_value, numeric_unit, driver, corroboration_status, source_url").eq("source_type", "article_numeric_claim").eq("company_id", cid).limit(60) : Promise.resolve({ data: [] as any[] }),
    ]);
    setHealth((h.data as HealthRow[]) ?? []);
    setShocks((s.data as Record<string, unknown>[]) ?? []);
    setObservations((o.data as Record<string, unknown>[]) ?? []);
    setClaims((cl.data as Record<string, unknown>[]) ?? []);
  }

  // Real Refresh — invokes the SERVER refresh-sources connector (reads Edge
  // Function secrets), then reloads from the ledger.
  async function runRefresh() {
    if (refreshing) return;
    setRefreshing(true); setRefreshNote(null);
    try {
      const { data, error } = await supabase.functions.invoke("refresh-sources", { body: {} });
      if (error) throw error;
      await reload(companyId);
      setRefreshNote(`Refreshed ${data?.sources_succeeded ?? 0}/${data?.sources_attempted ?? 0} sources · ${data?.numeric_shocks_created ?? 0} numeric shocks · ${data?.source_observations_created ?? 0} raw observations.`);
    } catch {
      setRefreshNote("Refresh hit an error; check Raw Source Audit / connector errors below.");
    } finally { setRefreshing(false); }
  }

  if (loading) return <main className="shub-page"><style>{SOURCE_HUB_CSS}</style><div className="shub-wrap">Loading…</div></main>;

  const totalShocks = shocks.length;
  const publishable = shocks.filter((s) => s.can_publish).length;
  const keysPresent = health.filter((h) => h.key_present).length;
  const invalidKeys = health.filter((h) => keyInvalid(h)).length;
  const validKeys = keysPresent - invalidKeys;
  const failing = health.filter((h) => h.last_error).length;

  // Buyer/demo safety: the full Source Hub exposes connector API-key health, invalid-key
  // (e.g. Census) errors, raw article/accounting funnels, refresh internals, and pg_net/run
  // details — all operator-only. Buyers/demo get a safe evidence summary instead and are
  // pointed at the dashboard's Source Coverage card. (Hides the link too; this guards direct
  // URL navigation.)
  if (isDemoMode() || !canViewAdminControls()) {
    return (
      <main className="shub-page">
        <style>{SOURCE_HUB_CSS}</style>
        <div className="shub-wrap">
          <div className="shub-header">
            <div>
              <p className="shub-eyebrow">Evidence sources</p>
              <h1 className="shub-title">Evidence Sources</h1>
              <p className="shub-sub">
                Official numeric sources — BLS, EIA, FRED, Census, and UN Comtrade — back the
                published estimates and watchlist. The detailed connector audit (API-key health,
                raw counts, and run internals) is available in operator mode only.
              </p>
            </div>
          </div>
          <p className="shub-sub" style={{ marginTop: 16 }}>
            See the <Link to="/dashboard">dashboard Source Coverage</Link> card for which official
            sources back each issue and their latest reading dates.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="shub-page">
      <style>{SOURCE_HUB_CSS}</style>
      <div className="shub-wrap">
        <div className="shub-header">
          <div>
            <p className="shub-eyebrow">{companyName} · server-side numeric source ledger</p>
            <h1 className="shub-title">Source Audit</h1>
            <p className="shub-sub">Official numeric sources via Edge Function secrets. Status, keys, and shocks come from source_health + numeric_shocks — one truth system.</p>
          </div>
          <div className="shub-header-actions">
            <Link to="/dashboard"><button className="shub-btn">← Back to Dashboard</button></Link>
            <button className="shub-btn shub-btn-primary" onClick={runRefresh} disabled={refreshing}>
              {refreshing ? "Refreshing…" : "↻ Refresh numeric sources"}
            </button>
          </div>
        </div>

        {refreshNote && <p className="shub-refresh-note">{refreshNote}</p>}

        <div className="shub-summary">
          <SummaryCard value={String(publishable)} label="Publishable numeric shocks" />
          <SummaryCard value={String(totalShocks)} label="Official numeric shocks" />
          <SummaryCard value={`${keysPresent}/${health.length || 6}`} label={`keys present · ${validKeys} valid · ${invalidKeys} invalid`} />
          <SummaryCard value={String(observations.length)} label="Raw source observations" />
          <SummaryCard value={String(claims.length)} label="Article numeric claims" />
          <SummaryCard value={String(failing)} label="Connectors failing" />
        </div>

        <div className="shub-tabs">
          {TABS.map((t) => (
            <button key={t.key} className={`shub-tab ${tab === t.key ? "shub-tab-on" : ""}`} onClick={() => setTab(t.key)}>{t.label}</button>
          ))}
        </div>

        <div className="shub-body">
          {tab === "overview" && (
            <div className="shub-connectors">
              {health.length === 0 && <p className="shub-empty">No source_health rows yet — click “Refresh numeric sources”.</p>}
              {health.map((h) => {
                const st = connectorState(h);
                return (
                  <div key={h.source_key} className="shub-conn-card">
                    <div className="shub-conn-top">
                      <span className="shub-conn-name">{(h.source_name || h.source_key).toUpperCase()}</span>
                      <span className={`shub-status shub-status-${st.cls}`}>{st.label}</span>
                    </div>
                    <div className="shub-conn-meta">
                      <span>Type: {SOURCE_KIND[h.source_key] ?? "official"}</span>
                      <span>Key present: {h.key_present ? "yes" : "no"}</span>
                      <span>Shocks: {h.numeric_shocks_stored} ({h.publishable_shocks} publishable)</span>
                      <span>Latest: {friendlyPeriod(h.source_name, h.latest_period)}</span>
                    </div>
                    <p className="shub-conn-env">Key location: <code>server-side Edge Function secret</code></p>
                    <p className="shub-conn-reason">{connectorReason(h)}</p>
                  </div>
                );
              })}
            </div>
          )}

          {tab === "shocks" && (
            <DataTable
              rows={shocks}
              empty="No numeric shocks yet. Click Refresh numeric sources."
              columns={[
                ["source_name", "Source"], ["metric_name", "Metric"], ["driver_category", "Driver"],
                ["previous_value", "Prev"], ["current_value", "Current"], ["percent_change", "% change"],
                ["source_period", "Period"], ["can_publish", "Publishable"],
              ]}
              fmt={(k, v) => (k === "can_publish" ? (v ? "yes" : "context") : v == null ? "—" : String(v))}
            />
          )}

          {tab === "observations" && (
            <DataTable
              rows={observations}
              empty="No raw source observations yet."
              columns={[
                ["source_name", "Source"], ["source_metric_name", "Metric"], ["status_code", "HTTP"],
                ["raw_previous_value", "Raw prev"], ["raw_current_value", "Raw current"],
                ["parsed_percent_change", "% change"], ["source_period", "Period"], ["endpoint", "Endpoint"],
              ]}
              fmt={(k, v) => (k === "endpoint" ? String(v ?? "").slice(0, 60) : v == null ? "—" : String(v))}
            />
          )}

          {tab === "claims" && (
            <DataTable
              rows={claims}
              empty="No article numeric claims extracted yet. Run an intelligence update."
              columns={[
                ["claim_text", "Claim"], ["numeric_value", "Value"], ["numeric_unit", "Unit"],
                ["driver", "Driver"], ["corroboration_status", "Corroboration"],
              ]}
              fmt={(k, v) => (k === "corroboration_status" ? String(v ?? "").replace(/_/g, " ") : k === "claim_text" ? String(v ?? "").slice(0, 90) : v == null ? "—" : String(v))}
            />
          )}

          {tab === "imports" && (
            <div className="shub-import-block">
              <h3 className="shub-h3">Import structured metric CSV (manual source)</h3>
              <ManualMetricImportPanel companyId={companyId} fixedCategory={importFor ?? undefined} onApplied={() => void reload(companyId)} />
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

function SummaryCard({ value, label }: { value: string; label: string }) {
  return (
    <div className="shub-summary-card">
      <span className="shub-summary-value">{value}</span>
      <span className="shub-summary-label">{label}</span>
    </div>
  );
}

function DataTable({ rows, columns, empty, fmt }: {
  rows: Record<string, unknown>[]; columns: [string, string][]; empty: string;
  fmt: (key: string, value: unknown, row: Record<string, unknown>) => unknown;
}) {
  if (rows.length === 0) return <p className="shub-empty">{empty}</p>;
  return (
    <div className="shub-table-wrap">
      <table className="shub-table">
        <thead><tr>{columns.map(([, label]) => <th key={label}>{label}</th>)}</tr></thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>{columns.map(([key]) => <td key={key}>{String(fmt(key, row[key], row) ?? "—")}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
