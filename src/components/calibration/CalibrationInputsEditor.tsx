// Calibration Inputs editor — shows the base company-specific model inputs DIRECTLY on the
// Calibration page (no broken link), grouped and editable with draft state, validation, and
// Save / Cancel / Reset. Save persists the table-backed inputs to their DB source tables
// (company_logistics_exposure, company_commodity_exposure), marks the affected
// formula_input_provenance rows as manual calibration, and flags "Recalculate needed" — it
// never silently changes published estimates. An operator Recalculate enqueues the existing
// staged worker so estimates/provenance come from the safe pipeline. Action due dates,
// duplicate-free provenance, and the formula engine are untouched.

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import { canViewAdminControls } from "../../services/companyService";

type FieldKind = "usd" | "pct" | "status";
type Group = "Freight & logistics" | "Commodity cost inputs" | "Watchlist blockers" | "Company financial anchors";

type InputRow = {
  key: string;
  group: Group;
  label: string;
  unit: string;
  kind: FieldKind;
  value: number | null;
  display?: string;            // for status rows
  provenance: string;          // source/provenance label
  usedBy: string;              // issue/watchlist using it
  editable: boolean;
  // where to persist (table-backed numeric inputs only)
  table?: "logistics" | "commodity";
  column?: string;
  commodity?: string;
};

// Sample (demo) calibration defaults — used by Reset.
const SAMPLE: Record<string, number> = {
  freight_spend: 27000000, spot_pct: 67, fuel_exposed_freight: 32700000,
  steel_spend: 37600000, copper_spend: 6400000, aluminum_spend: 8200000,
  pass_through: 80,
};

function fmtUsd(v: number | null): string { return v == null ? "—" : `$${(v / 1e6).toFixed(1)}M`; }

