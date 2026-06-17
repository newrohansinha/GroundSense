import type { DomainKey, DomainRow, DomainScore, ImpactPreview, SourceType } from "../../services/calibration/types";
import { getDomain } from "../../services/calibration/calibrationDomains";
import CsvImportPanel from "./CsvImportPanel";
import ManualEntryForm from "./ManualEntryForm";
import CalibrationImpactPreview from "./CalibrationImpactPreview";

type CalibrationDomainTabProps = {
  domain: DomainKey;
  score: DomainScore;
  impact: ImpactPreview;
  rows: DomainRow[];
  onApply: (rows: DomainRow[], sourceType: SourceType, sourceName: string) => Promise<{ added: number; replaced: number; beforeScore: number; afterScore: number }>;
  onReset: () => void;
};

function reliabilityClass(score: number): string {
  if (score >= 55) return "cc-rel-high";
  if (score >= 25) return "cc-rel-mid";
  return "cc-rel-low";
}

function fmtCell(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "number") {
    if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
    if (Math.abs(v) >= 1_000) return `${Math.round(v / 1_000)}K`;
    return String(v);
  }
  const s = String(v);
  return s.length > 24 ? s.slice(0, 22) + "…" : s;
}

export default function CalibrationDomainTab({
  domain,
  score,
  impact,
  rows,
  onApply,
  onReset,
}: CalibrationDomainTabProps) {
  const def = getDomain(domain);
  const tableCols = def.columns.slice(0, 6);

  return (
    <div className="cc-domain-tab">
      {/* A. Current model */}
      <div className="cc-domain-header">
        <div>
          <h4 className="cc-domain-title">{def.label}</h4>
          <p className="cc-domain-blurb">{def.blurb}</p>
        </div>
        <div className="cc-domain-score">
          <span className={`cc-domain-pct ${reliabilityClass(score.score)}`}>{score.score}%</span>
          <span className="cc-domain-rel">{score.reliabilityLabel}</span>
        </div>
      </div>

      <div className="cc-domain-meta">
        <div className="cc-domain-meta-item">
          <span className="cc-meta-label">Basis</span>
          <span className="cc-meta-value">{score.basis}</span>
        </div>
        <div className="cc-domain-meta-item">
          <span className="cc-meta-label">Calibrated inputs</span>
          <span className="cc-meta-value">{score.inputsCalibrated} of {score.inputsRequired}</span>
        </div>
        <div className="cc-domain-meta-item">
          <span className="cc-meta-label">Data sources</span>
          <span className="cc-meta-value">{score.sourceCount}</span>
        </div>
        <div className="cc-domain-meta-item">
          <span className="cc-meta-label">Affects</span>
          <span className="cc-meta-value">{def.affects.join(" · ")}</span>
        </div>
      </div>

      {score.missingInputs.length > 0 && (
        <p className="cc-domain-missing">
          <strong>Missing:</strong> {score.missingInputs.join(" · ")}
        </p>
      )}

      {/* B. Current rows */}
      {rows.length > 0 && (
        <div className="cc-domain-rows">
          <div className="cc-domain-rows-head">
            <span className="cc-domain-rows-title">{rows.length} row{rows.length === 1 ? "" : "s"} in model</span>
            <button className="cc-btn cc-btn-text cc-btn-danger" onClick={onReset}>Clear all</button>
          </div>
          <div className="cc-preview-table-wrap">
            <table className="cc-preview-table">
              <thead>
                <tr>{tableCols.map((c) => <th key={c.key}>{c.label}</th>)}</tr>
              </thead>
              <tbody>
                {rows.slice(0, 8).map((r, i) => (
                  <tr key={i}>{tableCols.map((c) => <td key={c.key}>{fmtCell(r[c.key])}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > 8 && <p className="cc-preview-more">Showing first 8 of {rows.length} rows.</p>}
        </div>
      )}

      {/* C. Manual entry */}
      <div className="cc-domain-section">
        <p className="cc-domain-section-label">Add data manually</p>
        <ManualEntryForm domain={domain} onAdd={(row) => { void onApply([row], "manual", "Manual entry"); }} />
      </div>

      {/* D. CSV import */}
      <div className="cc-domain-section">
        <p className="cc-domain-section-label">Import CSV</p>
        <CsvImportPanel
          domain={domain}
          existingRows={rows}
          onApply={(imported) => onApply(imported, "imported_csv", def.templateFile)}
        />
      </div>

      {/* E. Impact */}
      <div className="cc-domain-section">
        <CalibrationImpactPreview impact={impact} />
      </div>
    </div>
  );
}
