import { useState } from "react";

type ModelSection = {
  key: string;
  title: string;
  status: "calibrated" | "partially_calibrated" | "inferred" | "missing";
  completenessPercent: number;
  presentFields: string[];
  missingFields: Array<{ key: string; label: string; priority: "critical" | "high" | "medium" }>;
  whyItMatters: string;
};

type OperatingModelCompletenessProps = {
  sections: ModelSection[];
  overallCompleteness: number;
};

const STATUS_LABELS: Record<ModelSection["status"], string> = {
  calibrated: "Calibrated",
  partially_calibrated: "Partially calibrated",
  inferred: "Inferred",
  missing: "Missing data",
};

const PRIORITY_LABELS: Record<string, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
};

const PRIORITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2 };

function StatusLabel({ status }: { status: ModelSection["status"] }) {
  const classMap: Record<ModelSection["status"], string> = {
    calibrated: "gs-omc-status gs-omc-status-calibrated",
    partially_calibrated: "gs-omc-status gs-omc-status-partial",
    inferred: "gs-omc-status gs-omc-status-inferred",
    missing: "gs-omc-status gs-omc-status-missing",
  };
  return <span className={classMap[status]}>{STATUS_LABELS[status]}</span>;
}

function PriorityTag({ priority }: { priority: string }) {
  const classMap: Record<string, string> = {
    critical: "gs-omc-priority gs-omc-priority-critical",
    high: "gs-omc-priority gs-omc-priority-high",
    medium: "gs-omc-priority gs-omc-priority-medium",
  };
  const cls = classMap[priority] ?? "gs-omc-priority";
  return <span className={cls}>{PRIORITY_LABELS[priority] ?? priority}</span>;
}

function ProgressBar({ percent }: { percent: number }) {
  const clamped = Math.min(100, Math.max(0, percent));
  let fillClass = "gs-omc-bar-fill-low";
  if (clamped >= 80) fillClass = "gs-omc-bar-fill-high";
  else if (clamped >= 50) fillClass = "gs-omc-bar-fill-mid";

  return (
    <div className="gs-omc-bar-track">
      <div
        className={`gs-omc-bar-fill ${fillClass}`}
        style={{ width: `${Math.max(clamped, clamped > 0 ? 3 : 0)}%` }}
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
      />
    </div>
  );
}

