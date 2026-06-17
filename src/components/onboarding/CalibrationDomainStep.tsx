import type { DomainKey, DomainRow } from "../../services/calibration/types";
import { getDomain } from "../../services/calibration/calibrationDomains";
import ManualEntryForm from "../calibration/ManualEntryForm";
import CsvImportPanel from "../calibration/CsvImportPanel";

type ApplyResult = { added: number; replaced: number; beforeScore: number; afterScore: number };

export type UploadInfo = { fileName: string; rowCount: number; status: string; importedAt?: string };

// One onboarding calibration domain: manual entry + CSV upload, both wired to
// the shared calibration workbench so data lands in the same place the
// Calibration Center reads. Reuses the existing CC components verbatim.
export default function CalibrationDomainStep({
  domain,
  existingRows,
  rowCount,
  onApplyRows,
  uploadInfo,
  onUploaded,
}: {
  domain: DomainKey;
  existingRows: DomainRow[];
  rowCount: number;
  onApplyRows: (rows: DomainRow[], sourceType: "manual" | "imported_csv", sourceName: string) => Promise<ApplyResult>;
  uploadInfo?: UploadInfo;
  onUploaded?: (meta: UploadInfo) => void;
}) {
  const def = getDomain(domain);

  return (
    <div>
      {uploadInfo?.fileName ? (
        <div className="ob-callout" style={{ marginTop: 0, marginBottom: 18, display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
          <span>
            ✓ Uploaded <b>{uploadInfo.fileName}</b> — {uploadInfo.rowCount} row{uploadInfo.rowCount === 1 ? "" : "s"} imported.
          </span>
          {onUploaded && (
            <button className="ob-btn-text" onClick={() => onUploaded({ fileName: "", rowCount: 0, status: "removed" })}>
              Remove
            </button>
          )}
        </div>
      ) : rowCount > 0 ? (
        <div className="ob-callout" style={{ marginTop: 0, marginBottom: 18 }}>
          {rowCount} {def.shortLabel.toLowerCase()} row{rowCount === 1 ? "" : "s"} already added to this workspace.
          Add more below or continue.
        </div>
      ) : null}

      <div className="ob-section">
        <p className="ob-section-label">Upload {def.shortLabel} CSV</p>
        <CsvImportPanel
          domain={domain}
          existingRows={existingRows}
          onApply={(rows) => onApplyRows(rows, "imported_csv", `${def.templateFile}`)}
          onUploaded={(meta) => onUploaded?.({ ...meta, importedAt: new Date().toISOString() })}
        />
      </div>

      <div className="ob-divider-or">or enter manually</div>

      <div className="ob-section" style={{ marginBottom: 0 }}>
        <ManualEntryForm
          domain={domain}
          onAdd={(row) => onApplyRows([row], "manual", `Manual ${def.shortLabel} entry`).then(() => undefined)}
        />
      </div>
    </div>
  );
}
