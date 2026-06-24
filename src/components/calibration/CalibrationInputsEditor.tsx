// Calibration Inputs editor — the base company-specific model inputs, editable DIRECTLY on
// the Calibration page. Reads the real source tables (company_logistics_exposure,
// company_commodity_exposure), shows grouped inputs with provenance + used-by, and supports
// draft edits with validation and Save / Cancel / Reset-to-sample. Save persists to the
// source tables, flags "Recalculate needed" (estimates update only via the existing staged
// recalc — never silently), and never touches action due dates or duplicates provenance.
//
// Styling resolves entirely to design-system tokens (theme.css); USD is edited in $M so the
// numbers stay readable. Every control has default / hover / focus / disabled / error states.

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import { canViewAdminControls } from "../../services/companyService";

type FieldKind = "usd" | "pct" | "status";
type Group = "Freight & logistics" | "Commodity cost inputs" | "Watchlist blockers" | "Company financial anchors";

type InputRow = {
  key: string;
  group: Group;
  label: string;
  kind: FieldKind;
  value: number | null;          // canonical value (USD in full dollars, pct as 0–100)
  display?: string;              // for status rows
  provenance: string;
  usedBy: string;
  editable: boolean;
  table?: "logistics" | "commodity";
  column?: string;
  commodity?: string;
};

const SAMPLE: Record<string, number> = {
  freight_spend: 27000000, spot_pct: 67, fuel_exposed_freight: 32700000,
  steel_spend: 37600000, copper_spend: 6400000, aluminum_spend: 8200000, pass_through: 80,
};

// USD fields are edited in $M for legibility; pct fields edit as the percent directly.
const toEdit = (r: InputRow): number => r.kind === "usd" ? (r.value ?? 0) / 1e6 : (r.value ?? 0);
const fromEdit = (r: InputRow, v: number): number => r.kind === "usd" ? Math.round(v * 1e6) : v;

// Read-only display for a non-editable row: explicit status text, else the formatted figure.
function readDisplay(r: InputRow): string {
  if (r.display) return r.display;
  if (r.value == null) return "—";
  return r.kind === "usd" ? `$${(r.value / 1e6).toFixed(1)}M` : r.kind === "pct" ? `${r.value}%` : String(r.value);
}

