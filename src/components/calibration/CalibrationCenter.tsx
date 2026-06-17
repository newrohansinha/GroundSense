import { useState } from "react";
import type { DomainKey } from "../../services/calibration/types";
import { CALIBRATION_DOMAINS } from "../../services/calibration/calibrationDomains";
import type { UseCalibrationWorkbench } from "../../services/calibration/useCalibrationWorkbench";
import { getCalibrationActivityLog } from "../../services/calibration/calibrationActivityService";
import CalibrationDomainTab from "./CalibrationDomainTab";
import AssumptionInventory from "./AssumptionInventory";
import { CALIBRATION_CENTER_CSS } from "./calibrationCenterStyles";

type TabKey = DomainKey | "overview" | "assumptions" | "activity";

type CalibrationCenterProps = {
  controller: UseCalibrationWorkbench;
};

const TABS: { key: TabKey; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "freight", label: "Freight & Logistics" },
  { key: "supplier", label: "Supplier / Procurement" },
  { key: "crm", label: "Customer / CRM" },
  { key: "financial", label: "Financial Anchors" },
  { key: "inventory", label: "Inventory & Service" },
  { key: "competitive", label: "Competitive / Win-Loss" },
  { key: "outcomes", label: "Outcomes & Accuracy" },
  { key: "assumptions", label: "Assumptions" },
  { key: "activity", label: "Imports / Activity" },
];

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return iso;
  }
}