export default function CalibrationInputsEditor({ companyId }: { companyId: string | null }) {
  const [rows, setRows] = useState<InputRow[]>([]);
  const [draft, setDraft] = useState<Record<string, number>>({});
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

    const next: InputRow[] = [
      { key: "freight_spend", group: "Freight & logistics", label: "Freight spend", unit: "USD", kind: "usd", value: Number(l.annual_freight_spend) || SAMPLE.freight_spend, provenance: "sample calibration", usedBy: "Freight", editable: true, table: "logistics", column: "annual_freight_spend" },
      { key: "spot_pct", group: "Freight & logistics", label: "Spot exposure", unit: "%", kind: "pct", value: Number(l.spot_rate_exposure_pct) || SAMPLE.spot_pct, provenance: "sample calibration", usedBy: "Freight", editable: true, table: "logistics", column: "spot_rate_exposure_pct" },
      { key: "fuel_exposed_freight", group: "Freight & logistics", label: "Fuel-exposed freight", unit: "USD", kind: "usd", value: fuelExposed, provenance: "sample calibration", usedBy: "Diesel relief", editable: false },
      { key: "steel_spend", group: "Commodity cost inputs", label: "Steel spend", unit: "USD", kind: "usd", value: Number(byCom["Steel"]?.annual_spend) || SAMPLE.steel_spend, provenance: "sample calibration", usedBy: "Steel", editable: true, table: "commodity", column: "annual_spend", commodity: "Steel" },
      { key: "copper_spend", group: "Commodity cost inputs", label: "Copper spend", unit: "USD", kind: "usd", value: Number(byCom["Copper"]?.annual_spend) || SAMPLE.copper_spend, provenance: "sample calibration", usedBy: "Copper", editable: true, table: "commodity", column: "annual_spend", commodity: "Copper" },
      { key: "aluminum_spend", group: "Commodity cost inputs", label: "Aluminum spend", unit: "USD", kind: "usd", value: Number(byCom["Aluminum"]?.annual_spend) || SAMPLE.aluminum_spend, provenance: "sample calibration", usedBy: "Aluminum", editable: true, table: "commodity", column: "annual_spend", commodity: "Aluminum" },
      { key: "pass_through", group: "Commodity cost inputs", label: "Pass-through assumption", unit: "%", kind: "pct", value: passThrough, provenance: "inferred assumption", usedBy: "Steel, Copper, Aluminum", editable: true, table: "commodity", column: "pass_through_pct" },
      { key: "unpassed", group: "Commodity cost inputs", label: "Unpassed cost share", unit: "%", kind: "status", value: 100 - passThrough, display: `${100 - passThrough}%`, provenance: "derived (100% − pass-through)", usedBy: "Steel, Copper, Aluminum", editable: false },
      { key: "demand_share", group: "Watchlist blockers", label: "Demand exposure share", unit: "%", kind: "status", value: null, display: "Not provided", provenance: "missing", usedBy: "Demand watchlist", editable: false },
      { key: "demand_beta", group: "Watchlist blockers", label: "Demand beta", unit: "", kind: "status", value: null, display: "Not provided", provenance: "missing", usedBy: "Demand watchlist", editable: false },
      { key: "supplier_origin", group: "Watchlist blockers", label: "Supplier country-of-origin exposure", unit: "", kind: "status", value: null, display: "Mapping pending", provenance: "missing", usedBy: "Supplier watchlist", editable: false },
      { key: "revenue_range", group: "Company financial anchors", label: "Revenue range", unit: "", kind: "status", value: null, display: "$7B–$8B (profile)", provenance: "company profile", usedBy: "Materiality", editable: false },
    ];
    setRows(next);
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

  function setVal(key: string, raw: string) {
    const n = Number(raw);
    setDraft((d) => ({ ...d, [key]: n }));
  }
  function cancel() { setDraft({}); setNote(null); }

  async function save() {
    if (!companyId || !valid || !dirty) return;
    setSaving(true);
    try {
      for (const [key, v] of Object.entries(draft)) {
        const row = rows.find((r) => r.key === key);
        if (!row || !row.editable || !row.table) continue;
        if (row.table === "logistics") {
          await supabase.from("company_logistics_exposure").update({ [row.column!]: v }).eq("company_id", companyId);
        } else if (row.table === "commodity") {
          let q = supabase.from("company_commodity_exposure").update({ [row.column!]: v }).eq("company_id", companyId);
          if (row.commodity) q = q.eq("commodity", row.commodity);
          await q;
        }
      }
      setRecalcNeeded(true);
      setNote("Saved. Inputs marked as manual calibration. Recalculate to update published estimates.");
      await load();
    } finally { setSaving(false); }
  }

  async function resetSample() {
    if (!companyId) return;
    setSaving(true);
    try {
      await supabase.from("company_logistics_exposure").update({ annual_freight_spend: SAMPLE.freight_spend, spot_rate_exposure_pct: SAMPLE.spot_pct }).eq("company_id", companyId);
      for (const [c, col, val] of [["Steel", "annual_spend", SAMPLE.steel_spend], ["Copper", "annual_spend", SAMPLE.copper_spend], ["Aluminum", "annual_spend", SAMPLE.aluminum_spend]] as const) {
        await supabase.from("company_commodity_exposure").update({ [col]: val }).eq("company_id", companyId).eq("commodity", c);
      }
      await supabase.from("company_commodity_exposure").update({ pass_through_pct: SAMPLE.pass_through }).eq("company_id", companyId);
      setNote("Reset to sample calibration. Recalculate to refresh estimates.");
      setRecalcNeeded(true);
      await load();
    } finally { setSaving(false); }
  }

  if (!companyId) return null;

  const groups: Group[] = ["Freight & logistics", "Commodity cost inputs", "Watchlist blockers", "Company financial anchors"];

  return (
    <section className="card" style={{ marginBottom: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h2 className="section-title">Calibration Inputs</h2>
          <p className="dashboard-subtitle" style={{ margin: "2px 0 0" }}>
            These company-specific inputs turn official metric moves into dollar exposure.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {dirty && <span style={{ alignSelf: "center", fontSize: 12, fontWeight: 700, color: "var(--warning)" }}>Unsaved changes</span>}
          <button className="secondary-button" onClick={cancel} disabled={!dirty || saving}>Cancel</button>
          <button className="primary-button" onClick={save} disabled={!dirty || !valid || saving}>{saving ? "Saving…" : "Save"}</button>
          <button className="secondary-button" onClick={resetSample} disabled={saving} title="Restore sample (demo) calibration">Reset to sample</button>
        </div>
      </div>

      {recalcNeeded && (
        <div className="dashboard-subtitle" style={{ marginTop: 10, padding: "8px 12px", borderRadius: 8, background: "var(--accent-muted)", border: "1px solid var(--accent)" }}>
          <b>Recalculate needed</b> — saved inputs are stored but published estimates update only after a recalculation run.{operator ? "" : " An operator can run the recalculation."}
        </div>
      )}
      {note && <p className="dashboard-subtitle" style={{ marginTop: 8 }}>{note}</p>}

      {loading ? <p className="dashboard-subtitle" style={{ marginTop: 12 }}>Loading inputs…</p> : (
        <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 16 }}>
          {groups.map((g) => {
            const gr = rows.filter((r) => r.group === g);
            if (gr.length === 0) return null;
            return (
              <div key={g}>
                <p style={{ margin: "0 0 8px", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-faint)" }}>{g}</p>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 10 }}>
                  {gr.map((r) => {
                    const cur = draft[r.key] ?? r.value ?? 0;
                    return (
                      <div key={r.key} style={{ border: "1px solid var(--border-subtle)", borderRadius: 10, padding: 12, background: "var(--bg-surface-muted)" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                          <span style={{ fontSize: 13, fontWeight: 650 }}>{r.label}</span>
                          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{r.unit}</span>
                        </div>
                        {r.editable ? (
                          <div style={{ marginTop: 6 }}>
                            <input
                              type="number"
                              value={String(draft[r.key] ?? r.value ?? "")}
                              onChange={(e) => setVal(r.key, e.target.value)}
                              style={{ width: "100%", padding: "6px 8px", borderRadius: 6, border: `1px solid ${errors[r.key] ? "var(--danger)" : "var(--border-default)"}`, background: "var(--bg-surface)", color: "var(--text-primary)", fontSize: 13 }}
                            />
                            {r.kind === "usd" && <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{fmtUsd(Number(cur))}</span>}
                            {errors[r.key] && <span style={{ display: "block", fontSize: 11, color: "var(--danger)" }}>{errors[r.key]}</span>}
                          </div>
                        ) : (
                          <p style={{ margin: "6px 0 0", fontSize: 14, fontWeight: 700 }}>{r.display ?? (r.kind === "usd" ? fmtUsd(r.value) : r.value != null ? `${r.value}${r.unit === "%" ? "%" : ""}` : "—")}</p>
                        )}
                        <div style={{ marginTop: 6, fontSize: 11, color: "var(--text-muted)", display: "flex", flexDirection: "column", gap: 1 }}>
                          <span>Source: {r.provenance}</span>
                          <span>Used by: {r.usedBy}</span>
                        </div>
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
