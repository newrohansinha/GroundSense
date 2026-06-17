import { useRef, useState } from "react";
import type { DomainKey, DomainRow, ValidationReport } from "../../services/calibration/types";
import { getDomain } from "../../services/calibration/calibrationDomains";
import { parseCsv, validateCsvRows } from "../../services/calibration/csvImportService";
import { previewDedupe } from "../../services/calibration/calibrationStore";
import { downloadTemplate, getSampleRows } from "../../services/calibration/csvTemplateService";

type CsvImportPanelProps = {
  domain: DomainKey;
  existingRows?: DomainRow[];
  onApply: (rows: DomainRow[]) => Promise<{ added: number; replaced: number; beforeScore: number; afterScore: number }>;
  // Optional: fired after a successful apply so callers (e.g. onboarding) can
  // persist durable upload metadata.
  onUploaded?: (meta: { fileName: string; rowCount: number; status: string }) => void;
};

type PreviewState = {
  fileName: string;
  report: ValidationReport;
  rawRows: Record<string, unknown>[];
};

export default function CsvImportPanel({ domain, existingRows = [], onApply, onUploaded }: CsvImportPanelProps) {
  const def = getDomain(domain);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [applying, setApplying] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  function runPreview(fileName: string, rawRows: Record<string, unknown>[]) {
    const report = validateCsvRows(domain, rawRows);
    setPreview({ fileName, report, rawRows });
    setStatus(null);
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      const { rows } = parseCsv(text);
      runPreview(file.name, rows);
    };
    reader.onerror = () => setStatus("Could not read file.");
    reader.readAsText(file);
    e.target.value = "";
  }

  function loadSample() {
    runPreview(`${def.templateFile} (demo sample)`, getSampleRows(domain));
  }

  async function applyImport() {
    if (!preview) return;
    const validRows = preview.report.rowResults.filter((r) => r.valid).map((r) => r.normalized);
    if (validRows.length === 0) return;
    setApplying(true);
    try {
      const { added, replaced, beforeScore, afterScore } = await onApply(validRows);
      const total = added + replaced;
      const dedupeNote = `${added} new, ${replaced} updated`;
      const scoreNote =
        afterScore !== beforeScore
          ? ` ${def.shortLabel} reliability ${beforeScore}% → ${afterScore}%.`
          : "";
      setStatus(
        `Applied ${total} row${total === 1 ? "" : "s"} to the ${def.shortLabel} model (${dedupeNote}).${scoreNote}`
      );
      onUploaded?.({ fileName: preview.fileName, rowCount: total, status: "imported" });
      setPreview(null);
    } finally {
      setApplying(false);
    }
  }

  function discard() {
    setPreview(null);
    setStatus("Import discarded.");
  }

  const report = preview?.report;
  const dedupePreview =
    preview && report && !report.fileLevelError
      ? previewDedupe(
          domain,
          existingRows,
          report.rowResults.filter((r) => r.valid).map((r) => r.normalized)
        )
      : null;

  return (
    <div className="cc-import">
      <div className="cc-import-actions">
        <button className="cc-btn cc-btn-ghost" onClick={() => downloadTemplate(domain, false)}>
          ↓ Download template
        </button>
        <button className="cc-btn cc-btn-ghost" onClick={() => fileInputRef.current?.click()}>
          ↑ Upload CSV
        </button>
        <button className="cc-btn cc-btn-ghost" onClick={loadSample}>
          Use sample demo CSV
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv"
          style={{ display: "none" }}
          onChange={handleFile}
        />
      </div>

      <p className="cc-import-hint">
        Template: <code>{def.templateFile}</code> — required column{def.columns.filter((c) => c.required).length === 1 ? "" : "s"}:{" "}
        {def.columns.filter((c) => c.required).map((c) => c.key).join(", ") || "none"}
      </p>

      {status && <p className="cc-import-status">{status}</p>}

      {preview && report && (
        <div className="cc-preview">
          <div className="cc-preview-head">
            <span className="cc-preview-file">{preview.fileName}</span>
            {report.fileLevelError ? (
              <span className="cc-preview-error">{report.fileLevelError}</span>
            ) : (
              <span className="cc-preview-counts">
                {report.totalRows} parsed · {report.validRows} valid
                {report.invalidRows > 0 ? ` · ${report.invalidRows} need review` : ""}
                {report.warningRows > 0 ? ` · ${report.warningRows} with warnings` : ""}
                {dedupePreview
                  ? ` · ${dedupePreview.newCount} new` +
                    (dedupePreview.updateCount > 0 ? ` · ${dedupePreview.updateCount} will update existing` : "")
                  : ""}
              </span>
            )}
          </div>

          {!report.fileLevelError && (
            <>
              <div className="cc-preview-table-wrap">
                <table className="cc-preview-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Status</th>
                      {def.columns.slice(0, 5).map((c) => (
                        <th key={c.key}>{c.label}</th>
                      ))}
                      <th>Issues</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.rowResults.slice(0, 10).map((rr) => (
                      <tr key={rr.rowIndex} className={rr.valid ? "" : "cc-row-invalid"}>
                        <td>{rr.rowIndex + 1}</td>
                        <td>
                          {rr.valid ? (
                            <span className="cc-row-ok">{rr.warnings.length > 0 ? "⚠ valid" : "✓ valid"}</span>
                          ) : (
                            <span className="cc-row-bad">✗ invalid</span>
                          )}
                        </td>
                        {def.columns.slice(0, 5).map((c) => (
                          <td key={c.key}>{formatCell(rr.normalized[c.key])}</td>
                        ))}
                        <td className="cc-row-issues">
                          {[...rr.errors, ...rr.warnings].slice(0, 2).join("; ") || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {report.totalRows > 10 && (
                <p className="cc-preview-more">Showing first 10 of {report.totalRows} rows.</p>
              )}

              <div className="cc-required-check">
                {def.columns.filter((c) => c.required).map((c) => (
                  <span key={c.key} className="cc-req-ok">✓ {c.key}</span>
                ))}
              </div>

              <div className="cc-preview-actions">
                <button
                  className="cc-btn cc-btn-primary"
                  disabled={applying || report.validRows === 0}
                  onClick={applyImport}
                >
                  {applying ? "Applying…" : `Apply ${report.validRows} row${report.validRows === 1 ? "" : "s"}`}
                </button>
                <button className="cc-btn cc-btn-text" onClick={discard}>
                  Discard
                </button>
              </div>
            </>
          )}

          {report.fileLevelError && (
            <div className="cc-preview-actions">
              <button className="cc-btn cc-btn-text" onClick={discard}>
                Dismiss
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function formatCell(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "number") {
    if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
    if (Math.abs(v) >= 1_000) return `${Math.round(v / 1_000)}K`;
    return String(v);
  }
  const s = String(v);
  return s.length > 22 ? s.slice(0, 20) + "…" : s;
}
