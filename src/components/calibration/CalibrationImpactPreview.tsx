import type { ImpactPreview } from "../../services/calibration/types";

export default function CalibrationImpactPreview({ impact }: { impact: ImpactPreview }) {
  return (
    <div className="cc-impact">
      <div className="cc-impact-head">
        <span className="cc-impact-title">Before / after impact</span>
        {impact.rangeDeltaPct !== null && (
          <span className={`cc-impact-delta ${impact.rangeDeltaPct < 0 ? "cc-delta-down" : "cc-delta-up"}`}>
            Range {impact.rangeDeltaPct < 0 ? "narrowed" : "changed"} {Math.abs(impact.rangeDeltaPct)}%
          </span>
        )}
      </div>

      <div className="cc-impact-cols">
        <div className="cc-impact-col">
          <div className="cc-impact-col-label">Before</div>
          {impact.beforeLines.map((l, i) => (
            <div key={i} className="cc-impact-line">
              <span className="cc-impact-line-label">{l.label}</span>
              <span className="cc-impact-line-value">{l.value}</span>
              <span className="cc-impact-line-source">{l.source}</span>
            </div>
          ))}
          <div className="cc-impact-conf">{impact.confidenceBefore}</div>
        </div>

        <div className="cc-impact-arrow">→</div>

        <div className={`cc-impact-col ${impact.hasChange ? "cc-impact-col-after" : ""}`}>
          <div className="cc-impact-col-label">After</div>
          {impact.afterLines.map((l, i) => (
            <div key={i} className="cc-impact-line">
              <span className="cc-impact-line-label">{l.label}</span>
              <span className="cc-impact-line-value">{l.value}</span>
              <span className="cc-impact-line-source">{l.source}</span>
            </div>
          ))}
          <div className="cc-impact-conf cc-impact-conf-after">{impact.confidenceAfter}</div>
        </div>
      </div>

      <p className="cc-impact-summary">{impact.summary}</p>

      {impact.remainingMissing.length > 0 && (
        <p className="cc-impact-missing">
          Still missing: {impact.remainingMissing.join(" · ")}
        </p>
      )}
    </div>
  );
}
