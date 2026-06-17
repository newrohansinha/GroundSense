type ForecastRow = {
  issueId: string;
  issueType: "risk" | "opportunity" | "operating_change" | "watchlist";
  title: string;
  forecastDate: string | null;
  predictedLow: number | null;
  predictedHigh: number | null;
  currentStatus: string;
  outcomeStatus:
    | "open"
    | "awaiting_data"
    | "resolved"
    | "accurate"
    | "overestimated"
    | "underestimated"
    | "missed"
    | "monitoring_only";
  actualImpact: number | null;
  outcomeNotes: string | null;
  // Executive point-estimate display (no range) — preferred in executive mode.
  execEstimate?: string | null;
};

type ForecastAccuracyPanelProps = {
  rows: ForecastRow[];
  execMode?: boolean;
};

function formatMoney(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000_000) {
    const v = abs / 1_000_000_000;
    return `${sign}$${v % 1 === 0 ? v.toFixed(0) : v.toFixed(1)}B`;
  }
  if (abs >= 1_000_000) {
    const v = abs / 1_000_000;
    return `${sign}$${v % 1 === 0 ? v.toFixed(0) : v.toFixed(1)}M`;
  }
  if (abs >= 1_000) {
    const v = abs / 1_000;
    return `${sign}$${v % 1 === 0 ? v.toFixed(0) : v.toFixed(1)}K`;
  }
  return `${sign}$${abs.toFixed(0)}`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return iso;
  }
}

const TYPE_LABELS: Record<ForecastRow["issueType"], string> = {
  risk: "Risk",
  opportunity: "Opportunity",
  operating_change: "Op. Change",
  watchlist: "Watchlist",
};

const OUTCOME_LABELS: Record<ForecastRow["outcomeStatus"], string> = {
  open: "Open forecast",
  awaiting_data: "Awaiting data",
  resolved: "Resolved",
  accurate: "Accurate",
  overestimated: "Overestimated",
  underestimated: "Underestimated",
  missed: "Missed",
  monitoring_only: "Monitoring only",
};

function OutcomeChip({ status }: { status: ForecastRow["outcomeStatus"] }) {
  const classMap: Record<ForecastRow["outcomeStatus"], string> = {
    open: "gs-fap-chip gs-fap-chip-open",
    awaiting_data: "gs-fap-chip gs-fap-chip-awaiting",
    resolved: "gs-fap-chip gs-fap-chip-resolved",
    accurate: "gs-fap-chip gs-fap-chip-accurate",
    overestimated: "gs-fap-chip gs-fap-chip-over",
    underestimated: "gs-fap-chip gs-fap-chip-under",
    missed: "gs-fap-chip gs-fap-chip-missed",
    monitoring_only: "gs-fap-chip gs-fap-chip-monitoring",
  };
  return <span className={classMap[status]}>{OUTCOME_LABELS[status]}</span>;
}