export default function CalibrationCenter({ controller }: CalibrationCenterProps) {
  const [tab, setTab] = useState<TabKey>("overview");
  const { state, workbench, applyDomainRows, resetDomain, setAssumption, resetAssumption, persistence } = controller;

  const { summary, domainScores, assumptions, impacts, roadmap, dependencies } = workbench;
  const scoreByDomain = (k: DomainKey) => domainScores.find((d) => d.domain === k)!;

  function goToDomain(domain: DomainKey) {
    setTab(domain);
  }

  return (
    <section className="cc-root">
      <style>{CALIBRATION_CENTER_CSS}</style>

      <div className="cc-header">
        <div>
          <p className="cc-eyebrow">Company operating model workbench</p>
          <h2 className="cc-title">Calibration Center</h2>
          <p className="cc-subtitle">Replace inferred assumptions with company-specific operating data.</p>
          <p className="cc-blurb">
            GroundSense uses calibration data to tighten exposure estimates, improve forecast reliability,
            and explain which internal data would change each decision.
          </p>
        </div>
        <span className={`cc-persistence cc-persistence-${persistence}`}>
          {persistence === "supabase" ? "Persisted to database" : "Demo session — saved locally"}
        </span>
      </div>

      {/* Summary row */}
      <div className="cc-summary-row">
        <SummaryCard value={`${summary.modelReliability}%`} label="Model Reliability" sub={`${summary.inputsCalibrated} of ${summary.inputsRequired} required inputs calibrated`} tone="primary" />
        <SummaryCard value={String(summary.inferredAssumptions)} label="Inferred Assumptions" sub="Values still based on benchmarks or demo assumptions" tone="warn" />
        <SummaryCard value={String(summary.importedDataSources)} label="Imported Data Sources" sub={summary.importedDataSources === 0 ? "No CSV/API sources connected" : "CSV / manual sources connected"} tone="neutral" />
        <SummaryCard value={String(summary.estimatesImproved)} label="Estimates Improved" sub={summary.estimatesImproved === 0 ? "Upload data to update exposure estimates" : "Exposure estimates recalculated from company data"} tone="good" />
        <SummaryCard value={String(summary.blockedByMissingData)} label="Blocked by Missing Data" sub="Candidates needing CRM/supplier/freight validation" tone="warn" />
      </div>

      {/* Tabs */}
      <div className="cc-tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={`cc-tab ${tab === t.key ? "cc-tab-on" : ""}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="cc-tab-body">
        {tab === "overview" && (
          <div className="cc-overview">
            {/* A. Model health by domain */}
            <div className="cc-overview-block">
              <h4 className="cc-block-title">Model health by domain</h4>
              <div className="cc-health-grid">
                {domainScores.filter((d) => d.domain !== "outcomes").map((d) => (
                  <div key={d.domain} className="cc-health-card">
                    <div className="cc-health-top">
                      <span className="cc-health-name">{d.label}</span>
                      <span className={`cc-health-pct ${d.score >= 55 ? "cc-rel-high" : d.score >= 25 ? "cc-rel-mid" : "cc-rel-low"}`}>{d.score}%</span>
                    </div>
                    <div className="cc-health-bar"><div className="cc-health-bar-fill" style={{ transform: `scaleX(${Math.max(d.score, 2) / 100})` }} /></div>
                    <p className="cc-health-rel">{d.reliabilityLabel}</p>
                    <p className="cc-health-basis">{d.basis}</p>
                    {d.missingInputs.length > 0 && (
                      <p className="cc-health-missing">Missing: {d.missingInputs.slice(0, 3).join(" · ")}</p>
                    )}
                    <p className="cc-health-affects">Affects: {d.affects.slice(0, 2).join(" · ")}</p>
                    <button className="cc-btn cc-btn-ghost cc-health-btn" onClick={() => goToDomain(d.domain)}>
                      {d.nextBestAction} →
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* B. Roadmap */}
            <div className="cc-overview-block">
              <h4 className="cc-block-title">Calibration roadmap</h4>
              <div className="cc-roadmap">
                {roadmap.map((item) => (
                  <div key={item.rank} className={`cc-roadmap-item ${item.done ? "cc-roadmap-done" : ""}`}>
                    <span className="cc-roadmap-rank">{item.done ? "✓" : item.rank}</span>
                    <div className="cc-roadmap-main">
                      <div className="cc-roadmap-line">
                        <span className="cc-roadmap-title">{item.title}</span>
                        <span className={`cc-impact-badge cc-impact-${item.impactLevel.toLowerCase()}`}>{item.impactLevel} impact</span>
                      </div>
                      <p className="cc-roadmap-detail">
                        <strong>Affects:</strong> {item.affectedIssue} · <strong>Needs:</strong> {item.requiredData}
                      </p>
                      <p className="cc-roadmap-improve">{item.estimatedImprovement}</p>
                    </div>
                    {!item.done && (
                      <button className="cc-btn cc-btn-text" onClick={() => goToDomain(item.domain)}>Open →</button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* C. Issue dependency map */}
            <div className="cc-overview-block">
              <h4 className="cc-block-title">Current issue dependency map</h4>
              <div className="cc-deps">
                {dependencies.map((dep) => (
                  <div key={dep.issue} className="cc-dep">
                    <div className="cc-dep-head">
                      <span className="cc-dep-issue">{dep.issue}</span>
                      <span className="cc-dep-rel">{dep.reliability}</span>
                    </div>
                    {dep.missingData.length > 0 ? (
                      <p className="cc-dep-missing">Missing: {dep.missingData.join(" · ")}</p>
                    ) : (
                      <p className="cc-dep-ok">Calibration data present.</p>
                    )}
                    <button className="cc-btn cc-btn-text" onClick={() => goToDomain(dep.domain)}>
                      {dep.calibrationNeeded} →
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {CALIBRATION_DOMAINS.some((d) => d.key === tab) && (
          <CalibrationDomainTab
            domain={tab as DomainKey}
            score={scoreByDomain(tab as DomainKey)}
            impact={impacts[tab as DomainKey]}
            rows={state.domains[tab as DomainKey].rows}
            onApply={(rows, sourceType, sourceName) =>
              applyDomainRows(tab as DomainKey, rows, sourceType, sourceName)
            }
            onReset={() => resetDomain(tab as DomainKey)}
          />
        )}

        {tab === "assumptions" && (
          <AssumptionInventory
            rows={assumptions}
            onReplace={(key, value) => setAssumption(key, value, "Manual")}
            onApprove={(key, value) => setAssumption(key, value, "Approved")}
            onReset={(key) => resetAssumption(key)}
          />
        )}

        {tab === "activity" && (
          <div className="cc-activity">
            <h4 className="cc-domain-title">Imports & calibration activity</h4>
            <p className="cc-domain-blurb">Every calibration change is logged here. Persistence: {persistence === "supabase" ? "database" : "local demo session"}.</p>
            {state.runs.length === 0 ? (
              <p className="cc-empty">No calibration activity yet. Upload a CSV or add data manually to begin.</p>
            ) : (
              <div className="cc-activity-list">
                {getCalibrationActivityLog(state).map((run) => (
                  <div key={run.id} className="cc-activity-item">
                    <div className="cc-activity-top">
                      <span className="cc-activity-domain">{run.domainLabel}</span>
                      <span className="cc-activity-date">{fmtDate(run.createdAt)}</span>
                    </div>
                    <p className="cc-activity-note">{run.notes}</p>
                    <p className="cc-activity-scores">
                      Reliability {run.beforeScore}% → <strong>{run.afterScore}%</strong> · +{run.inputsAdded} input{run.inputsAdded === 1 ? "" : "s"}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function SummaryCard({ value, label, sub, tone }: { value: string; label: string; sub: string; tone: "primary" | "good" | "warn" | "neutral" }) {
  return (
    <div className={`cc-summary-card cc-summary-${tone}`}>
      <span className="cc-summary-value">{value}</span>
      <span className="cc-summary-label">{label}</span>
      <span className="cc-summary-sub">{sub}</span>
    </div>
  );
}
