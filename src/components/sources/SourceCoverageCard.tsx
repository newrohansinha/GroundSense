import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { loadConnectors } from "../../services/sources/sourceHubData";
import { produceSourceFusionSummary } from "../../services/sources/sourceFusionService";
import type { SourceCoverageRow, SourceFusionSummary } from "../../services/sources/types";

type Props = { companyId: string | null };

export default function SourceCoverageCard({ companyId }: Props) {
  const [summary, setSummary] = useState<SourceFusionSummary | null>(null);
  const [shockCount, setShockCount] = useState(0);

  useEffect(() => {
    let active = true;
    if (!companyId) return;
    (async () => {
      try {
        const [s, shocks] = await Promise.all([
          produceSourceFusionSummary(companyId),
          supabase.from("verified_shocks").select("id", { count: "exact", head: true }).eq("company_id", companyId),
        ]);
        if (!active) return;
        setSummary(s);
        setShockCount(shocks.count ?? 0);
      } catch {
        if (active) setSummary({ sourcesChecked: loadConnectors(), metricsIngested: 0, claimsExtracted: 0, claimsVerified: 0, claimsRejected: 0, verifiedShocks: 0, conflicts: 0, sourceCoverage: [] });
      }
    })();
    return () => { active = false; };
  }, [companyId]);

  // Use adapter connector statuses (reflects actual env config, e.g. SEC needs a User-Agent).
  const connectors = loadConnectors();
  const livePublic = connectors.filter((c) => c.accessMode === "live_public_no_key" && c.status === "live").length;
  const manualMetrics = summary?.metricsIngested ?? 0;

  return (
    <section className="scc">
      <style>{CSS}</style>
      <div className="scc-head">
        <div>
          <p className="scc-eyebrow">Company-evaluated evidence + available public sources</p>
          <h2 className="scc-title">Source Coverage</h2>
        </div>
        <Link to="/sources"><button className="scc-btn scc-btn-primary">Open Source Hub →</button></Link>
      </div>

      <div className="scc-stats">
        <Stat value={String(shockCount)} label="Company-evaluated signals" tone="good" />
        <Stat value={String(manualMetrics)} label="Structured metrics available" />
        <Stat value={String(livePublic)} label="Public source connectors" />
        <Stat value="GDELT · World Bank" label="Context-only connectors" />
      </div>

      <div className="scc-rows">
        {(summary?.sourceCoverage ?? []).slice(0, 4).map((r) => (
          <CoverageRow key={r.domain} row={r} />
        ))}
        {(summary?.sourceCoverage ?? []).length > 4 && (
          <Link to="/sources" className="scc-more">
            View all {(summary?.sourceCoverage ?? []).length} sources in Source Hub →
          </Link>
        )}
      </div>
    </section>
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

function CoverageRow({ row }: { row: SourceCoverageRow }) {
  return (
    <div className="scc-row">
      <span className="scc-row-domain">{row.label}</span>
      <span className={`scc-row-status scc-status-${row.status}`}>{row.status.replace(/_/g, " ")}</span>
      <span className="scc-row-source">{row.source}</span>
      {row.gap ? <span className="scc-row-gap">{row.gap}</span> : <span className="scc-row-gap scc-row-ok">covered</span>}
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
.scc-more { display: inline-block; margin-top: 6px; font-size: 12.5px; font-weight: 600; color: var(--accent); text-decoration: none; }
.scc-more:hover { text-decoration: underline; }
.scc-stat { background: var(--bg-surface-muted); border: 1px solid var(--border-subtle); border-radius: 10px; padding: 10px 12px; display: flex; flex-direction: column; gap: 3px; }
.scc-stat-value { font-size: 20px; font-weight: 750; }
.scc-stat-label { font-size: 11px; color: var(--text-muted); }
.scc-tone-good { color: var(--success); }
.scc-tone-warn { color: var(--accent-hover); }
.scc-rows { display: flex; flex-direction: column; gap: 4px; }
.scc-row { display: grid; grid-template-columns: 150px 130px 200px 1fr; gap: 10px; align-items: center; padding: 7px 10px; border: 1px solid var(--bg-surface-muted); border-radius: 8px; background: var(--bg-surface-muted); font-size: 12.5px; }
.scc-row-domain { font-weight: 650; }
.scc-row-status { font-size: 11px; font-weight: 650; padding: 2px 8px; border-radius: 999px; text-transform: capitalize; text-align: center; white-space: nowrap; }
.scc-status-verified { background: var(--success-bg); color: var(--success); }
.scc-status-manual { background: var(--support-bg); color: var(--support); }
.scc-status-support { background: var(--support-bg); color: var(--support); }
.scc-status-context { background: var(--support-bg); color: var(--support); }
.scc-status-article_only { background: var(--accent-muted); color: var(--accent-hover); }
.scc-status-scenario_only { background: var(--bg-surface-muted); color: var(--warning); }
.scc-status-not_configured { background: var(--danger-bg); color: var(--danger); }
.scc-status-needs_user_agent { background: var(--accent-muted); color: var(--accent-hover); }
.scc-row-source { color: var(--text-secondary); }
.scc-row-gap { color: var(--text-muted); font-style: italic; }
.scc-row-ok { color: var(--success); font-style: normal; }
@media (max-width: 900px) { .scc-stats { grid-template-columns: repeat(3, 1fr); } .scc-row { grid-template-columns: 1fr 1fr; } }
`;
