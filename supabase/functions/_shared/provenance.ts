// Shared, DB-driven provenance + calibration-coverage writer.
//
// SINGLE source of truth, called so manual AND scheduled intelligence runs keep
// formula_input_provenance + company_calibration_coverage in sync with the currently
// published issues. Both run types flow through the staged worker:
//   - generate-numeric-candidates (after it writes issues, during generate-risks)
//   - continue-intelligence-run finalize (manual AND scheduled staged runs; runs even
//     when generation was skipped, so the audit layer stays fresh)
//
// It is purely a TRUST/audit layer: it reads risk_register.formula_inputs that the
// generator already wrote and never touches formulas, estimates, gates, thresholds,
// or numeric_shocks. Idempotent: delete-then-insert per issue_id so reruns update
// rows in place and never duplicate.

// deno-lint-ignore-file no-explicit-any

// Seeded demo workspaces — their company exposure rows are demo_seed, not
// uploaded/calibration data. Keep in sync with the dashboard's demo set.
const DEMO_SEED_COMPANY_IDS = new Set([
  "d56259ad-c9f0-42c1-a241-167bdab6a7c6", // public demo
  "9b91cd36-7451-4252-9468-6ae6872ad4eb", // Fastenal DEV demo workspace
]);

export type ProvenanceResult = {
  ok: boolean;
  provenance_rows_written: number;
  issues: number;
  coverage_pct: number;
  error?: string;
};

// Builds the formula_input_provenance rows for one published issue from its
// persisted formula_inputs. Source typing is honest:
//   - company exposure/calibration tables -> calibration_table (demo_seed if seeded)
//   - blanket pass-through default         -> inferred_assumption
//   - external BLS/EIA/FRED metric move    -> official_metric
export function buildFormulaInputProvenanceRows(
  issue: any,
  companyId: string,
  nowIso: string,
): any[] {
  const seeded = DEMO_SEED_COMPANY_IDS.has(companyId);
  const tableSource = seeded ? "demo_seed" : "calibration_table";
  const tableSuffix = seeded ? " · demo seed" : "";
  const fi: any = issue.formula_inputs || {};
  const rid = issue.id;
  const rows: any[] = [];
  const add = (
    input_name: string, input_label: string, input_value: unknown, unit: string,
    source_type: string, source_label: string, confidence: string, notes: string,
  ) => {
    if (input_value === undefined || input_value === null || Number.isNaN(Number(input_value))) return;
    rows.push({
      company_id: companyId, issue_id: rid, issue_key: issue.issue_key,
      input_name, input_label, input_value: Number(input_value), unit,
      source_type, source_label, last_validated_at: nowIso,
      owner: issue.owner ?? null, confidence, notes,
    });
  };
  const commodityLabel = (issue.affected_commodities && issue.affected_commodities[0])
    ? `${String(issue.affected_commodities[0]).toLowerCase()} spend`
    : "commodity spend";

  add("freight_spend", "freight spend", fi.freight_spend, "usd", tableSource, "company_logistics_exposure" + tableSuffix, "medium", seeded ? "Seeded demo freight spend." : "From company_logistics_exposure.");
  add("spot_exposure_pct", "spot %", fi.spot_exposure_pct, "pct", tableSource, "company_logistics_exposure" + tableSuffix, "medium", "Spot-rate exposure share of freight spend.");
  add("commodity_spend", commodityLabel, fi.commodity_spend, "usd", tableSource, "company_commodity_exposure" + tableSuffix, "medium", seeded ? "Seeded demo company spend." : "From company_commodity_exposure.");
  add("unpassed_share", "unpassed %", fi.unpassed_share, "share", "inferred_assumption", `default ${fi.pass_through_pct ?? 80}% pass-through (blanket assumption)`, "low", "Derived from a blanket pass-through default, not per-supplier contract data.");
  add("fuel_exposed_freight", "fuel-exposed freight", fi.fuel_exposed_freight, "usd", tableSource, "fuel-sensitive lane base" + tableSuffix, "low", "Includes fuel-sensitive surchargeable lanes; may differ from the spot-exposed freight spend used in the Freight PPI issue.");
  add("observed_metric_change_pct", "observed metric change", fi.percent_change, "pct", "official_metric", issue.numeric_basis_source_label ?? "official metric", "high", "External official producer-price / price metric move (not a company input).");
  return rows;
}

