import { useState } from "react";
import type { DomainKey, DomainRow } from "../../services/calibration/types";
import { getDomain } from "../../services/calibration/calibrationDomains";

type ManualEntryFormProps = {
  domain: DomainKey;
  onAdd: (row: DomainRow) => Promise<void> | void;
};

// A compact manual-entry form covering the domain's key columns.
// Numbers/percents parse to numbers; booleans are checkboxes; enums are selects.
export default function ManualEntryForm({ domain, onAdd }: ManualEntryFormProps) {
  const def = getDomain(domain);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  // Show required + recommended + scoring-relevant columns to keep the form focused.
  const fields = def.columns.filter(
    (c) => c.required || c.recommended || (c.scoringWeight ?? 0) >= 1 || c.type === "boolean"
  );

  function set(key: string, value: string) {
    setForm((p) => ({ ...p, [key]: value }));
  }

  const requiredMissing = def.columns
    .filter((c) => c.required)
    .some((c) => !form[c.key] || form[c.key].trim() === "");

  async function submit() {
    const row: DomainRow = {};
    for (const col of def.columns) {
      const raw = form[col.key];
      if (raw === undefined || raw === "") {
        row[col.key] = col.type === "boolean" ? false : null;
        continue;
      }
      if (col.type === "number" || col.type === "money" || col.type === "percent") {
        const n = Number(String(raw).replace(/[$,%\s]/g, ""));
        row[col.key] = Number.isFinite(n) ? n : null;
      } else if (col.type === "boolean") {
        row[col.key] = raw === "true";
      } else {
        row[col.key] = raw;
      }
    }
    setSaving(true);
    try {
      await onAdd(row);
      setForm({});
      setOpen(false);
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button className="cc-btn cc-btn-ghost" onClick={() => setOpen(true)}>
        + Add {def.shortLabel} entry manually
      </button>
    );
  }

  return (
    <div className="cc-manual">
      <div className="cc-manual-grid">
        {fields.map((col) => (
          <div key={col.key} className="cc-manual-field">
            <label className="cc-manual-label">
              {col.label}
              {col.required && <span className="cc-req-star"> *</span>}
              {col.unit && <span className="cc-manual-unit"> ({col.unit})</span>}
            </label>
            {col.type === "boolean" ? (
              <select className="cc-manual-input" value={form[col.key] ?? "false"} onChange={(e) => set(col.key, e.target.value)}>
                <option value="false">No</option>
                <option value="true">Yes</option>
              </select>
            ) : col.type === "enum" ? (
              <select className="cc-manual-input" value={form[col.key] ?? ""} onChange={(e) => set(col.key, e.target.value)}>
                <option value="">—</option>
                {(col.enumValues ?? []).map((v) => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
            ) : (
              <input
                className="cc-manual-input"
                type={col.type === "date" ? "date" : col.type === "text" ? "text" : "text"}
                inputMode={col.type === "number" || col.type === "money" || col.type === "percent" ? "decimal" : undefined}
                value={form[col.key] ?? ""}
                onChange={(e) => set(col.key, e.target.value)}
                placeholder={col.type === "money" ? "$" : col.type === "percent" ? "%" : ""}
              />
            )}
          </div>
        ))}
      </div>
      <div className="cc-manual-actions">
        <button className="cc-btn cc-btn-primary" disabled={saving || requiredMissing} onClick={submit}>
          {saving ? "Saving…" : "Add entry"}
        </button>
        <button className="cc-btn cc-btn-text" onClick={() => { setOpen(false); setForm({}); }}>
          Cancel
        </button>
        {requiredMissing && <span className="cc-manual-hint">Fill required fields (*)</span>}
      </div>
    </div>
  );
}
