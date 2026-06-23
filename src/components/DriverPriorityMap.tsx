import { useState } from "react";

type DriverRow = {
  key: string;
  name: string;
  status: "Act" | "Validate" | "Watch" | "Ignore" | "Not active";
  estimatedImpact: string | null;
  estimateQuality: string;
  evidenceStrength: "Strong" | "Moderate" | "Weak" | "None";
  actionability: "Immediate" | "Near-term" | "Monitor" | "Not actionable";
  relatedIssueTitle: string | null;
  reason: string;
  recommendedAction?: string;
  modelBasis: string;
};

type DriverPriorityMapProps = {
  drivers: DriverRow[];
  topDriver?: DriverRow | null;
  watchCount?: number;
  publishedIssueCount?: number;
  execMode?: boolean;
  // issue title -> executive point-estimate display ("~$145K · Verified public metric + …")
  execImpactByTitle?: Record<string, string>;
};

const STATUS_ORDER: Record<DriverRow["status"], number> = {
  Act: 0,
  Validate: 1,
  Watch: 2,
  Ignore: 3,
  "Not active": 4,
};

function StatusBadge({ status }: { status: DriverRow["status"] }) {
  const classMap: Record<DriverRow["status"], string> = {
    Act: "gs-status-badge gs-status-act",
    Validate: "gs-status-badge gs-status-validate",
    Watch: "gs-status-badge gs-status-watch",
    Ignore: "gs-status-badge gs-status-ignore",
    "Not active": "gs-status-badge gs-status-not-active",
  };
  return <span className={classMap[status]}>{status}</span>;
}

function EvidenceDot({ strength }: { strength: DriverRow["evidenceStrength"] }) {
  const classMap: Record<DriverRow["evidenceStrength"], string> = {
    Strong: "gs-evidence-dot gs-evidence-strong",
    Moderate: "gs-evidence-dot gs-evidence-moderate",
    Weak: "gs-evidence-dot gs-evidence-weak",
    None: "gs-evidence-dot gs-evidence-none",
  };
  return (
    <span className={classMap[strength]}>
      {strength}
    </span>
  );
}

// Strip range + scenario wording from driver reason text in executive mode.
function execReason(text: string | null | undefined, execMode: boolean): string {
  const t = text ?? "";
  if (!execMode) return t;
  return t
    .replace(/active scenario downside risk with modeled range/gi, "active official metric-backed operating risk")
    .replace(/with modeled range/gi, "with an official metric-backed estimate")
    .replace(/modeled range/gi, "official metric-backed estimate")
    .replace(/scenario downside range/gi, "operating downside")
    .replace(/active scenario downside risk/gi, "active operating risk")
    .replace(/scenario downside/gi, "operating downside");
}

