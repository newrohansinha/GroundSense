import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { loadSourceHubData, UNSUPPORTED_PAID_SOURCES, type SourceHubData } from "../services/sources/sourceHubData";
import { refreshPublicSources } from "../services/sources/sourceFusionService";
import type { MetricCsvCategory } from "../services/sources/manualMetricImportService";
import type { ConnectorStatus, SourceRunDiagnostic } from "../services/sources/types";
import ManualMetricImportPanel from "../components/sources/ManualMetricImportPanel";
import { SOURCE_HUB_CSS } from "../components/sources/sourceHubStyles";

type Tab = "overview" | "connectors" | "metrics" | "shocks" | "claims" | "imports" | "runs";

const TABS: { key: Tab; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "connectors", label: "Connectors" },
  { key: "metrics", label: "Structured Metrics" },
  { key: "shocks", label: "Verified Shocks" },
  { key: "claims", label: "Article Claims" },
  { key: "imports", label: "Manual CSV Imports" },
  { key: "runs", label: "Source Fusion Runs" },
];

const TEMPLATE_TO_CATEGORY: Record<string, MetricCsvCategory> = {
  "tariff_metric_template.csv": "tariff",
  "freight_index_template.csv": "freight",
  "commodity_price_template.csv": "commodity",
  "trade_flow_template.csv": "trade_flow",
  "macro_indicator_template.csv": "macro",
  "company_filing_metric_template.csv": "company_filing",
};

function statusClass(s: ConnectorStatus["status"]): string {
  return `shub-status shub-status-${s}`;
}

function fmtMoneyish(v: unknown, unit: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  const u = String(unit ?? "");
  if (u === "USD" || u === "$") {
    if (Math.abs(n) >= 1_000_000_000) return `$${(n / 1e9).toFixed(1)}B`;
    if (Math.abs(n) >= 1_000_000) return `$${(n / 1e6).toFixed(1)}M`;
    return `$${n.toLocaleString()}`;
  }
  return `${n.toLocaleString()}${u && u !== "%" ? "" : u}`;
}

