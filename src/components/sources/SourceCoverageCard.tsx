import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { canViewSourceAudit } from "../../services/companyService";

type Props = { companyId: string | null };

// Source Gap / Numeric Coverage panel (Phase 10). Reads the SERVER-side
// source_health_v + numeric_shocks ledger (populated by the refresh-sources
// connector layer) — never the browser-only adapters. Answers: which sources are
// configured, which drivers have numeric shocks, what's publishable, which APIs
// failed, and how many article claims were extracted.

type HealthRow = {
  source_key: string;
  source_name: string | null;
  configured: boolean;
  key_present: boolean;
  numeric_shocks_created: number;
  publishable_shocks: number;
  latest_period: string | null;
  freshness_level: string | null;
  last_error: string | null;
};

type DriverRow = { driver_category: string; rows: number; publishable: number };

// Executive UI shows a human month, never a raw ISO date (raw stays in Raw Source Audit).
function friendlyMonth(period: string | null): string {
  if (!period) return "";
  const d = new Date(period.length === 10 ? `${period}T00:00:00` : period);
  if (Number.isNaN(d.getTime())) return period;
  return /-01$/.test(period)
    ? d.toLocaleDateString("en-US", { month: "long", year: "numeric" })
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
// A present key is "invalid" when the connector surfaced a credential error.
function keyInvalid(h: HealthRow): boolean {
  return h.key_present && /key/i.test(String(h.last_error ?? ""));
}

export default function SourceCoverageCard({ companyId }: Props) {
  const [health, setHealth] = useState<HealthRow[]>([]);
  const [drivers, setDrivers] = useState<DriverRow[]>([]);
  const [publishable, setPublishable] = useState(0);
  const [totalShocks, setTotalShocks] = useState(0);
  const [articleClaims, setArticleClaims] = useState(0);
  const [articleCorroborated, setArticleCorroborated] = useState(0);
  const [articlePrimary, setArticlePrimary] = useState(0);
  const [articleWatchlist, setArticleWatchlist] = useState(0);
  const [publishedCount, setPublishedCount] = useState(0);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [h, shocks, claims, register] = await Promise.all([
          supabase.from("source_health_v").select("*").order("source_key"),
          supabase.from("numeric_shocks").select("driver_category, can_publish, source_type"),
          companyId
            ? supabase.from("numeric_shocks").select("corroboration_status").eq("source_type", "article_numeric_claim").eq("company_id", companyId)
            : Promise.resolve({ data: [] as any[] }),
          companyId
            ? supabase.from("risk_register").select("numeric_basis_type, gate_status").eq("company_id", companyId)
            : Promise.resolve({ data: [] as any[] }),
        ]);
        if (!active) return;
        setHealth((h.data as HealthRow[]) ?? []);
        const rows = (shocks.data as any[]) ?? [];
        const official = rows.filter((r) => r.source_type === "official_structured_metric");
        setTotalShocks(official.length);
        setPublishable(official.filter((r) => r.can_publish).length);
        const byDriver = new Map<string, DriverRow>();
        for (const r of official) {
          const k = r.driver_category || "context";
          const d = byDriver.get(k) ?? { driver_category: k, rows: 0, publishable: 0 };
          d.rows++; if (r.can_publish) d.publishable++;
          byDriver.set(k, d);
        }
        setDrivers([...byDriver.values()].sort((a, b) => b.publishable - a.publishable));
        const cl = (claims.data as any[]) ?? [];
        setArticleClaims(cl.length);
        setArticleCorroborated(cl.filter((c) => c.corroboration_status === "corroborated" || c.corroboration_status === "directionally_supported").length);
        const reg = (register.data as any[]) ?? [];
        const articleRows = reg.filter((r) => r.numeric_basis_type === "article_numeric_claim");
        setArticlePrimary(articleRows.filter((r) => r.gate_status === "published").length);
        setArticleWatchlist(articleRows.filter((r) => r.gate_status !== "published").length);
        setPublishedCount(reg.filter((r) => r.gate_status === "published").length);
      } catch {
        if (active) { setHealth([]); setDrivers([]); }
      }
    })();
    return () => { active = false; };
  }, [companyId]);

  const configured = health.filter((h) => h.key_present).length;
  const invalidKeys = health.filter((h) => keyInvalid(h)).length;
  const validKeys = configured - invalidKeys;
  const failing = health.filter((h) => h.last_error);

  // Buyer-facing executive summary derivations (raw connector health is operator-only).
  const audit = canViewSourceAudit();
  const monitoredSources = health
    .filter((h) => !h.last_error && !/bls|eia/i.test(h.source_key))
    .map((h) => (h.source_name || h.source_key).toUpperCase())
    .filter((v, i, a) => a.indexOf(v) === i);
  const notPublished = Math.max(0, publishable - publishedCount);

  return (
    <section className="scc">
      <style>{CSS}</style>
      <div className="scc-head">
        <div>
          <p className="scc-eyebrow">Which official sources back the published estimates</p>
          <h2 className="scc-title">{audit ? "Source Audit" : "Evidence Coverage"}</h2>
        </div>
        <Link to="/sources"><button className="scc-btn scc-btn-primary">{audit ? "Open Source Audit →" : "Open Evidence Sources →"}</button></Link>
      </div>

      {/* ── Buyer executive summary (default). Raw connector diagnostics are operator-only. ── */}
      {!audit && (
        <>
          {/* Compact stats only — the "why not every move is published" detail lives in the
              tooltip below, not a bulky paragraph. */}
          <div className="scc-stats">
            <Stat value={String(publishedCount)} label="Published issues" tone="good" />
            <Stat value={String(publishable)} label="Official metric moves" />
            <Stat value={String(publishedCount)} label="Mapped to exposure" />
            <Stat value={String(notPublished)} label="Monitored, not published" />
          </div>
          <p
            className="scc-summary scc-summary-muted"
            title={`Official BLS/EIA metrics back the published issues.${monitoredSources.length > 0 ? ` Also monitored: ${monitoredSources.join(", ")}.` : ""} Not every official metric move becomes an issue; publication requires a distinct exposure base, formula, and owner action.`}
          >
            Official BLS/EIA metrics back the published estimates. <span aria-hidden="true" style={{ cursor: "help", opacity: 0.7 }}>ⓘ</span>
          </p>
        </>
      )}

      {/* ── Operator source audit (full connector health, drivers, article funnel). ── */}
      {audit && (
        <>
          <div className="scc-stats">
            <Stat value={String(publishable)} label="Publishable numeric shocks" tone="good" />
            <Stat value={String(totalShocks)} label="Total official shocks" />
            <Stat value={`${configured}/${health.length || 6}`} label={`keys present · ${validKeys} valid · ${invalidKeys} invalid`} tone={invalidKeys > 0 ? "warn" : undefined} />
            <Stat value={`${articleCorroborated}/${articleClaims}`} label="Article claims corroborated" tone={articleClaims ? undefined : "warn"} />
          </div>

          {/* Per-source health */}
          <div className="scc-rows">
            {health.map((h) => (
              <div className="scc-row" key={h.source_key}>
                <span className="scc-row-domain">{(h.source_name || h.source_key).toUpperCase()}</span>
                <span className={`scc-row-status scc-status-${h.last_error ? "not_configured" : h.publishable_shocks > 0 ? "verified" : h.key_present ? "context" : "scenario_only"}`}>
                  {h.last_error ? "error" : h.publishable_shocks > 0 ? "live" : h.key_present ? "configured" : "no key"}
                </span>
                <span className="scc-row-source">
                  {h.numeric_shocks_created} shocks · {h.publishable_shocks} publishable{h.latest_period ? ` · ${friendlyMonth(h.latest_period)}` : ""}
                </span>
                <span className={`scc-row-gap${h.last_error ? "" : " scc-row-ok"}`}>
                  {h.last_error ? h.last_error : h.freshness_level ?? "covered"}
                </span>
              </div>
            ))}
            {health.length === 0 && <div className="scc-row"><span className="scc-row-gap">No source_health rows yet — run intelligence to populate the numeric ledger.</span></div>}
          </div>

          {/* Exposure-driver coverage */}
          {drivers.length > 0 && (
            <div className="scc-drivers">
              {drivers.map((d) => (
                <span key={d.driver_category} className={`scc-driver${d.publishable > 0 ? " scc-driver-on" : ""}`}>
                  {d.driver_category}: {d.publishable}/{d.rows}
                </span>
              ))}
            </div>
          )}

          {/* Article usage funnel — articles are SECONDARY intelligence, never a silent primary basis. */}
          <div className="scc-funnel">
            <p className="scc-funnel-head">Article usage funnel</p>
            <div className="scc-funnel-rows">
              <FunnelRow label="Articles fetched" value="unavailable" />
              <FunnelRow label="Normalized" value="unavailable" />
              <FunnelRow label="Numeric claims extracted" value={String(articleClaims)} />
              <FunnelRow label="Corroborated (quality subset)" value={String(articleCorroborated)} />
              <FunnelRow label="Used as primary published basis" value={String(articlePrimary)} strong />
              <FunnelRow label="Used as supporting signal" value="unavailable" />
              <FunnelRow label="Used in watchlist / context" value={String(articleWatchlist)} />
              <FunnelRow label="Rejected / not used" value={String(Math.max(0, articleClaims - articlePrimary - articleWatchlist))} />
            </div>
            <p className="scc-funnel-note">
              Extracted claims = primary published + watchlist/context + rejected. Corroborated is a quality
              subset of extracted (not a separate stage); fetched, normalized, and supporting-signal counts are
              not yet instrumented and show as <em>unavailable</em>. Articles are secondary intelligence:{" "}
              {articlePrimary} primary published estimates. Corroborated claims may still be unused unless they
              map to a company exposure base and formula.
            </p>
          </div>

          {failing.length > 0 && (
            <p className="scc-foot">⚠ {failing.length} source(s) configured but failing: {failing.map((f) => f.source_key).join(", ")} — see errors above. Article claims extracted: {articleClaims}.</p>
          )}
        </>
      )}
    </section>
  );
}

function FunnelRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  const unavailable = value === "unavailable";
  return (
    <div className="scc-funnel-row">
      <span className="scc-funnel-label">{label}</span>
      <span className={`scc-funnel-value${strong ? " scc-funnel-strong" : ""}${unavailable ? " scc-funnel-na" : ""}`}>{value}</span>
    </div>
  );
}

function Stat({ value, label, tone }: { value: string; label: string; tone?: "good" | "warn" }) {
  return (
    <div className="scc-stat">
      <span className={`scc-stat-value${tone ? ` scc-tone-${tone}` : ""}`}>{value}</span>
      <span className="scc-stat-label">{label}</span>
    </div>
  );
}

const CSS = `
.scc { font-family: Inter, ui-sans-serif, system-ui, -apple-system, sans-serif; background: var(--bg-surface); border: 1px solid var(--border-default); border-radius: 18px; padding: 20px; margin-bottom: 18px; color: var(--text-primary); }
.scc-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 14px; }
.scc-eyebrow { margin: 0 0 2px; font-size: 11px; font-weight: 700; letter-spacing: 0.07em; text-transform: uppercase; color: var(--accent-hover); }
.scc-title { margin: 0; font-size: 18px; font-weight: 700; }
.scc-btn { font-size: 13px; font-weight: 600; padding: 8px 14px; border-radius: 8px; border: 1px solid var(--accent-hover); background: var(--accent-hover); color: var(--text-inverse); cursor: pointer; }
.scc-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 14px; }
.scc-stat { background: var(--bg-surface-muted); border: 1px solid var(--border-subtle); border-radius: 10px; padding: 10px 12px; display: flex; flex-direction: column; gap: 3px; }
.scc-stat-value { font-size: 20px; font-weight: 750; }
.scc-stat-label { font-size: 11px; color: var(--text-muted); }
.scc-tone-good { color: var(--success); }
.scc-tone-warn { color: var(--warning); }
.scc-rows { display: flex; flex-direction: column; gap: 4px; }
.scc-row { display: grid; grid-template-columns: 120px 100px 230px 1fr; gap: 10px; align-items: center; padding: 7px 10px; border: 1px solid var(--bg-surface-muted); border-radius: 8px; background: var(--bg-surface-muted); font-size: 12.5px; }
.scc-row-domain { font-weight: 650; }
.scc-row-status { font-size: 11px; font-weight: 650; padding: 2px 8px; border-radius: 999px; text-transform: capitalize; text-align: center; white-space: nowrap; }
.scc-status-verified { background: var(--success-bg); color: var(--success); }
.scc-status-context { background: var(--support-bg); color: var(--support); }
.scc-status-scenario_only { background: var(--bg-surface-muted); color: var(--warning); }
.scc-status-not_configured { background: var(--danger-bg); color: var(--danger); }
.scc-row-source { color: var(--text-secondary); }
.scc-row-gap { color: var(--text-muted); font-style: italic; }
.scc-row-ok { color: var(--success); font-style: normal; }
.scc-drivers { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; }
.scc-driver { font-size: 11.5px; font-weight: 600; padding: 3px 9px; border-radius: 999px; background: var(--bg-surface-muted); color: var(--text-muted); border: 1px solid var(--border-subtle); text-transform: capitalize; }
.scc-driver-on { background: var(--success-bg); color: var(--success); border-color: var(--success); }
.scc-funnel { margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--border-subtle); }
.scc-funnel-head { margin: 0 0 8px; font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-muted); }
.scc-funnel-rows { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 6px 16px; }
.scc-funnel-row { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; padding: 4px 0; border-bottom: 1px solid var(--bg-surface-muted); }
.scc-funnel-label { font-size: 12px; color: var(--text-secondary); }
.scc-funnel-value { font-size: 13px; font-weight: 700; color: var(--text-primary); }
.scc-funnel-strong { color: var(--accent-hover); }
.scc-funnel-na { font-weight: 600; font-style: italic; color: var(--text-faint); }
.scc-funnel-note { margin: 10px 0 0; font-size: 12px; color: var(--text-muted); line-height: 1.5; }
.scc-summary { margin: 0 0 8px; font-size: 13.5px; line-height: 1.55; color: var(--text-secondary); }
.scc-summary-muted { color: var(--text-muted); font-size: 12.5px; }
.scc-foot { margin: 12px 0 0; font-size: 12px; color: var(--warning); }
@media (max-width: 900px) { .scc-stats { grid-template-columns: repeat(2, 1fr); } .scc-row { grid-template-columns: 1fr 1fr; } }
`;