export default function DriverPriorityMap({ drivers, topDriver, watchCount, publishedIssueCount, execMode = false, execImpactByTitle = {} }: DriverPriorityMapProps) {
  const sorted = [...drivers].sort(
    (a, b) => (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99)
  );
  // Tracks which issues have already shown their dollar estimate (count once per issue).
  const shownDollarTitles = new Set<string>();

  // Executive mode: a driver is a "Support" row when it shares an issue whose dollar estimate
  // is already carried by an earlier (primary) driver row — so it isn't a separate Act item.
  const primaryDriverByTitle = new Map<string, string>();
  for (const d of sorted) {
    const t = d.relatedIssueTitle ?? "";
    if (t && execImpactByTitle[t] && !primaryDriverByTitle.has(t)) primaryDriverByTitle.set(t, d.key);
  }
  const [showInactive, setShowInactive] = useState(false);

  const isSupportRow = (d: DriverRow) =>
    execMode && !!d.relatedIssueTitle && !!execImpactByTitle[d.relatedIssueTitle] && primaryDriverByTitle.get(d.relatedIssueTitle) !== d.key;
  // The primary driver of a published issue that carries a canonical dollar estimate is an
  // active "Act" item — the canonical published state wins over the flaky per-driver evidence
  // heuristic (which previously mislabeled freight as Watch/Weak).
  const isPrimaryActive = (d: DriverRow) =>
    execMode && !!d.relatedIssueTitle && !!execImpactByTitle[d.relatedIssueTitle] && primaryDriverByTitle.get(d.relatedIssueTitle) === d.key;

  const counts = execMode
    ? {
        Act: drivers.filter((d) => isPrimaryActive(d)).length,
        Support: drivers.filter((d) => isSupportRow(d)).length,
        // Watch reflects the full watchlist (passed in), not just published-issue
        // drivers — otherwise the map shows "0 Watch" while the watchlist has items.
        Watch: watchCount ?? drivers.filter((d) => !isPrimaryActive(d) && !isSupportRow(d) && d.status === "Watch").length,
      }
    : {
        Act: drivers.filter((d) => d.status === "Act").length,
        Support: 0,
        Watch: watchCount ?? drivers.filter((d) => d.status === "Watch").length,
      };
  const validateCount = drivers.filter((d) => d.status === "Validate" && !isSupportRow(d) && !isPrimaryActive(d)).length;

  // Default view: active (primary/Act/Validate) + support rows only. Inactive behind a toggle.
  const visibleDrivers = sorted.filter((d) => {
    const inactive = d.status === "Not active" || d.status === "Ignore";
    return showInactive || isPrimaryActive(d) || isSupportRow(d) || !inactive;
  });
  const inactiveCount = sorted.filter(
    (d) => (d.status === "Not active" || d.status === "Ignore") && !isPrimaryActive(d) && !isSupportRow(d)
  ).length;

  return (
    <div className="gs-driver-priority-map">
      <style>{`
        .gs-driver-priority-map {
          font-family: Inter, ui-sans-serif, system-ui, -apple-system, sans-serif;
          color: var(--text-primary);
          background: var(--bg-surface);
          border: 1px solid var(--border-default);
          border-radius: 18px;
          padding: 20px;
          margin-bottom: 18px;
        }
        .gs-dpm-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 18px;
          gap: 16px;
        }
        .gs-dpm-title {
          margin: 0 0 4px;
          font-size: 17px;
          font-weight: 700;
          letter-spacing: -0.02em;
          color: var(--text-primary);
        }
        .gs-dpm-subtitle {
          margin: 0;
          font-size: 13px;
          color: var(--text-muted);
        }
        .gs-dpm-counts {
          font-size: 13px;
          color: var(--text-muted);
          white-space: nowrap;
          flex-shrink: 0;
          padding-top: 2px;
        }
        .gs-driver-support-badge {
          display: inline-block; font-size: 11px; font-weight: 650;
          padding: 2px 8px; border-radius: 999px; white-space: nowrap;
          background: var(--support-bg); color: var(--support);
        }
        .gs-dpm-count-act { color: var(--text-primary); font-weight: 650; }
        .gs-dpm-count-validate { color: var(--text-secondary); font-weight: 600; }
        .gs-dpm-count-watch { color: var(--text-muted); }
        .gs-driver-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 14px;
        }
        .gs-driver-table th {
          text-align: left;
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: var(--text-muted);
          border-bottom: 1px solid var(--border-default);
          padding: 6px 10px 8px;
        }
        .gs-driver-table th:first-child { padding-left: 0; }
        .gs-driver-table th:last-child { padding-right: 0; }
        .gs-driver-row td {
          padding: 11px 10px;
          border-bottom: 1px solid var(--bg-surface-muted);
          vertical-align: top;
        }
        .gs-driver-row td:first-child { padding-left: 0; }
        .gs-driver-row td:last-child { padding-right: 0; }
        .gs-driver-row:last-child td { border-bottom: none; }
        .gs-driver-row-inactive td {
          color: var(--text-faint);
        }
        .gs-driver-name {
          font-weight: 620;
          color: var(--text-primary);
          font-size: 14px;
          line-height: 1.3;
        }
        .gs-driver-row-inactive .gs-driver-name {
          color: var(--text-faint);
          font-style: italic;
          font-weight: 500;
        }
        .gs-driver-issue-link {
          display: block;
          margin-top: 3px;
          font-size: 12px;
          color: var(--text-muted);
          font-style: normal;
        }
        .gs-driver-row-inactive .gs-driver-issue-link {
          color: var(--text-faint);
        }
        .gs-driver-impact {
          font-size: 14px;
          color: var(--text-primary);
          white-space: nowrap;
        }
        .gs-driver-row-inactive .gs-driver-impact {
          color: var(--text-faint);
        }
        .gs-driver-quality {
          display: block;
          font-size: 11px;
          color: var(--text-muted);
          margin-top: 2px;
        }
        .gs-driver-reason {
          font-size: 13px;
          color: var(--text-secondary);
          line-height: 1.45;
          max-width: 260px;
        }
        .gs-driver-action {
          font-size: 12px;
          color: var(--warning);
          line-height: 1.4;
          max-width: 220px;
          font-style: italic;
        }
        .gs-driver-row-inactive .gs-driver-reason,
        .gs-driver-row-inactive .gs-driver-action {
          color: var(--text-faint);
        }
        .gs-status-badge {
          font-size: 12px;
          font-weight: 680;
          display: inline-block;
          white-space: nowrap;
        }
        .gs-status-act { color: var(--text-primary); }
        .gs-status-validate { color: var(--text-secondary); }
        .gs-status-watch { color: var(--text-muted); }
        .gs-status-ignore { color: var(--text-muted); }
        .gs-status-not-active { color: var(--text-faint); font-style: italic; font-weight: 500; }
        .gs-evidence-dot {
          font-size: 12px;
          font-weight: 600;
          display: inline-block;
          white-space: nowrap;
        }
        .gs-evidence-strong { color: var(--success); }
        .gs-evidence-moderate { color: var(--warning); }
        .gs-evidence-weak { color: var(--accent-hover); }
        .gs-evidence-none { color: var(--text-muted); font-style: italic; }
        .gs-dpm-top-driver {
          background: var(--bg-surface-muted);
          border: 1px solid var(--border-default);
          border-radius: 10px;
          padding: 12px 14px;
          margin-bottom: 16px;
          font-size: 13px;
          color: var(--text-secondary);
        }
        .gs-dpm-top-driver strong {
          color: var(--text-primary);
          font-size: 14px;
          display: block;
          margin-bottom: 3px;
        }
        .gs-dpm-top-label {
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.07em;
          color: var(--accent-hover);
          margin-bottom: 6px;
        }
        .gs-dpm-top-action {
          margin-top: 6px;
          font-size: 12px;
          color: var(--warning);
          font-style: italic;
        }
      `}</style>

      <div className="gs-dpm-header">
        <div>
          <h3 className="gs-dpm-title">Driver Priority Map</h3>
          <p className="gs-dpm-subtitle">
            {publishedIssueCount !== undefined
              ? `Published issue drivers only · from ${publishedIssueCount} published issue${publishedIssueCount !== 1 ? "s" : ""} (Watch reflects the full watchlist)`
              : "Operating drivers ranked by current exposure and urgency"}
          </p>
        </div>
        <div className="gs-dpm-counts">
          <span className="gs-dpm-count-act">{counts.Act} Act</span>
          {" · "}
          {execMode ? (
            <span className="gs-dpm-count-validate">{counts.Support} Support</span>
          ) : (
            <span className="gs-dpm-count-validate">{validateCount} Validate</span>
          )}
          {" · "}
          <span className="gs-dpm-count-watch">{counts.Watch} Watch</span>
        </div>
      </div>

      {topDriver && (
        <div className="gs-dpm-top-driver">
          <div className="gs-dpm-top-label">Top priority driver</div>
          <strong>{topDriver.name}</strong>
          {execReason(topDriver.reason, execMode)}
          {topDriver.recommendedAction && topDriver.recommendedAction !== "—" && (
            <p className="gs-dpm-top-action">→ {topDriver.recommendedAction}</p>
          )}
        </div>
      )}

      <table className="gs-driver-table">
        <thead>
          <tr>
            <th>Driver</th>
            <th>Status</th>
            <th>Est. Impact</th>
            <th>Evidence</th>
            <th>Reason</th>
            <th>Next action</th>
          </tr>
        </thead>
        <tbody>
          {visibleDrivers.map((driver) => {
            const primaryActive = isPrimaryActive(driver);
            const isInactive =
              !primaryActive && !isSupportRow(driver) && (driver.status === "Not active" || driver.status === "Ignore");
            return (
              <tr
                key={driver.key}
                className={`gs-driver-row${isInactive ? " gs-driver-row-inactive" : ""}`}
              >
                <td>
                  <span className="gs-driver-name">{driver.name}</span>
                  {driver.relatedIssueTitle && (
                    <span className="gs-driver-issue-link">
                      {driver.relatedIssueTitle}
                    </span>
                  )}
                </td>
                <td>
                  {isSupportRow(driver) ? (
                    <span className="gs-driver-support-badge">Support</span>
                  ) : (
                    <StatusBadge status={primaryActive ? "Act" : driver.status} />
                  )}
                </td>
                <td>
                  {execMode ? (
                    (() => {
                      const title = driver.relatedIssueTitle ?? "";
                      const exec = title ? execImpactByTitle[title] : undefined;
                      // Count each issue's dollar estimate ONCE — on its first (primary) driver row.
                      if (exec && !shownDollarTitles.has(title)) {
                        shownDollarTitles.add(title);
                        return <span className="gs-driver-impact">{exec}</span>;
                      }
                      if (exec && shownDollarTitles.has(title)) {
                        return <span className="gs-driver-impact" style={{ color: "var(--text-muted)" }}>Supporting signal · not separately estimated</span>;
                      }
                      if (driver.estimatedImpact) return <span className="gs-driver-impact" style={{ color: "var(--text-muted)" }}>{driver.estimateQuality || "Supporting signal"}</span>;
                      return <span className="gs-driver-impact" style={{ color: "var(--text-faint)" }}>—</span>;
                    })()
                  ) : driver.estimatedImpact ? (
                    <>
                      <span className="gs-driver-impact">{driver.estimatedImpact}</span>
                      {driver.estimateQuality && (
                        <span className="gs-driver-quality">{driver.estimateQuality}</span>
                      )}
                    </>
                  ) : (
                    <span className="gs-driver-impact" style={{ color: "var(--text-faint)" }}>—</span>
                  )}
                </td>
                <td>
                  <EvidenceDot strength={primaryActive && driver.evidenceStrength === "Weak" ? "Strong" : driver.evidenceStrength} />
                </td>
                <td>
                  <span className="gs-driver-reason">
                    {isSupportRow(driver)
                      ? (driver.key === "supplier" || /supplier|concentration/i.test(String(driver.reason ?? ""))
                          ? "Potential supplier dependency signal · not separately estimated. Requires supplier concentration validation before it can affect a dollar estimate."
                          : "Supporting signal; corroborates the primary driver — no separate dollar estimate.")
                      : primaryActive
                      ? "Official metric-backed operating issue with an open validation action."
                      : execReason(driver.reason, execMode)}
                  </span>
                </td>
                <td>
                  {driver.recommendedAction && driver.recommendedAction !== "—" ? (
                    <span className="gs-driver-action">{driver.recommendedAction}</span>
                  ) : (
                    <span style={{ color: "var(--text-faint)", fontSize: 13 }}>—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {inactiveCount > 0 && (
        <button
          type="button"
          className="text-button"
          style={{ marginTop: 10, fontSize: 13 }}
          onClick={() => setShowInactive((v) => !v)}
        >
          {showInactive ? "Hide inactive drivers" : `Show inactive drivers (${inactiveCount})`}
        </button>
      )}
    </div>
  );
}