function SectionRow({ section }: { section: ModelSection }) {
  const [expanded, setExpanded] = useState(false);
  const sortedMissing = [...section.missingFields].sort(
    (a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]
  );
  const hasMissing = sortedMissing.length > 0;
  const hasPresent = section.presentFields.length > 0;
  const needsDetail = hasMissing || hasPresent;

  return (
    <div className="gs-omc-section">
      <div className="gs-omc-section-top">
        <div className="gs-omc-section-meta">
          <span className="gs-omc-section-title">{section.title}</span>
          <StatusLabel status={section.status} />
        </div>
        <div className="gs-omc-section-right">
          <span className="gs-omc-pct">{section.completenessPercent}%</span>
          {needsDetail && (
            <button
              className="gs-omc-toggle-btn"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
            >
              {expanded ? "Less" : "Details"}
            </button>
          )}
        </div>
      </div>

      <ProgressBar percent={section.completenessPercent} />

      <p className="gs-omc-why">{section.whyItMatters}</p>

      {expanded && (
        <div className="gs-omc-detail">
          {hasMissing && (
            <div className="gs-omc-detail-block">
              <div className="gs-omc-detail-label">Missing inputs</div>
              <ul className="gs-omc-missing-list">
                {sortedMissing.map((f) => (
                  <li key={f.key} className="gs-omc-missing-item">
                    <PriorityTag priority={f.priority} />
                    <span className="gs-omc-missing-name">{f.label}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {hasPresent && (
            <div className="gs-omc-detail-block">
              <div className="gs-omc-detail-label">Present fields</div>
              <p className="gs-omc-present-fields">
                {section.presentFields.join(" · ")}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function OperatingModelCompleteness({
  sections,
  overallCompleteness,
}: OperatingModelCompletenessProps) {
  const needsAttention = sections.filter(
    (s) =>
      s.status === "missing" ||
      s.status === "partially_calibrated" ||
      s.status === "inferred"
  ).length;
  const calibratedCount = sections.filter((s) => s.status === "calibrated").length;
  const totalRequired = sections.reduce(
    (sum, s) => sum + s.presentFields.length + s.missingFields.length,
    0
  );
  const presentTotal = sections.reduce((sum, s) => sum + s.presentFields.length, 0);

  return (
    <div className="gs-operating-model-completeness">
      <style>{`
        .gs-operating-model-completeness {
          font-family: Inter, ui-sans-serif, system-ui, -apple-system, sans-serif;
          color: #2b2118;
          background: #fffdf8;
          border: 1px solid #e7dccd;
          border-radius: 18px;
          padding: 20px;
          margin-bottom: 18px;
        }
        .gs-operating-model-completeness * {
          box-sizing: border-box;
        }
        .gs-omc-header {
          margin-bottom: 18px;
        }
        .gs-omc-title {
          margin: 0 0 4px;
          font-size: 17px;
          font-weight: 700;
          letter-spacing: -0.02em;
          color: #2b2118;
        }
        .gs-omc-subtitle {
          margin: 0 0 10px;
          font-size: 13px;
          color: #7a6a5d;
        }
        .gs-omc-summary {
          font-size: 13px;
          color: #5c4e3a;
          background: #f7f1e8;
          border: 1px solid #e0d3c0;
          border-radius: 8px;
          padding: 10px 14px;
          line-height: 1.5;
          margin: 0;
        }
        .gs-omc-summary strong {
          color: #2b2118;
        }
        .gs-omc-attention {
          color: #8a3a1a;
          font-weight: 650;
        }
        .gs-omc-sections {
          display: flex;
          flex-direction: column;
          margin-top: 16px;
        }
        .gs-omc-section {
          padding: 14px 0;
          border-bottom: 1px solid #f0e9de;
        }
        .gs-omc-section:last-child {
          border-bottom: none;
          padding-bottom: 0;
        }
        .gs-omc-section-top {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 10px;
          margin-bottom: 7px;
        }
        .gs-omc-section-meta {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
          min-width: 0;
        }
        .gs-omc-section-title {
          font-size: 14px;
          font-weight: 650;
          color: #2b2118;
        }
        .gs-omc-section-right {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-shrink: 0;
        }
        .gs-omc-pct {
          font-size: 13px;
          font-weight: 700;
          color: #5c4e3a;
          min-width: 34px;
          text-align: right;
        }
        .gs-omc-toggle-btn {
          font-size: 12px;
          font-weight: 650;
          color: #b45309;
          background: none;
          border: none;
          cursor: pointer;
          padding: 0;
          text-decoration: underline;
          text-underline-offset: 2px;
        }
        .gs-omc-toggle-btn:hover {
          color: #7a3a00;
        }
        .gs-omc-bar-track {
          width: 100%;
          height: 5px;
          background: #e7dccd;
          border-radius: 3px;
          overflow: hidden;
          margin-bottom: 7px;
        }
        .gs-omc-bar-fill {
          height: 100%;
          border-radius: 3px;
          transition: width 300ms ease;
        }
        .gs-omc-bar-fill-low { background: #c9a060; }
        .gs-omc-bar-fill-mid { background: #8a6a30; }
        .gs-omc-bar-fill-high { background: #2b6b3a; }
        .gs-omc-why {
          margin: 0;
          font-size: 13px;
          color: #7a6a5d;
          line-height: 1.45;
        }
        .gs-omc-detail {
          margin-top: 10px;
          padding-top: 10px;
          border-top: 1px solid #f0e9de;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .gs-omc-detail-block {
          display: flex;
          flex-direction: column;
          gap: 5px;
        }
        .gs-omc-detail-label {
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.07em;
          color: #9a8070;
        }
        .gs-omc-missing-list {
          list-style: none;
          padding: 0;
          margin: 0;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .gs-omc-missing-item {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 13px;
        }
        .gs-omc-missing-name {
          color: #2b2118;
        }
        .gs-omc-present-fields {
          margin: 0;
          font-size: 12px;
          color: #9a8070;
          line-height: 1.6;
        }
        .gs-omc-status {
          font-size: 12px;
          font-weight: 650;
          display: inline-block;
          white-space: nowrap;
        }
        .gs-omc-status-calibrated { color: #2b6b3a; }
        .gs-omc-status-partial { color: #7a5c2b; }
        .gs-omc-status-inferred { color: #5c4e8a; }
        .gs-omc-status-missing { color: #8a3a1a; }
        .gs-omc-priority {
          font-size: 11px;
          font-weight: 700;
          display: inline-block;
          white-space: nowrap;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          min-width: 52px;
        }
        .gs-omc-priority-critical { color: #8a1a1a; }
        .gs-omc-priority-high { color: #8a3a1a; }
        .gs-omc-priority-medium { color: #7a5c2b; }
      `}</style>

      <div className="gs-omc-header">
        <h3 className="gs-omc-title">Operating Model Completeness</h3>
        <p className="gs-omc-subtitle">{overallCompleteness}% of required inputs calibrated</p>
        <p className="gs-omc-summary">
          <strong>{presentTotal} of {totalRequired}</strong> required inputs calibrated.{" "}
          {needsAttention > 0 ? (
            <span className="gs-omc-attention">
              {needsAttention} section{needsAttention !== 1 ? "s" : ""} need{needsAttention === 1 ? "s" : ""} attention.
            </span>
          ) : (
            "All sections calibrated."
          )}
          {calibratedCount > 0 && needsAttention > 0 && (
            <> {calibratedCount} section{calibratedCount !== 1 ? "s are" : " is"} fully calibrated.</>
          )}
        </p>
      </div>

      <div className="gs-omc-sections">
        {sections.map((section) => (
          <SectionRow key={section.key} section={section} />
        ))}
      </div>
    </div>
  );
}