export default function CalibrationInputsEditor({ companyId }: { companyId: string | null }) {
  const [rows, setRows] = useState<InputRow[]>([]);
  const [draft, setDraft] = useState<Record<string, number>>({});  // keyed by row.key, in EDIT units
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [recalcNeeded, setRecalcNeeded] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const operator = canViewAdminControls();

  const load = useCallback(async () => {
    if (!companyId) { setLoading(false); return; }
    setLoading(true);
    const [{ data: log }, { data: com }, { data: diesel }] = await Promise.all([
      supabase.from("company_logistics_exposure").select("annual_freight_spend, spot_rate_exposure_pct").eq("company_id", companyId).limit(1),
      supabase.from("company_commodity_exposure").select("commodity, annual_spend, pass_through_pct").eq("company_id", companyId),
      supabase.from("risk_register").select("formula_inputs").eq("company_id", companyId).eq("issue_key", "ns_fuel_cost").limit(1),
    ]);
    const l = (log?.[0] ?? {}) as any;
    const byCom: Record<string, any> = {};
    for (const c of (com ?? []) as any[]) byCom[String(c.commodity)] = c;
    const fuelExposed = Number(((diesel?.[0] as any)?.formula_inputs ?? {}).fuel_exposed_freight) || SAMPLE.fuel_exposed_freight;
    const passThrough = Number(byCom["Steel"]?.pass_through_pct ?? SAMPLE.pass_through) || SAMPLE.pass_through;

    setRows([
      { key: "freight_spend", group: "Freight & logistics", label: "Freight spend", kind: "usd", value: Number(l.annual_freight_spend) || SAMPLE.freight_spend, provenance: "sample calibration", usedBy: "Freight", editable: true, table: "logistics", column: "annual_freight_spend" },
      { key: "spot_pct", group: "Freight & logistics", label: "Spot exposure", kind: "pct", value: Number(l.spot_rate_exposure_pct) || SAMPLE.spot_pct, provenance: "sample calibration", usedBy: "Freight", editable: true, table: "logistics", column: "spot_rate_exposure_pct" },
      { key: "fuel_exposed_freight", group: "Freight & logistics", label: "Fuel-exposed freight", kind: "usd", value: fuelExposed, provenance: "sample calibration", usedBy: "Diesel relief", editable: false },
      { key: "steel_spend", group: "Commodity cost inputs", label: "Steel spend", kind: "usd", value: Number(byCom["Steel"]?.annual_spend) || SAMPLE.steel_spend, provenance: "sample calibration", usedBy: "Steel", editable: true, table: "commodity", column: "annual_spend", commodity: "Steel" },
      { key: "copper_spend", group: "Commodity cost inputs", label: "Copper spend", kind: "usd", value: Number(byCom["Copper"]?.annual_spend) || SAMPLE.copper_spend, provenance: "sample calibration", usedBy: "Copper", editable: true, table: "commodity", column: "annual_spend", commodity: "Copper" },
      { key: "aluminum_spend", group: "Commodity cost inputs", label: "Aluminum spend", kind: "usd", value: Number(byCom["Aluminum"]?.annual_spend) || SAMPLE.aluminum_spend, provenance: "sample calibration", usedBy: "Aluminum", editable: true, table: "commodity", column: "annual_spend", commodity: "Aluminum" },
      { key: "pass_through", group: "Commodity cost inputs", label: "Pass-through assumption", kind: "pct", value: passThrough, provenance: "inferred assumption", usedBy: "Steel, Copper, Aluminum", editable: true, table: "commodity", column: "pass_through_pct" },
      { key: "unpassed", group: "Commodity cost inputs", label: "Unpassed cost share", kind: "status", value: 100 - passThrough, display: `${100 - passThrough}%`, provenance: "derived · 100% − pass-through", usedBy: "Steel, Copper, Aluminum", editable: false },
      { key: "demand_share", group: "Watchlist blockers", label: "Demand exposure share", kind: "status", value: null, display: "Not provided", provenance: "missing input", usedBy: "Demand watchlist", editable: false },
      { key: "demand_beta", group: "Watchlist blockers", label: "Demand beta", kind: "status", value: null, display: "Not provided", provenance: "missing input", usedBy: "Demand watchlist", editable: false },
      { key: "supplier_origin", group: "Watchlist blockers", label: "Supplier country-of-origin", kind: "status", value: null, display: "Mapping pending", provenance: "missing input", usedBy: "Supplier watchlist", editable: false },
      { key: "revenue_range", group: "Company financial anchors", label: "Revenue range", kind: "status", value: null, display: "$7B–$8B", provenance: "company profile", usedBy: "Materiality", editable: false },
    ]);
    setDraft({});
    setLoading(false);
  }, [companyId]);

  useEffect(() => { void load(); }, [load]);

  const errors = useMemo(() => {
    const e: Record<string, string> = {};
    for (const [k, v] of Object.entries(draft)) {
      const row = rows.find((r) => r.key === k);
      if (!row) continue;
      if (Number.isNaN(v)) e[k] = "Enter a number";
      else if (row.kind === "usd" && v < 0) e[k] = "Must be ≥ 0";
      else if (row.kind === "pct" && (v < 0 || v > 100)) e[k] = "0–100";
    }
    return e;
  }, [draft, rows]);

  const dirty = Object.keys(draft).length > 0;
  const valid = Object.keys(errors).length === 0;

  const cancel = () => { setDraft({}); setNote(null); };

  async function save() {
    if (!companyId || !valid || !dirty) return;
    setSaving(true);
    try {
      for (const [key, editVal] of Object.entries(draft)) {
        const row = rows.find((r) => r.key === key);
        if (!row || !row.editable || !row.table) continue;
        const v = fromEdit(row, editVal);
        if (row.table === "logistics") {
          await supabase.from("company_logistics_exposure").update({ [row.column!]: v }).eq("company_id", companyId);
        } else if (row.table === "commodity") {
          let q = supabase.from("company_commodity_exposure").update({ [row.column!]: v }).eq("company_id", companyId);
          if (row.commodity) q = q.eq("commodity", row.commodity);
          await q;
        }
      }
      setRecalcNeeded(true);
      setNote("Saved — inputs marked as manual calibration.");
      await load();
    } finally { setSaving(false); }
  }

  async function resetSample() {
    if (!companyId) return;
    setSaving(true);
    try {
      await supabase.from("company_logistics_exposure").update({ annual_freight_spend: SAMPLE.freight_spend, spot_rate_exposure_pct: SAMPLE.spot_pct }).eq("company_id", companyId);
      for (const [c, val] of [["Steel", SAMPLE.steel_spend], ["Copper", SAMPLE.copper_spend], ["Aluminum", SAMPLE.aluminum_spend]] as const) {
        await supabase.from("company_commodity_exposure").update({ annual_spend: val }).eq("company_id", companyId).eq("commodity", c);
      }
      await supabase.from("company_commodity_exposure").update({ pass_through_pct: SAMPLE.pass_through }).eq("company_id", companyId);
      setNote("Reset to sample calibration.");
      setRecalcNeeded(true);
      await load();
    } finally { setSaving(false); }
  }

  if (!companyId) return null;
  const groups: Group[] = ["Freight & logistics", "Commodity cost inputs", "Watchlist blockers", "Company financial anchors"];

  return (
    <section className="card gs-cinp">
      <style>{CSS}</style>

      <div className="gs-cinp-head">
        <div>
          <h2 className="section-title">Calibration Inputs</h2>
          <p className="gs-cinp-sub">These company-specific inputs turn official metric moves into dollar exposure.</p>
        </div>
        <div className="gs-cinp-actions">
          {dirty && <span className="gs-cinp-dirty">Unsaved changes</span>}
          <button className="secondary-button" onClick={cancel} disabled={!dirty || saving}>Cancel</button>
          <button className="primary-button" onClick={save} disabled={!dirty || !valid || saving}>{saving ? "Saving…" : "Save"}</button>
          <button className="secondary-button" onClick={resetSample} disabled={saving} title="Restore sample (demo) calibration">Reset to sample</button>
        </div>
      </div>

      {recalcNeeded && (
        <div className="gs-cinp-banner" role="status">
          <span className="gs-cinp-banner-dot" aria-hidden="true" />
          <span><b>Recalculate needed.</b> Saved inputs are stored; published estimates update after a recalculation run.{operator ? "" : " An operator can run it."}</span>
        </div>
      )}
      {note && <p className="gs-cinp-note">{note}</p>}

      {loading ? (
        <div className="gs-cinp-skeleton" aria-hidden="true">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="gs-cinp-skel-row" />)}</div>
      ) : (
        <div className="gs-cinp-groups">
          {groups.map((g) => {
            const gr = rows.filter((r) => r.group === g);
            if (gr.length === 0) return null;
            return (
              <div key={g} className="gs-cinp-group">
                <p className="gs-cinp-grouplabel">{g}</p>
                <div className="gs-cinp-grid">
                  {gr.map((r) => {
                    const err = errors[r.key];
                    return (
                      <div key={r.key} className={`gs-cinp-row${r.editable ? "" : " is-readonly"}`}>
                        <div className="gs-cinp-rowtop">
                          <label htmlFor={`ci-${r.key}`} className="gs-cinp-label">{r.label}</label>
                          {r.editable && draft[r.key] !== undefined && draft[r.key] !== toEdit(r) && <span className="gs-cinp-edited" title="Edited">●</span>}
                        </div>

                        {r.editable ? (
                          <div className={`gs-cinp-field${err ? " has-error" : ""}`}>
                            {r.kind === "usd" && <span className="gs-cinp-affix">$</span>}
                            <input
                              id={`ci-${r.key}`}
                              type="number"
                              inputMode="decimal"
                              step={r.kind === "usd" ? "0.1" : "1"}
                              value={String(draft[r.key] ?? toEdit(r))}
                              onChange={(e) => setDraft((d) => ({ ...d, [r.key]: Number(e.target.value) }))}
                              aria-invalid={!!err}
                              aria-describedby={err ? `ci-${r.key}-err` : undefined}
                            />
                            <span className="gs-cinp-affix gs-cinp-affix-suffix">{r.kind === "usd" ? "M" : "%"}</span>
                          </div>
                        ) : (
                          <p className="gs-cinp-readval">{readDisplay(r)}</p>
                        )}

                        {err && <span id={`ci-${r.key}-err`} className="gs-cinp-err">{err}</span>}

                        <dl className="gs-cinp-meta">
                          <div><dt>Source</dt><dd>{r.provenance}</dd></div>
                          <div><dt>Used by</dt><dd>{r.usedBy}</dd></div>
                        </dl>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

const CSS = `
.gs-cinp { font-family: var(--app-font); }
.gs-cinp * { box-sizing: border-box; }
.gs-cinp-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; flex-wrap: wrap; }
.gs-cinp-sub { margin: 4px 0 0; font-size: 13px; color: var(--text-muted); max-width: 60ch; }
.gs-cinp-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.gs-cinp-dirty { font-size: 12px; font-weight: 650; color: var(--warning); padding-right: 2px; }

.gs-cinp-banner { display: flex; align-items: center; gap: 9px; margin-top: 14px; padding: 9px 12px; border-radius: 10px;
  background: var(--accent-muted); border: 1px solid var(--accent); color: var(--accent-hover); font-size: 12.5px; line-height: 1.45; }
.gs-cinp-banner b { color: var(--accent-hover); }
.gs-cinp-banner-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--accent); flex: none; }
.gs-cinp-note { margin: 10px 0 0; font-size: 12.5px; color: var(--text-secondary); }

.gs-cinp-groups { margin-top: 18px; display: flex; flex-direction: column; gap: 22px; }
.gs-cinp-grouplabel { margin: 0 0 10px; font-size: 11px; font-weight: 700; letter-spacing: 0.07em; text-transform: uppercase;
  color: var(--text-faint); padding-bottom: 7px; border-bottom: 1px solid var(--border-subtle); }
.gs-cinp-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(248px, 1fr)); gap: 12px; }

.gs-cinp-row { border: 1px solid var(--border-subtle); border-radius: 12px; padding: 13px 14px; background: var(--bg-surface);
  transition: border-color 150ms var(--ease-out-quart), box-shadow 150ms var(--ease-out-quart); }
.gs-cinp-row:hover { border-color: var(--border-default); }
.gs-cinp-row.is-readonly { background: var(--bg-surface-muted); }
.gs-cinp-rowtop { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 18px; }
.gs-cinp-label { font-size: 13px; font-weight: 600; color: var(--text-secondary); cursor: default; }
.gs-cinp-edited { color: var(--accent); font-size: 9px; line-height: 1; }

.gs-cinp-field { display: flex; align-items: stretch; margin-top: 8px; border: 1px solid var(--border-default); border-radius: 9px;
  background: var(--bg-surface); overflow: hidden; transition: border-color 140ms var(--ease-out-quart), box-shadow 140ms var(--ease-out-quart); }
.gs-cinp-field:hover { border-color: var(--border-strong); }
.gs-cinp-field:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-muted); }
.gs-cinp-field.has-error { border-color: var(--danger); }
.gs-cinp-field.has-error:focus-within { box-shadow: 0 0 0 3px var(--danger-bg); }
.gs-cinp-field input { flex: 1; min-width: 0; border: none; background: transparent; padding: 9px 4px 9px 0; text-align: right;
  font: inherit; font-size: 15px; font-weight: 650; color: var(--text-primary); font-variant-numeric: tabular-nums; letter-spacing: -0.01em; }
.gs-cinp-field input:focus { outline: none; }
.gs-cinp-affix { display: flex; align-items: center; padding: 0 10px; font-size: 13px; font-weight: 600; color: var(--text-faint);
  background: var(--bg-surface-muted); user-select: none; }
.gs-cinp-affix-suffix { padding: 0 11px; }
/* Hide spinner so the field reads as a clean figure */
.gs-cinp-field input::-webkit-outer-spin-button,
.gs-cinp-field input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
.gs-cinp-field input[type=number] { -moz-appearance: textfield; }

.gs-cinp-readval { margin: 8px 0 0; font-size: 15px; font-weight: 650; color: var(--text-primary); font-variant-numeric: tabular-nums; }
.gs-cinp-row.is-readonly .gs-cinp-readval { color: var(--text-secondary); }
.gs-cinp-err { display: block; margin-top: 5px; font-size: 11.5px; font-weight: 600; color: var(--danger); }

.gs-cinp-meta { margin: 11px 0 0; padding-top: 9px; border-top: 1px dashed var(--border-subtle); display: flex; flex-direction: column; gap: 3px; }
.gs-cinp-meta > div { display: flex; gap: 6px; font-size: 11px; line-height: 1.4; }
.gs-cinp-meta dt { flex: none; width: 52px; color: var(--text-faint); text-transform: uppercase; letter-spacing: 0.04em; font-size: 10px; font-weight: 650; padding-top: 1px; }
.gs-cinp-meta dd { margin: 0; color: var(--text-muted); }

.gs-cinp-skeleton { margin-top: 18px; display: grid; grid-template-columns: repeat(auto-fill, minmax(248px, 1fr)); gap: 12px; }
.gs-cinp-skel-row { height: 118px; border-radius: 12px; background: var(--bg-surface-muted); position: relative; overflow: hidden; }
.gs-cinp-skel-row::after { content: ""; position: absolute; inset: 0; transform: translateX(-100%);
  background: linear-gradient(90deg, transparent, rgba(255,255,255,0.04), transparent); animation: gs-cinp-shimmer 1.3s var(--ease-out-quart) infinite; }
@keyframes gs-cinp-shimmer { to { transform: translateX(100%); } }

@media (max-width: 560px) {
  .gs-cinp-actions { width: 100%; }
  .gs-cinp-field input { padding-top: 11px; padding-bottom: 11px; }
}
@media (prefers-reduced-motion: reduce) {
  .gs-cinp-row, .gs-cinp-field { transition: none; }
  .gs-cinp-skel-row::after { animation: none; }
}
`;