export default function ForecastAccuracyPanel({ rows, execMode = false }: ForecastAccuracyPanelProps) {
  const resolvedRows = rows.filter((r) =>
    ["resolved", "accurate", "overestimated", "underestimated", "missed"].includes(r.outcomeStatus)
  );
  const openRows = rows.filter((r) => !resolvedRows.includes(r));

  return (
    <div className="gs-forecast-accuracy-panel">
      <style>{`
        .gs-forecast-accuracy-panel {
          font-family: Inter, ui-sans-serif, system-ui, -apple-system, sans-serif;
          color: var(--text-primary);
          background: var(--bg-surface);
          border: 1px solid var(--border-default);
          border-radius: 18px;
          padding: 20px;
          margin-bottom: 18px;
        }
        .gs-fap-header {
          margin-bottom: 18px;
        }
        .gs-fap-title {
          margin: 0 0 4px;
          font-size: 17px;
          font-weight: 700;
          letter-spacing: -0.02em;
          color: var(--text-primary);
        }
        .gs-fap-note {
          margin: 0;
          font-size: 13px;
          color: var(--text-muted);
        }
        .gs-fap-section-label {
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.07em;
          color: var(--text-muted);
          margin: 20px 0 10px;
        }
        .gs-fap-section-label:first-of-type {
          margin-top: 0;
        }
        .gs-fap-empty {
          font-size: 13px;
          color: var(--text-muted);
          padding: 10px 0 4px;
          font-style: italic;
        }
        .gs-fap-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 14px;
        }
        .gs-fap-table th {
          text-align: left;
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: var(--text-muted);
          border-bottom: 1px solid var(--border-default);
          padding: 6px 10px 8px;
        }
        .gs-fap-table th:first-child { padding-left: 0; }
        .gs-fap-table th:last-child { padding-right: 0; }
        .gs-fap-row td {
          padding: 11px 10px;
          border-bottom: 1px solid var(--bg-surface-muted);
          vertical-align: top;
        }
        .gs-fap-row td:first-child { padding-left: 0; }
        .gs-fap-row td:last-child { padding-right: 0; }
        .gs-fap-row:last-child td { border-bottom: none; }
        .gs-fap-issue-title {
          font-weight: 620;
          font-size: 14px;
          color: var(--text-primary);
          line-height: 1.3;
          display: block;
        }
        .gs-fap-date {
          display: block;
          font-size: 12px;
          color: var(--text-muted);
          margin-top: 2px;
        }
        .gs-fap-type {
          font-size: 12px;
          color: var(--text-muted);
          white-space: nowrap;
        }
        .gs-fap-range {
          font-size: 14px;
          color: var(--text-primary);
          white-space: nowrap;
        }
        .gs-fap-range-null {
          color: var(--text-muted);
          font-style: italic;
          font-size: 13px;
        }
        .gs-fap-actual {
          display: block;
          font-size: 12px;
          color: var(--text-muted);
          margin-top: 2px;
        }
        .gs-fap-status-text {
          font-size: 13px;
          color: var(--text-secondary);
          max-width: 200px;
          line-height: 1.4;
        }
        .gs-fap-notes {
          display: block;
          font-size: 12px;
          color: var(--text-muted);
          margin-top: 3px;
          font-style: italic;
        }
        .gs-fap-chip {
          font-size: 12px;
          font-weight: 650;
          display: inline-block;
          white-space: nowrap;
        }
        .gs-fap-chip-open { color: var(--text-secondary); }
        .gs-fap-chip-awaiting { color: var(--text-muted); }
        .gs-fap-chip-resolved { color: var(--success); }
        .gs-fap-chip-accurate { color: var(--success); }
        .gs-fap-chip-over { color: var(--accent-hover); }
        .gs-fap-chip-under { color: var(--accent-hover); }
        .gs-fap-chip-missed { color: var(--danger); }
        .gs-fap-chip-monitoring { color: var(--text-muted); font-style: italic; }
      `}</style>

      <div className="gs-fap-header">
        <h3 className="gs-fap-title">Outcome tracking</h3>
        <p className="gs-fap-note">
          Resolved issues will be compared against actual results to improve future estimates.
        </p>
      </div>

      {resolvedRows.length === 0 ? (
        <p className="gs-fap-empty">
          No resolved forecasts yet. Open forecasts below will become accuracy data points as issues resolve.
        </p>
      ) : (
        <>
          <div className="gs-fap-section-label">Resolved</div>
          <ForecastTable rows={resolvedRows} execMode={execMode} />
        </>
      )}

      {openRows.length > 0 && (
        <>
          <div className="gs-fap-section-label">Open forecasts</div>
          <ForecastTable rows={openRows} execMode={execMode} />
        </>
      )}
    </div>
  );
}

function ForecastTable({ rows, execMode = false }: { rows: ForecastRow[]; execMode?: boolean }) {
  return (
    <table className="gs-fap-table">
      <thead>
        <tr>
          <th>Issue</th>
          <th>Type</th>
          <th>{execMode ? "Predicted estimate" : "Predicted range"}</th>
          <th>Status</th>
          <th>Accuracy</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.issueId} className="gs-fap-row">
            <td>
              <span className="gs-fap-issue-title">{row.title}</span>
              {row.forecastDate && (
                <span className="gs-fap-date">Forecasted {formatDate(row.forecastDate)}</span>
              )}
            </td>
            <td>
              <span className="gs-fap-type">{TYPE_LABELS[row.issueType]}</span>
            </td>
            <td>
              {execMode ? (
                <span className="gs-fap-range">
                  {row.execEstimate ?? "Needs validation"}
                  {row.actualImpact !== null && (
                    <span className="gs-fap-actual">Actual: {formatMoney(row.actualImpact)}</span>
                  )}
                </span>
              ) : row.predictedLow !== null || row.predictedHigh !== null ? (
                <span className="gs-fap-range">
                  {row.predictedLow !== null && row.predictedHigh !== null && row.predictedLow === row.predictedHigh
                    ? `${formatMoney(row.predictedHigh)} point estimate`
                    : <>
                        {row.predictedLow !== null ? formatMoney(row.predictedLow) : "?"}
                        {" – "}
                        {row.predictedHigh !== null ? formatMoney(row.predictedHigh) : "?"}
                      </>
                  }
                  {row.actualImpact !== null && (
                    <span className="gs-fap-actual">
                      Actual: {formatMoney(row.actualImpact)}
                    </span>
                  )}
                </span>
              ) : (
                <span className="gs-fap-range-null">Not estimated</span>
              )}
            </td>
            <td>
              <span className="gs-fap-status-text">{row.currentStatus}</span>
              {row.outcomeNotes && (
                <span className="gs-fap-notes">{row.outcomeNotes}</span>
              )}
            </td>
            <td>
              <OutcomeChip status={row.outcomeStatus} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
