export type ActionRoiItem = {
  id: string;
  title: string;
  linkedIssueTitle: string | null;
  owner: string | null;
  deadline: string | null;
  status: string;
  expectedBenefitLow: number | null;
  expectedBenefitHigh: number | null;
  effortLevel: string | null;
  protectedValue: number | null;
  successCondition: string | null;
  nextStep: string | null;
  decisionTrigger: string | null;
  outcomeStatus: string | null;
};

type ActionRoiPanelProps = {
  actions: ActionRoiItem[];
  compact?: boolean;
  onStatusChange?: (id: string, status: string) => void;
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

const STATUS_DISPLAY: Record<string, string> = {
  open: "Open",
  in_review: "In review",
  completed: "Completed",
  dismissed: "Dismissed",
};

function normalizeStatus(status: string): string {
  return STATUS_DISPLAY[status.toLowerCase().replace(/ /g, "_")] ?? status;
}

function StatusChip({ status }: { status: string }) {
  const normalized = status.toLowerCase().replace(/ /g, "_");
  const classMap: Record<string, string> = {
    open: "gs-arp-chip gs-arp-chip-open",
    in_review: "gs-arp-chip gs-arp-chip-review",
    completed: "gs-arp-chip gs-arp-chip-completed",
    dismissed: "gs-arp-chip gs-arp-chip-dismissed",
  };
  const cls = classMap[normalized] ?? "gs-arp-chip gs-arp-chip-open";
  return <span className={cls}>{normalizeStatus(status)}</span>;
}

function EffortBadge({ effort }: { effort: string }) {
  const normalized = effort.toLowerCase();
  const classMap: Record<string, string> = {
    low: "gs-arp-effort gs-arp-effort-low",
    medium: "gs-arp-effort gs-arp-effort-medium",
    high: "gs-arp-effort gs-arp-effort-high",
  };
  const cls = classMap[normalized] ?? "gs-arp-effort";
  return <span className={cls}>{effort}</span>;
}

export default function ActionRoiPanel({ actions, compact = false, onStatusChange }: ActionRoiPanelProps) {
  const open = actions.filter(
    (a) => !["completed", "dismissed"].includes(a.status.toLowerCase().replace(/ /g, "_"))
  ).length;
  const completed = actions.filter(
    (a) => a.status.toLowerCase().replace(/ /g, "_") === "completed"
  ).length;

  return (
    <div className="gs-action-roi-panel">
      <style>{`
        .gs-action-roi-panel {
          font-family: Inter, ui-sans-serif, system-ui, -apple-system, sans-serif;
          color: #2b2118;
          background: #fffdf8;
          border: 1px solid #e7dccd;
          border-radius: 18px;
          padding: 20px;
          margin-bottom: 18px;
        }
        .gs-arp-header {
          margin-bottom: 18px;
        }
        .gs-arp-title {
          margin: 0 0 4px;
          font-size: 17px;
          font-weight: 700;
          letter-spacing: -0.02em;
          color: #2b2118;
        }
        .gs-arp-subtitle {
          margin: 0;
          font-size: 13px;
          color: #7a6a5d;
        }
        .gs-arp-empty {
          font-size: 13px;
          color: #9a8070;
          font-style: italic;
          padding: 8px 0;
        }
        .gs-arp-list {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .gs-arp-card {
          border: 1px solid #e7dccd;
          border-radius: 12px;
          padding: 14px 16px;
          background: #fefcf8;
        }
        .gs-arp-card-title {
          font-weight: 680;
          font-size: 15px;
          color: #2b2118;
          margin: 0 0 8px;
          line-height: 1.3;
        }
        .gs-arp-card-meta {
          display: flex;
          align-items: center;
          gap: 14px;
          flex-wrap: wrap;
          margin-bottom: 8px;
        }
        .gs-arp-meta-item {
          font-size: 13px;
          color: #5c4e3a;
        }
        .gs-arp-meta-label {
          font-size: 12px;
          color: #9a8070;
          margin-right: 3px;
        }
        .gs-arp-benefit-row {
          display: flex;
          align-items: center;
          gap: 14px;
          flex-wrap: wrap;
          margin-bottom: 6px;
        }
        .gs-arp-benefit {
          font-size: 14px;
          color: #2b5a3e;
          font-weight: 600;
        }
        .gs-arp-detail-row {
          font-size: 13px;
          color: #5c4e3a;
          margin-bottom: 4px;
          line-height: 1.4;
        }
        .gs-arp-detail-row:last-child {
          margin-bottom: 0;
        }
        .gs-arp-detail-label {
          font-weight: 650;
          color: #7a6a5d;
        }
        .gs-arp-linked-issue {
          font-size: 12px;
          color: #9a8070;
          margin-bottom: 8px;
          font-style: italic;
        }
        .gs-arp-compact-card {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 10px 0;
          border-bottom: 1px solid #f0e9de;
        }
        .gs-arp-compact-card:last-child {
          border-bottom: none;
        }
        .gs-arp-compact-title {
          font-size: 14px;
          font-weight: 620;
          color: #2b2118;
          flex: 1;
          min-width: 0;
        }
        .gs-arp-compact-owner {
          font-size: 13px;
          color: #7a6a5d;
          white-space: nowrap;
        }
        .gs-arp-chip {
          font-size: 12px;
          font-weight: 650;
          display: inline-block;
          white-space: nowrap;
        }
        .gs-arp-chip-open { color: #5c4e3a; }
        .gs-arp-chip-review { color: #7a5c2b; }
        .gs-arp-chip-completed { color: #2b6b3a; }
        .gs-arp-chip-dismissed { color: #9a8070; font-style: italic; }
        .gs-arp-effort {
          font-size: 12px;
          font-weight: 600;
          display: inline-block;
          white-space: nowrap;
        }
        .gs-arp-effort-low { color: #2b5a3e; }
        .gs-arp-effort-medium { color: #7a5c2b; }
        .gs-arp-effort-high { color: #8a3a1a; }
      `}</style>

      <div className="gs-arp-header">
        <h3 className="gs-arp-title">Executive Actions</h3>
        <p className="gs-arp-subtitle">
          {open} open{completed > 0 ? ` · ${completed} completed` : ""}
        </p>
      </div>

      {actions.length === 0 ? (
        <p className="gs-arp-empty">No actions recorded yet.</p>
      ) : compact ? (
        <div className="gs-arp-list">
          {actions.map((action) => (
            <div key={action.id} className="gs-arp-compact-card">
              <span className="gs-arp-compact-title">{action.title}</span>
              {action.owner && (
                <span className="gs-arp-compact-owner">{action.owner}</span>
              )}
              <StatusChip status={action.status} />
            </div>
          ))}
        </div>
      ) : (
        <div className="gs-arp-list">
          {actions.map((action) => (
            <div key={action.id} className="gs-arp-card">
              <p className="gs-arp-card-title">{action.title}</p>

              {action.linkedIssueTitle && (
                <p className="gs-arp-linked-issue">Linked to: {action.linkedIssueTitle}</p>
              )}

              <div className="gs-arp-card-meta">
                {action.owner && (
                  <span className="gs-arp-meta-item">
                    <span className="gs-arp-meta-label">Owner: </span>
                    {action.owner}
                  </span>
                )}
                {action.deadline && (
                  <span className="gs-arp-meta-item">
                    <span className="gs-arp-meta-label">Due: </span>
                    {formatDate(action.deadline)}
                  </span>
                )}
                {onStatusChange ? (
                  <select
                    value={action.status}
                    onChange={(e) => onStatusChange(action.id, e.target.value)}
                    style={{ fontSize: 12, border: "1px solid #e7dccd", borderRadius: 6, padding: "2px 6px", background: "#fffdf8", color: "#5c4e3a", cursor: "pointer" }}
                  >
                    <option value="open">Open</option>
                    <option value="in_review">In review</option>
                    <option value="accepted">Accepted</option>
                    <option value="dismissed">Dismissed</option>
                    <option value="completed">Completed</option>
                  </select>
                ) : (
                  <StatusChip status={action.status} />
                )}
              </div>

              {(action.expectedBenefitLow !== null ||
                action.expectedBenefitHigh !== null ||
                action.effortLevel) && (
                <div className="gs-arp-benefit-row">
                  {(action.expectedBenefitLow !== null || action.expectedBenefitHigh !== null) && (
                    <span className="gs-arp-benefit">
                      {action.expectedBenefitLow !== null && action.expectedBenefitHigh !== null && action.expectedBenefitLow === action.expectedBenefitHigh
                        ? `${formatMoney(action.expectedBenefitHigh)} modeled midpoint`
                        : <>
                            {action.expectedBenefitLow !== null ? formatMoney(action.expectedBenefitLow) : "?"}
                            {" – "}
                            {action.expectedBenefitHigh !== null ? formatMoney(action.expectedBenefitHigh) : "?"}
                          </>
                      }
                      {" expected benefit"}
                    </span>
                  )}
                  {action.effortLevel && <EffortBadge effort={action.effortLevel} />}
                </div>
              )}

              {action.nextStep && (
                <p className="gs-arp-detail-row">
                  <span className="gs-arp-detail-label">Next: </span>
                  {action.nextStep}
                </p>
              )}

              {action.decisionTrigger && (
                <p className="gs-arp-detail-row">
                  <span className="gs-arp-detail-label">Escalate when: </span>
                  {action.decisionTrigger}
                </p>
              )}

              {action.successCondition && (
                <p className="gs-arp-detail-row">
                  <span className="gs-arp-detail-label">Done when: </span>
                  {action.successCondition}
                </p>
              )}

              {(action.protectedValue !== null || action.expectedBenefitHigh !== null) && (
                <p className="gs-arp-detail-row">
                  <span className="gs-arp-detail-label">Protected value at stake: </span>
                  {action.expectedBenefitLow !== null && action.expectedBenefitHigh !== null
                    ? action.expectedBenefitLow === action.expectedBenefitHigh
                      ? `${formatMoney(action.expectedBenefitHigh)} point estimate`
                      : `${formatMoney(action.expectedBenefitLow)}–${formatMoney(action.expectedBenefitHigh)} scenario range`
                    : action.protectedValue !== null
                    ? formatMoney(action.protectedValue)
                    : "—"}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