// Recomputes company_calibration_coverage from DB-backed exposure tables only
// (never localStorage). Weighted presence of freight / supplier+commodity / CRM /
// financial domains. inputsCalibrated/inputsRequired come from the provenance rows
// just written so the persisted coverage reflects real source typing.
async function recomputeCoverage(
  db: any, companyId: string, provRows: any[],
): Promise<{ coverage_pct: number; error?: string }> {
  try {
    const tbls = ["company_logistics_exposure", "supplier_procurement_exposure", "company_commodity_exposure", "company_segment_exposure", "financial_anchors"];
    const counts = await Promise.all(tbls.map((t) => db.from(t).select("id", { count: "exact", head: true }).eq("company_id", companyId)));
    const [logc, supc, comc, segc, finc] = counts.map((r: any) => r.count || 0);
    const fr = logc > 0, su = (supc + comc) > 0, crm = segc > 0, finOk = finc > 0;
    const coveragePct = (fr ? 20 : 0) + (su ? 20 : 0) + (crm ? 20 : 0) + (finOk ? 15 : 0);
    const domainsPop = (fr ? 1 : 0) + (su ? 1 : 0) + (crm ? 1 : 0) + (finOk ? 1 : 0);
    const provCalibrated = provRows.filter((r) => r.source_type !== "inferred_assumption" && r.source_type !== "official_metric").length;
    const { error } = await db.from("company_calibration_coverage").upsert({
      company_id: companyId, coverage_pct: coveragePct, domains_populated: domainsPop, domains_total: 7,
      inputs_calibrated: provCalibrated, inputs_required: provRows.length, source: "db_exposure",
      notes: "Auto-computed after intelligence run from DB exposure tables (freight, supplier/commodity, CRM, financial).",
      computed_at: new Date().toISOString(),
    }, { onConflict: "company_id" });
    return { coverage_pct: coveragePct, error: error ? error.message : undefined };
  } catch (e) {
    return { coverage_pct: 0, error: e instanceof Error ? e.message : String(e) };
  }
}

// Reconciles provenance + coverage for ALL currently published issues of a company.
// Reads risk_register (the generator's output) — works whether or not this run
// generated new issues, so a "no material change" scheduled run still refreshes the
// audit layer for the active issues. Never throws: returns ok=false + error so the
// caller can mark the run completed_with_warnings (provenance is never silently lost).
export async function recomputeProvenanceAndCoverage(
  db: any, companyId: string,
): Promise<ProvenanceResult> {
  const nowIso = new Date().toISOString();
  try {
    const { data: issues, error: readErr } = await db
      .from("risk_register")
      .select("id, issue_key, owner, formula_inputs, numeric_basis_source_label, affected_commodities")
      .eq("company_id", companyId)
      .in("display_section", ["risk_register", "operating_changes"]);
    if (readErr) return { ok: false, provenance_rows_written: 0, issues: 0, coverage_pct: 0, error: `read risk_register: ${readErr.message}` };

    const pub = (issues ?? []).filter((i: any) => i.id);
    const issueIds = pub.map((i: any) => i.id);
    const provRows: any[] = [];
    for (const issue of pub) provRows.push(...buildFormulaInputProvenanceRows(issue, companyId, nowIso));

    // Idempotent: clear this company's published-issue provenance, then re-insert.
    // Scoped to the issue_ids we just read so we never touch other rows.
    if (issueIds.length > 0) {
      const { error: delErr } = await db.from("formula_input_provenance").delete().in("issue_id", issueIds);
      if (delErr) return { ok: false, provenance_rows_written: 0, issues: pub.length, coverage_pct: 0, error: `delete provenance: ${delErr.message}` };
    }
    if (provRows.length > 0) {
      const { error: insErr } = await db.from("formula_input_provenance").insert(provRows);
      if (insErr) return { ok: false, provenance_rows_written: 0, issues: pub.length, coverage_pct: 0, error: `insert provenance: ${insErr.message}` };
    }

    const cov = await recomputeCoverage(db, companyId, provRows);
    return {
      ok: !cov.error,
      provenance_rows_written: provRows.length,
      issues: pub.length,
      coverage_pct: cov.coverage_pct,
      error: cov.error ? `coverage: ${cov.error}` : undefined,
    };
  } catch (e) {
    return { ok: false, provenance_rows_written: 0, issues: 0, coverage_pct: 0, error: e instanceof Error ? e.message : String(e) };
  }
}
