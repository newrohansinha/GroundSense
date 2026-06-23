import { useRef, useState } from "react";
import {
  METRIC_TEMPLATES,
  buildTemplateCsv,
  downloadMetricTemplate,
  parseAndValidate,
  applyManualMetrics,
  validMetricsFromText,
  type MetricCsvCategory,
  type MetricImportReport,
} from "../../services/sources/manualMetricImportService";

const CATEGORY_LABELS: Record<MetricCsvCategory, string> = {
  tariff: "Tariff metrics",
  freight: "Freight index metrics",
  commodity: "Commodity price metrics",
  trade_flow: "Trade flow metrics",
  macro: "Macro indicator metrics",
  company_filing: "Company filing metrics",
};

type Props = {
  companyId: string | null;
  fixedCategory?: MetricCsvCategory;
  onApplied?: () => void;
};

export default function ManualMetricImportPanel({ companyId, fixedCategory, onApplied }: Props) {
  const [category, setCategory] = useState<MetricCsvCategory>(fixedCategory ?? "tariff");
  const [report, setReport] = useState<MetricImportReport | null>(null);
  const [text, setText] = useState<string>("");
  const [fileName, setFileName] = useState<string>("");
  const [status, setStatus] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const def = METRIC_TEMPLATES[category];

  function preview(csvText: string, name: string) {
    setText(csvText);
    setFileName(name);
    setReport(parseAndValidate(category, csvText));
    setStatus(null);
  }

  function loadSample() {
    preview(buildTemplateCsv(category, true), `${def.file} (demo sample)`);
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => preview(String(reader.result ?? ""), file.name);
    reader.readAsText(file);
    e.target.value = "";
  }

  async function apply() {
    if (!companyId || !report || report.fileLevelError) return;
    const metrics = validMetricsFromText(category, text);
    if (metrics.length === 0) return;
    setApplying(true);
    try {
      const res = await applyManualMetrics(companyId, category, fileName || def.file, metrics);
      const dupNote = res.updated > 0 ? `, ${res.updated} updated` : "";
      const persistNote = res.persisted === "supabase" ? "" : " (saved locally — DB unavailable)";
      setStatus(
        `Applied ${res.added + res.updated} metric${res.added + res.updated === 1 ? "" : "s"} (${res.added} new${dupNote}). ${res.shocksCreated} numeric shock${res.shocksCreated === 1 ? "" : "s"} created from structured metrics.${persistNote}`
      );
      setReport(null);
      setText("");
      onApplied?.();
    } finally {
      setApplying(false);
    }
  }

  return (
    <div className="smi-import">
      <style>{CSS}</style>
      {!fixedCategory && (
        <div className="smi-row">
          <label className="smi-label">Metric category</label>
          <select className="smi-select" value={category} onChange={(e) => { setCategory(e.target.value as MetricCsvCategory); setReport(null); }}>
            {(Object.keys(CATEGORY_LABELS) as MetricCsvCategory[]).map((c) => (
              <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
            ))}
          </select>
        </div>
      )}

      <div className="smi-actions">
        <button className="smi-btn" onClick={() => downloadMetricTemplate(category, false)}>↓ Download template</button>
        <button className="smi-btn" onClick={() => fileRef.current?.click()}>↑ Upload CSV</button>
        <button className="smi-btn" onClick={loadSample}>Use sample demo CSV</button>
        <input ref={fileRef} type="file" accept=".csv,text/csv" style={{ display: "none" }} onChange={handleFile} />
      </div>

      <p className="smi-hint">
        Template: <code>{def.file}</code> — required: metric_key, metric_name, driver, current_value, unit, source_name
      </p>

      {status && <p className="smi-status">{status}</p>}

      {report && (
        <div className="smi-preview">
          {report.fileLevelError ? (
            <p className="smi-error">{report.fileLevelError}</p>
          ) : (
            <>
              <p className="smi-counts">
                {report.totalRows} parsed · {report.validRows} valid
                {report.invalidRows > 0 ? ` · ${report.invalidRows} need review` : ""}
              </p>
              <div className="smi-table-wrap">
                <table className="smi-table">
                  <thead>
                    <tr><th>#</th><th>Status</th><th>metric_key</th><th>driver</th><th>current</th><th>unit</th><th>source</th><th>Issues</th></tr>
                  </thead>
                  <tbody>
                    {report.rowResults.slice(0, 10).map((r) => (
                      <tr key={r.rowIndex} className={r.valid ? "" : "smi-row-bad"}>
                        <td>{r.rowIndex + 1}</td>
                        <td>{r.valid ? <span className="smi-ok">✓</span> : <span className="smi-bad">✗</span>}</td>
                        <td>{r.normalized.metric_key || "—"}</td>
                        <td>{r.normalized.driver || "—"}</td>
                        <td>{r.normalized.current_value ?? "—"}</td>
                        <td>{r.normalized.unit || "—"}</td>
                        <td>{r.normalized.source_name || "—"}</td>
                        <td className="smi-issues">{[...r.errors, ...r.warnings].slice(0, 2).join("; ") || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="smi-apply-row">
                <button className="smi-btn smi-btn-primary" disabled={applying || report.validRows === 0 || !companyId} onClick={apply}>
                  {applying ? "Applying…" : `Apply ${report.validRows} metric${report.validRows === 1 ? "" : "s"}`}
                </button>
                <button className="smi-btn smi-btn-text" onClick={() => { setReport(null); setStatus("Import discarded."); }}>Discard</button>
                <span className="smi-apply-note">Numeric shocks are derived from valid structured metrics.</span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

const CSS = `
.smi-import { font-family: Inter, ui-sans-serif, system-ui, sans-serif; color: var(--text-primary); }
.smi-row { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
.smi-label { font-size: 12px; font-weight: 650; color: var(--text-muted); }
.smi-select { font-size: 13px; padding: 6px 10px; border: 1px solid var(--border-strong); border-radius: 8px; background: var(--bg-surface); }
.smi-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 8px; }
.smi-btn { font-size: 13px; font-weight: 600; padding: 8px 12px; border-radius: 8px; border: 1px solid var(--border-default); background: var(--bg-surface); color: var(--text-primary); cursor: pointer; }
.smi-btn-primary { background: var(--accent-hover); border-color: var(--accent-hover); color: var(--text-inverse); }
.smi-btn-text { border: none; background: none; color: var(--warning); }
.smi-hint { font-size: 12px; color: var(--text-muted); margin: 4px 0 8px; }
.smi-hint code { background: var(--bg-surface-muted); padding: 1px 5px; border-radius: 4px; }
.smi-status { font-size: 13px; color: var(--success); font-weight: 600; background: var(--success-bg); border: 1px solid var(--success-border); border-radius: 8px; padding: 8px 12px; }
.smi-error { font-size: 13px; color: var(--danger); font-weight: 600; }
.smi-counts { font-size: 12px; color: var(--text-secondary); margin: 8px 0; }
.smi-table-wrap { overflow-x: auto; border: 1px solid var(--border-subtle); border-radius: 8px; }
.smi-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.smi-table th { text-align: left; padding: 6px 8px; background: var(--bg-surface-muted); color: var(--text-muted); font-weight: 650; white-space: nowrap; }
.smi-table td { padding: 6px 8px; border-top: 1px solid var(--bg-surface-muted); }
.smi-row-bad { background: var(--accent-muted); }
.smi-ok { color: var(--success); } .smi-bad { color: var(--danger); }
.smi-issues { color: var(--text-muted); }
.smi-apply-row { display: flex; align-items: center; gap: 10px; margin-top: 10px; }
.smi-apply-note { font-size: 11px; color: var(--text-muted); }
`;
