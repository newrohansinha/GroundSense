import { useState } from "react";
import type { AssumptionRow } from "../../services/calibration/types";

function statusClass(status: AssumptionRow["status"]): string {
  switch (status) {
    case "Imported":
    case "Calibrated": return "cc-badge cc-badge-imported";
    case "Manual": return "cc-badge cc-badge-manual";
    case "Approved": return "cc-badge cc-badge-approved";
    case "Evidence-backed": return "cc-badge cc-badge-evidence";
    case "Demo": return "cc-badge cc-badge-demo";
    default: return "cc-badge cc-badge-inferred";
  }
}

function confClass(c: AssumptionRow["confidence"]): string {
  return c === "high" ? "cc-conf-high" : c === "medium" ? "cc-conf-mid" : "cc-conf-low";
}

type Props = {
  rows: AssumptionRow[];
  onReplace?: (key: string, value: number) => void;
  onApprove?: (key: string, value: number) => void;
  onReset?: (key: string) => void;
};

export default function AssumptionInventory({ rows, onReplace, onApprove, onReset }: Props) {
  const [filter, setFilter] = useState<"all" | "inferred" | "calibrated">("all");
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<string>("");

  const filtered = rows.filter((r) => {
    if (filter === "inferred") return r.status === "Inferred" || r.status === "Demo";
    if (filter === "calibrated") return r.status === "Imported" || r.status === "Calibrated" || r.status === "Manual" || r.status === "Approved";
    return true;
  });

  const inferredCount = rows.filter((r) => r.status === "Inferred" || r.status === "Demo").length;
  const calibratedCount = rows.length - inferredCount;
  const actionable = !!(onReplace || onApprove || onReset);

  function startEdit(r: AssumptionRow) {
    setEditingKey(r.key);
    setDraft(r.rawValue != null ? String(r.rawValue) : "");
  }
  function commit(key: string) {
    const v = Number(draft);
    if (Number.isFinite(v)) onReplace?.(key, v);
    setEditingKey(null);
    setDraft("");
  }
  // Imported/derived rows are driven by row data and cannot be manually overridden.
  const isLocked = (r: AssumptionRow) => r.status === "Imported" || r.status === "Calibrated";

  return (
    <div className="cc-inventory">
      <div className="cc-inventory-head">
        <div>
          <h4 className="cc-domain-title">Assumption Inventory</h4>
          <p className="cc-domain-blurb">
            Every value currently driving GroundSense exposure calculations, where it came from, and where you can replace or approve it.
          </p>
        </div>
        <div className="cc-inventory-filters">
          <button className={`cc-chip ${filter === "all" ? "cc-chip-on" : ""}`} onClick={() => setFilter("all")}>All {rows.length}</button>
          <button className={`cc-chip ${filter === "calibrated" ? "cc-chip-on" : ""}`} onClick={() => setFilter("calibrated")}>Calibrated {calibratedCount}</button>
          <button className={`cc-chip ${filter === "inferred" ? "cc-chip-on" : ""}`} onClick={() => setFilter("inferred")}>Inferred {inferredCount}</button>
        </div>
      </div>

      <div className="cc-preview-table-wrap">
        <table className="cc-inventory-table">
          <thead>
            <tr>
              <th>Assumption</th>
              <th>Value</th>
              <th>Replaced</th>
              <th>Source</th>
              <th>Confidence</th>
              <th>Used by</th>
              <th>Status</th>
              {actionable && <th>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              const editing = editingKey === r.key;
              return (
                <tr key={r.key}>
                  <td>
                    <span className="cc-inv-label">{r.label}</span>
                    <span className="cc-inv-domain">{r.domainLabel}</span>
                  </td>
                  <td className="cc-inv-value">
                    {editing ? (
                      <input
                        className="cc-inv-input"
                        type="number"
                        value={draft}
                        autoFocus
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") commit(r.key); if (e.key === "Escape") setEditingKey(null); }}
                      />
                    ) : (
                      r.value
                    )}
                  </td>
                  <td className="cc-inv-replaced">{r.replacedValue ?? "—"}</td>
                  <td className="cc-inv-source">{r.sourceLabel}</td>
                  <td><span className={confClass(r.confidence)}>{r.confidence}</span></td>
                  <td className="cc-inv-usedby">{r.usedBy.join(" · ")}</td>
                  <td><span className={statusClass(r.status)}>{r.status}</span></td>
                  {actionable && (
                    <td className="cc-inv-actions">
                      {isLocked(r) ? (
                        <span className="cc-inv-locked" title="Driven by imported data — clear the domain rows to change.">From import</span>
                      ) : editing ? (
                        <>
                          <button className="cc-btn cc-btn-text" onClick={() => commit(r.key)}>Save</button>
                          <button className="cc-btn cc-btn-text" onClick={() => setEditingKey(null)}>Cancel</button>
                        </>
                      ) : (
                        <>
                          <button className="cc-btn cc-btn-text" onClick={() => startEdit(r)}>Replace</button>
                          {onApprove && r.rawValue != null && (
                            <button className="cc-btn cc-btn-text" onClick={() => onApprove(r.key, Number(r.rawValue))}>Approve</button>
                          )}
                          {r.isOverride && onReset && (
                            <button className="cc-btn cc-btn-text cc-btn-danger" onClick={() => onReset(r.key)}>Reset</button>
                          )}
                        </>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <style>{`
        .cc-inv-input { width: 120px; padding: 4px 6px; border: 1px solid var(--border-strong); border-radius: 6px; font-size: 13px; }
        .cc-inv-replaced { font-size: 12px; color: var(--text-muted); }
        .cc-inv-actions { white-space: nowrap; display: flex; gap: 8px; align-items: center; }
        .cc-inv-locked { font-size: 11px; color: var(--text-muted); font-style: italic; }
      `}</style>
    </div>
  );
}