export default function SourceHubPage() {
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState<string>("");
  const [data, setData] = useState<SourceHubData | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshNote, setRefreshNote] = useState<string | null>(null);
  const [importFor, setImportFor] = useState<MetricCsvCategory | null>(null);

  useEffect(() => { void load(); }, []);

  async function load() {
    setLoading(true);
    const saved = localStorage.getItem("groundsense_company_id");
    let q = supabase.from("companies").select("id,name");
    q = saved ? q.eq("id", saved) : q.order("created_at", { ascending: false }).limit(1);
    const { data: companies } = await q;
    const c = companies?.[0] as { id: string; name: string } | undefined;
    if (!c) { setLoading(false); return; }
    setCompanyId(c.id);
    setCompanyName(c.name);
    setData(await loadSourceHubData(c.id));
    setLoading(false);
  }

  // Reload UI from DB (no ingestion).
  async function reload() {
    if (companyId) setData(await loadSourceHubData(companyId));
  }

  // Real Refresh — runs public-source ingestion, then reloads.
  async function runRefresh() {
    if (!companyId || refreshing) return;
    setRefreshing(true);
    setRefreshNote(null);
    try {
      const res = await refreshPublicSources(companyId);
      setData(await loadSourceHubData(companyId));
      setRefreshNote(`Ingestion complete — ${res.metricsStored} metric(s) stored, ${res.shocksCreated} verified shock(s) created across ${res.diagnostics.length} sources.`);
    } catch {
      setRefreshNote("Refresh hit an error; see Source Fusion Runs for details.");
    } finally {
      setRefreshing(false);
    }
  }

  // Latest run diagnostics, keyed by source, for connector cards.
  const latestRunBySource: Record<string, SourceRunDiagnostic> = {};
  const latestRun = (data?.runs ?? [])[0];
  if (latestRun && Array.isArray(latestRun.sources_checked)) {
    for (const d of latestRun.sources_checked as SourceRunDiagnostic[]) {
      if (d && d.sourceId) latestRunBySource[d.sourceId] = d;
    }
  }

  if (loading) return <main className="shub-page"><style>{SOURCE_HUB_CSS}</style><div className="shub-wrap">Loading…</div></main>;

  const cov = data?.coverage;
  const metricsBySource = (sourceId: string) => (data?.metrics ?? []).filter((m) => m.source_id === sourceId).length;

  return (
    <main className="shub-page">
      <style>{SOURCE_HUB_CSS}</style>
      <div className="shub-wrap">
        <div className="shub-header">
          <div>
            <p className="shub-eyebrow">{companyName} · free / public external data</p>
            <h1 className="shub-title">Source Hub</h1>
            <p className="shub-sub">Free/public structured sources powering verified shocks. Works with zero API keys.</p>
          </div>
          <div className="shub-header-actions">
            <Link to="/dashboard"><button className="shub-btn">← Back to Dashboard</button></Link>
            <button className="shub-btn shub-btn-primary" onClick={runRefresh} disabled={refreshing}>
              {refreshing ? "Refreshing…" : "↻ Refresh (ingest public sources)"}
            </button>
          </div>
        </div>

        {refreshNote && <p className="shub-refresh-note">{refreshNote}</p>}

        {/* Summary */}
        <div className="shub-summary">
          <SummaryCard value={String(cov?.sourceCoverage.filter((r) => r.status === "verified" || r.status === "manual").length ?? 0)} label="Domains with structured data" />
          <SummaryCard value={String(data?.connectors.filter((c) => c.status === "live").length ?? 0)} label="Live public sources" />
          <SummaryCard value={String(data?.connectors.filter((c) => c.requiresKey && !c.configured).length ?? 0)} label="Free-key sources not configured" />
          <SummaryCard value={String(data?.metrics.length ?? 0)} label="Structured metrics" />
          <SummaryCard value={String(data?.shocks.length ?? 0)} label="Verified shocks" />
          <SummaryCard value={String(cov?.sourceCoverage.filter((r) => r.status === "scenario_only").length ?? 0)} label="Domains scenario-only" />
        </div>

        {/* Tabs */}
        <div className="shub-tabs">
          {TABS.map((t) => (
            <button key={t.key} className={`shub-tab ${tab === t.key ? "shub-tab-on" : ""}`} onClick={() => setTab(t.key)}>{t.label}</button>
          ))}
        </div>

        <div className="shub-body">
          {tab === "overview" && (
            <div className="shub-coverage">
              <h3 className="shub-h3">Source coverage by domain</h3>
              <table className="shub-table">
                <thead><tr><th>Domain</th><th>Status</th><th>Source</th><th>Latest</th><th>Used in issue</th><th>Gap</th></tr></thead>
                <tbody>
                  {cov?.sourceCoverage.map((r) => (
                    <tr key={r.domain}>
                      <td>{r.label}</td>
                      <td><span className={`shub-cov shub-cov-${r.status}`}>{r.status.replace(/_/g, " ")}</span></td>
                      <td>{r.source}</td>
                      <td>{r.latestObservation ?? "—"}</td>
                      <td>{r.usedInIssue ? "Yes" : "—"}</td>
                      <td className="shub-gap">{r.gap ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="shub-note">Paid sources not supported in free-source mode: {UNSUPPORTED_PAID_SOURCES.join(", ")}.</p>
            </div>
          )}

          {tab === "connectors" && (
            <div className="shub-connectors">
              {data?.connectors.map((c) => (
                <div key={c.sourceId} className="shub-conn-card">
                  <div className="shub-conn-top">
                    <span className="shub-conn-name">{c.name}</span>
                    <span className={statusClass(c.status)}>{c.status.replace(/_/g, " ")}</span>
                  </div>
                  <div className="shub-conn-meta">
                    <span>Access: {c.accessMode.replace(/_/g, " ")}</span>
                    <span>Trust: {c.trustTier.replace(/_/g, " ")}</span>
                    <span>Metrics stored: {metricsBySource(c.sourceId)}</span>
                  </div>
                  {c.requiresKey && (
                    <p className="shub-conn-env">Credential: <code>{c.envKeyNames.join(" / ") || "—"}</code></p>
                  )}
                  <p className="shub-conn-reason">{c.reason}</p>
                  {latestRunBySource[c.sourceId] && (
                    <div className="shub-conn-diag">
                      <span className="shub-conn-diag-line">
                        Last run: {latestRunBySource[c.sourceId].metricsFetched} fetched · {latestRunBySource[c.sourceId].metricsStored} stored · {latestRunBySource[c.sourceId].shocksCreated} shock(s)
                      </span>
                      {(latestRunBySource[c.sourceId].items ?? []).slice(0, 6).map((it) => (
                        <span key={it.id} className={`shub-conn-item shub-conn-item-${it.status}`}>
                          {it.status === "ingested" ? "✓" : it.status === "skipped" ? "–" : "✗"} {it.name}: {it.reason}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="shub-conn-actions">
                    {c.fallbackTemplate && c.fallbackTemplate !== "self" && (
                      <button className="shub-btn shub-btn-sm" onClick={() => setImportFor(TEMPLATE_TO_CATEGORY[c.fallbackTemplate!] ?? "tariff")}>Import CSV fallback</button>
                    )}
                    {c.fallbackTemplate === "self" && (
                      <button className="shub-btn shub-btn-sm" onClick={() => setImportFor("tariff")}>Import structured metric CSV</button>
                    )}
                  </div>
                  {importFor && (c.fallbackTemplate === "self" || TEMPLATE_TO_CATEGORY[c.fallbackTemplate ?? ""] === importFor) && (
                    <div className="shub-conn-import">
                      <ManualMetricImportPanel companyId={companyId} fixedCategory={importFor} onApplied={() => { setImportFor(null); void reload(); }} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {tab === "metrics" && (
            <DataTable
              rows={data?.metrics ?? []}
              empty="No structured metrics yet. Import a manual metric CSV or run an intelligence update."
              columns={[
                ["metric_name", "Metric"],
                ["driver", "Driver"],
                ["current_value", "Current"],
                ["unit", "Unit"],
                ["percent_change", "% change"],
                ["source_name", "Source"],
                ["trust_tier", "Trust"],
                ["period_end", "Period"],
              ]}
              fmt={(k, v, row) => (k === "current_value" ? fmtMoneyish(v, row.unit) : k === "trust_tier" ? String(v ?? "").replace(/_/g, " ") : v == null ? "—" : String(v))}
            />
          )}

          {tab === "shocks" && (
            <DataTable
              rows={data?.shocks ?? []}
              empty="No verified shocks yet. Import structured metrics to derive verified shocks."
              columns={[
                ["driver", "Driver"],
                ["shock_type", "Shock type"],
                ["baseline_value", "Baseline"],
                ["current_value", "Current"],
                ["percent_change", "% change"],
                ["unit", "Unit"],
                ["verification_status", "Verification"],
                ["confidence_score", "Confidence"],
              ]}
              fmt={(k, v) => (k === "verification_status" || k === "shock_type" ? String(v ?? "").replace(/_/g, " ") : v == null ? "—" : String(v))}
            />
          )}

          {tab === "claims" && (
            <DataTable
              rows={data?.claims ?? []}
              empty="No article metric claims extracted yet. Run an intelligence update."
              columns={[
                ["claim_text", "Claim"],
                ["extracted_value", "Value"],
                ["extracted_unit", "Unit"],
                ["driver", "Driver"],
                ["verification_status", "Status"],
              ]}
              fmt={(k, v) => (k === "verification_status" ? String(v ?? "").replace(/_/g, " ") : k === "claim_text" ? String(v ?? "").slice(0, 90) : v == null ? "—" : String(v))}
            />
          )}

          {tab === "imports" && (
            <div>
              <div className="shub-import-block">
                <h3 className="shub-h3">Import structured metric CSV</h3>
                <ManualMetricImportPanel companyId={companyId} onApplied={reload} />
              </div>
              <DataTable
                rows={data?.imports ?? []}
                empty="No manual imports yet."
                columns={[
                  ["category", "Category"],
                  ["file_name", "File"],
                  ["row_count", "Rows"],
                  ["duplicate_row_count", "Updated"],
                  ["status", "Status"],
                ]}
                fmt={(_k, v) => (v == null ? "—" : String(v))}
              />
            </div>
          )}

          {tab === "runs" && (
            <DataTable
              rows={data?.runs ?? []}
              empty="No source fusion runs yet. Run an intelligence update."
              columns={[
                ["run_status", "Status"],
                ["metrics_ingested", "Metrics"],
                ["shocks_verified", "Shocks"],
                ["claims_verified", "Claims verified"],
                ["claims_rejected", "Claims rejected"],
                ["created_at", "When"],
              ]}
              fmt={(k, v) => (k === "created_at" && v ? new Date(String(v)).toLocaleString() : v == null ? "—" : String(v))}
            />
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

function DataTable({
  rows,
  columns,
  empty,
  fmt,
}: {
  rows: Record<string, unknown>[];
  columns: [string, string][];
  empty: string;
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
