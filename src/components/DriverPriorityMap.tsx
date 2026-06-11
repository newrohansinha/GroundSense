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

export default function DriverPriorityMap({ drivers, topDriver, watchCount, publishedIssueCount }: DriverPriorityMapProps) {
  const sorted = [...drivers].sort(
    (a, b) => (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99)
  );

  const counts = {
    Act: drivers.filter((d) => d.status === "Act").length,
    Validate: drivers.filter((d) => d.status === "Validate").length,
    Watch: watchCount ?? drivers.filter((d) => d.status === "Watch").length,
  };

  return (
    <div className="gs-driver-priority-map">
      <style>{`
        .gs-driver-priority-map {
          font-family: Inter, ui-sans-serif, system-ui, -apple-system, sans-serif;
          color: #2b2118;
          background: #fffdf8;
          border: 1px solid #e7dccd;
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
          color: #2b2118;
        }
        .gs-dpm-subtitle {
          margin: 0;
          font-size: 13px;
          color: #7a6a5d;
        }
        .gs-dpm-counts {
          font-size: 13px;
          color: #7a6a5d;
          white-space: nowrap;
          flex-shrink: 0;
          padding-top: 2px;
        }
        .gs-dpm-count-act { color: #2b2118; font-weight: 650; }
        .gs-dpm-count-validate { color: #5c4e3a; font-weight: 600; }
        .gs-dpm-count-watch { color: #7a6a5d; }
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
          color: #7a6a5d;
          border-bottom: 1px solid #e7dccd;
          padding: 6px 10px 8px;
        }
        .gs-driver-table th:first-child { padding-left: 0; }
        .gs-driver-table th:last-child { padding-right: 0; }
        .gs-driver-row td {
          padding: 11px 10px;
          border-bottom: 1px solid #f0e9de;
          vertical-align: top;
        }
        .gs-driver-row td:first-child { padding-left: 0; }
        .gs-driver-row td:last-child { padding-right: 0; }
        .gs-driver-row:last-child td { border-bottom: none; }
        .gs-driver-row-inactive td {
          color: #a8998a;
        }
        .gs-driver-name {
          font-weight: 620;
          color: #2b2118;
          font-size: 14px;
          line-height: 1.3;
        }
        .gs-driver-row-inactive .gs-driver-name {
          color: #a8998a;
          font-style: italic;
          font-weight: 500;
        }
        .gs-driver-issue-link {
          display: block;
          margin-top: 3px;
          font-size: 12px;
          color: #9a8070;
          font-style: normal;
        }
        .gs-driver-row-inactive .gs-driver-issue-link {
          color: #b8a898;
        }
        .gs-driver-impact {
          font-size: 14px;
          color: #2b2118;
          white-space: nowrap;
        }
        .gs-driver-row-inactive .gs-driver-impact {
          color: #a8998a;
        }
        .gs-driver-quality {
          display: block;
          font-size: 11px;
          color: #9a8070;
          margin-top: 2px;
        }
        .gs-driver-reason {
          font-size: 13px;
          color: #5c4e3a;
          line-height: 1.45;
          max-width: 260px;
        }
        .gs-driver-action {
          font-size: 12px;
          color: #7a5c2b;
          line-height: 1.4;
          max-width: 220px;
          font-style: italic;
        }
        .gs-driver-row-inactive .gs-driver-reason,
        .gs-driver-row-inactive .gs-driver-action {
          color: #a8998a;
        }
        .gs-status-badge {
          font-size: 12px;
          font-weight: 680;
          display: inline-block;
          white-space: nowrap;
        }
        .gs-status-act { color: #1a120b; }
        .gs-status-validate { color: #5c4e3a; }
        .gs-status-watch { color: #7a6a5d; }
        .gs-status-ignore { color: #9a8070; }
        .gs-status-not-active { color: #b8a898; font-style: italic; font-weight: 500; }
        .gs-evidence-dot {
          font-size: 12px;
          font-weight: 600;
          display: inline-block;
          white-space: nowrap;
        }
        .gs-evidence-strong { color: #2b6b3a; }
        .gs-evidence-moderate { color: #7a5c2b; }
        .gs-evidence-weak { color: #8a4a2a; }
        .gs-evidence-none { color: #9a8070; font-style: italic; }
        .gs-dpm-top-driver {
          background: #f7f1e8;
          border: 1px solid #e0d3c0;
          border-radius: 10px;
          padding: 12px 14px;
          margin-bottom: 16px;
          font-size: 13px;
          color: #5c4e3a;
        }
        .gs-dpm-top-driver strong {
          color: #2b2118;
          font-size: 14px;
          display: block;
          margin-bottom: 3px;
        }
        .gs-dpm-top-label {
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.07em;
          color: #b45309;
          margin-bottom: 6px;
        }
        .gs-dpm-top-action {
          margin-top: 6px;
          font-size: 12px;
          color: #7a5c2b;
          font-style: italic;
        }
      `}</style>

      <div className="gs-dpm-header">
        <div>
          <h3 className="gs-dpm-title">Driver Priority Map</h3>
          <p className="gs-dpm-subtitle">
            {publishedIssueCount !== undefined
              ? `From ${publishedIssueCount} published issue${publishedIssueCount !== 1 ? "s" : ""} — one issue can affect multiple drivers`
              : "Operating drivers ranked by current exposure and urgency"}
          </p>
        </div>
        <div className="gs-dpm-counts">
          <span className="gs-dpm-count-act">{counts.Act} Act</span>
          {" · "}
          <span className="gs-dpm-count-validate">{counts.Validate} Validate</span>
          {" · "}
          <span className="gs-dpm-count-watch">{counts.Watch} Watch</span>
        </div>
      </div>

      {topDriver && (
        <div className="gs-dpm-top-driver">
          <div className="gs-dpm-top-label">Top priority driver</div>
          <strong>{topDriver.name}</strong>
          {topDriver.reason}
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
          {sorted.map((driver) => {
            const isInactive =
              driver.status === "Not active" || driver.status === "Ignore";
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
                  <StatusBadge status={driver.status} />
                </td>
                <td>
                  {driver.estimatedImpact ? (
                    <>
                      <span className="gs-driver-impact">{driver.estimatedImpact}</span>
                      {driver.estimateQuality && (
                        <span className="gs-driver-quality">{driver.estimateQuality}</span>
                      )}
                    </>
                  ) : (
                    <span className="gs-driver-impact" style={{ color: "#b8a898" }}>—</span>
                  )}
                </td>
                <td>
                  <EvidenceDot strength={driver.evidenceStrength} />
                </td>
                <td>
                  <span className="gs-driver-reason">{driver.reason}</span>
                </td>
                <td>
                  {driver.recommendedAction && driver.recommendedAction !== "—" ? (
                    <span className="gs-driver-action">{driver.recommendedAction}</span>
                  ) : (
                    <span style={{ color: "#b8a898", fontSize: 13 }}>—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
