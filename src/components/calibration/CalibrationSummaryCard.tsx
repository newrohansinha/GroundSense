import { useState } from "react";
import { Link } from "react-router-dom";
import type { UseCalibrationWorkbench } from "../../services/calibration/useCalibrationWorkbench";
import type { DomainKey } from "../../services/calibration/types";

type Props = {
  controller: UseCalibrationWorkbench;
  // Published-issue coverage and watchlist blockers are tracked separately from
  // all-model calibration coverage so the card never says "0 blocked" while
  // watchlist items are blocked by missing data.
  publishedCount?: number;
  watchlistBlocked?: number;
  // DB-backed company coverage (company_calibration_coverage). Distinct from the
  // local browser workbench — shown as its own labeled row, never conflated.
  dbCoverage?: { coverage_pct: number; domains_populated: number; domains_total: number } | null;
};

// Domains surfaced as chips on the dashboard (the ones that map to live issues).
const CHIP_DOMAINS: { key: DomainKey; label: string }[] = [
  { key: "freight", label: "Freight" },
  { key: "supplier", label: "Supplier" },
  { key: "crm", label: "CRM" },
  { key: "financial", label: "Financial" },
  { key: "outcomes", label: "Outcomes" },
];

function reliabilityTone(score: number): string {
  if (score >= 55) return "high";
  if (score >= 25) return "mid";
  if (score > 0) return "low";
  return "none";
}

export default function CalibrationSummaryCard({ controller, publishedCount = 0, watchlistBlocked = 0, dbCoverage = null }: Props) {
  const { workbench, state } = controller;
  const { summary, domainScores } = workbench;
  const scoreByDomain = (k: DomainKey) => domainScores.find((d) => d.domain === k);
  const [showDetails, setShowDetails] = useState(false);

  // Which live-issue domains are still completely inferred (no rows)?
  const inferredDomains: string[] = [];
  if ((state.domains.freight?.rows.length ?? 0) === 0) inferredDomains.push("Freight risk still uses inferred spend and spot exposure");
  if ((state.domains.supplier?.rows.length ?? 0) === 0) inferredDomains.push("Tariff / steel exposure still uses inferred supplier assumptions");

  return (
    <section className="gs-calsum">
      <style>{CSS}</style>
      <div className="gs-calsum-head">
        <div>
          <p className="gs-calsum-eyebrow">Calibration coverage by source — published issues, company DB, and local workbench shown separately</p>
          <h2 className="gs-calsum-title">Calibration Summary</h2>
        </div>
        <span className="gs-calsum-persist gs-calsum-persist-local">Local editing: browser workbench</span>
      </div>

      {/* Buyer-facing trust stats only — DB-backed, company-wide. The browser-local
          workbench numbers are intentionally NOT here; they live behind the toggle so a
          localStorage import score never reads like an executive KPI. */}
      <div className="gs-calsum-stats">
        <Stat value={`${publishedCount}/${publishedCount}`} label="Published issue coverage" tone={publishedCount > 0 ? "high" : undefined} />
        {dbCoverage
          ? <Stat value={`${dbCoverage.coverage_pct}%`} label={`DB/company calibration coverage · ${dbCoverage.domains_populated}/${dbCoverage.domains_total} domains`} tone={reliabilityTone(dbCoverage.coverage_pct)} />
          : <Stat value="n/a" label="DB/company calibration coverage · not loaded" />}
        <Stat value={String(watchlistBlocked)} label="Watchlist blocked by missing data" tone={watchlistBlocked > 0 ? "mid" : undefined} />
      </div>

      <button className="gs-calsum-details-toggle" onClick={() => setShowDetails((v) => !v)}>
        {showDetails ? "▲ Hide local workbench & per-domain detail" : "▼ Show local workbench & per-domain detail"}
      </button>

      {showDetails && (
      <>
      <p className="gs-calsum-eyebrow" style={{ marginBottom: 6 }}>Local browser workbench — not company-wide truth</p>
      <div className="gs-calsum-stats">
        <Stat value={(summary.inputsCalibrated > 0 || summary.modelReliability > 0) ? `${summary.modelReliability}%` : "n/a"} label="Local workbench coverage (this browser only)" tone={reliabilityTone(summary.modelReliability)} />
        <Stat value={String(summary.inferredAssumptions)} label="Inferred remaining (local)" />
        <Stat value={String(summary.estimatesImproved)} label="Estimates improved" />
      </div>
      <div className="gs-calsum-chips">
        {CHIP_DOMAINS.map(({ key, label }) => {
          const d = scoreByDomain(key);
          const score = d?.score ?? 0;
          return (
            <span key={key} className={`gs-calsum-chip gs-calsum-chip-${reliabilityTone(score)}`}>
              <span className="gs-calsum-chip-label">{label}</span>
              <span className="gs-calsum-chip-status">{d?.reliabilityLabel ?? "Inferred only"} · {score}%</span>
            </span>
          );
        })}
      </div>

      {inferredDomains.length > 0 && (
        <div className="gs-calsum-inferred">
          {inferredDomains.map((line, i) => (
            <p key={i} className="gs-calsum-inferred-line">⚠ {line}.</p>
          ))}
          <p className="gs-calsum-inferred-action">
            Recommended next action: upload freight and supplier data in the Calibration Center to ground these ranges.
          </p>
        </div>
      )}
      </>
      )}

      <div className="gs-calsum-actions">
        <Link to="/calibration"><button className="gs-calsum-btn gs-calsum-btn-primary">Open Calibration Center →</button></Link>
        <Link to="/calibration"><button className="gs-calsum-btn">Upload data</button></Link>
        <Link to="/calibration"><button className="gs-calsum-btn">View assumption inventory</button></Link>
      </div>
    </section>
  );
}

function Stat({ value, label, tone }: { value: string; label: string; tone?: string }) {
  return (
    <div className="gs-calsum-stat">
      <span className={`gs-calsum-stat-value${tone ? ` gs-calsum-tone-${tone}` : ""}`}>{value}</span>
      <span className="gs-calsum-stat-label">{label}</span>
    </div>
  );
}

const CSS = `
.gs-calsum {
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, sans-serif;
  background: var(--bg-surface);
  border: 1px solid var(--border-default);
  border-radius: 18px;
  padding: 20px;
  margin-bottom: 18px;
  color: var(--text-primary);
}
.gs-calsum * { box-sizing: border-box; }
.gs-calsum-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 16px; }
.gs-calsum-eyebrow { margin: 0 0 2px; font-size: 11px; font-weight: 700; letter-spacing: 0.07em; text-transform: uppercase; color: var(--accent-hover); }
.gs-calsum-title { margin: 0; font-size: 18px; font-weight: 700; letter-spacing: -0.02em; }
.gs-calsum-persist { font-size: 12px; font-weight: 650; padding: 4px 10px; border-radius: 999px; white-space: nowrap; }
.gs-calsum-persist-supabase { background: var(--success-bg); color: var(--success); }
.gs-calsum-persist-local { background: var(--bg-surface-muted); color: var(--warning); }
.gs-calsum-stats { display: grid; grid-template-columns: repeat(6, 1fr); gap: 10px; margin-bottom: 16px; }
.gs-calsum-stat { background: var(--bg-surface-muted); border: 1px solid var(--border-subtle); border-radius: 10px; padding: 10px 12px; display: flex; flex-direction: column; gap: 3px; }
.gs-calsum-stat-value { font-size: 20px; font-weight: 750; letter-spacing: -0.02em; }
.gs-calsum-stat-label { font-size: 11px; color: var(--text-muted); }
.gs-calsum-tone-high { color: var(--success); }
.gs-calsum-tone-mid { color: var(--warning); }
.gs-calsum-tone-low { color: var(--accent-hover); }
.gs-calsum-tone-none { color: var(--danger); }
.gs-calsum-details-toggle { background: none; border: none; color: var(--accent-hover); font-size: 12px; font-weight: 650; cursor: pointer; padding: 0 0 10px; }
.gs-calsum-chips { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 14px; }
.gs-calsum-chip { display: inline-flex; flex-direction: column; gap: 1px; padding: 6px 12px; border-radius: 10px; border: 1px solid var(--border-subtle); background: var(--bg-surface-muted); }
.gs-calsum-chip-label { font-size: 12px; font-weight: 700; }
.gs-calsum-chip-status { font-size: 11px; color: var(--text-muted); }
.gs-calsum-chip-high { border-color: var(--success-border); background: var(--success-bg); }
.gs-calsum-chip-mid { border-color: var(--warning-border); background: var(--bg-surface-muted); }
.gs-calsum-chip-low { border-color: var(--warning-border); background: var(--accent-muted); }
.gs-calsum-chip-none { border-color: var(--danger-border); background: var(--danger-bg); }
.gs-calsum-inferred { background: var(--accent-muted); border: 1px solid var(--warning-border); border-radius: 10px; padding: 10px 14px; margin-bottom: 14px; }
.gs-calsum-inferred-line { margin: 0 0 4px; font-size: 13px; color: var(--accent-hover); }
.gs-calsum-inferred-action { margin: 4px 0 0; font-size: 12px; color: var(--text-muted); }
.gs-calsum-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.gs-calsum-btn { font-size: 13px; font-weight: 600; padding: 8px 14px; border-radius: 8px; cursor: pointer; border: 1px solid var(--border-default); background: var(--bg-surface); color: var(--text-primary); }
.gs-calsum-btn-primary { background: var(--accent-hover); border-color: var(--accent-hover); color: var(--text-inverse); }
@media (max-width: 900px) { .gs-calsum-stats { grid-template-columns: repeat(3, 1fr); } }
`;
