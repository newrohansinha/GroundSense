// Calibration Center — calibrated model derivation + input priority rule (Part 5).
// Converts domain rows into CompanyCalibrationInput-shaped overrides so the
// Calibration Summary, ScenarioEditor, and metrics light up when data is added.
// Pure functions over domain state.

import type { CompanyCalibrationInput } from "../calibrationService";
import type { DomainRow, SourceType } from "./types";

export type DerivedValue = {
  value: number;
  sourceType: SourceType;
  sourceLabel: string;
  confidence: "high" | "medium" | "low";
};

export type DerivedCalibration = {
  overrides: Partial<CompanyCalibrationInput>;
  // Provenance per calibration key (e.g. "freight_spend" → how it was derived).
  provenance: Record<string, DerivedValue>;
};

type DomainRowsByKey = {
  freight: DomainRow[];
  supplier: DomainRow[];
  crm: DomainRow[];
  financial: DomainRow[];
  inventory: DomainRow[];
  competitive: DomainRow[];
  outcomes: DomainRow[];
};

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function sum(rows: DomainRow[], key: string): number {
  return rows.reduce((acc, r) => acc + (num(r[key]) ?? 0), 0);
}

// Spend-weighted average of `pctKey` using `spendKey` as weight.
function spendWeightedPct(rows: DomainRow[], spendKey: string, pctKey: string): number | null {
  let weighted = 0;
  let totalSpend = 0;
  for (const r of rows) {
    const spend = num(r[spendKey]) ?? 0;
    const pct = num(r[pctKey]);
    if (spend > 0 && pct !== null) {
      weighted += spend * pct;
      totalSpend += spend;
    }
  }
  return totalSpend > 0 ? weighted / totalSpend : null;
}

export function deriveFreightInputs(rows: DomainRow[]): DerivedCalibration {
  const overrides: Partial<CompanyCalibrationInput> = {};
  const provenance: Record<string, DerivedValue> = {};
  if (rows.length === 0) return { overrides, provenance };

  const totalSpend = sum(rows, "annual_spend");
  if (totalSpend > 0) {
    overrides.freight_spend = totalSpend;
    provenance.freight_spend = {
      value: totalSpend,
      sourceType: "derived",
      sourceLabel: `Imported · ${rows.length} freight lanes`,
      confidence: rows.length >= 3 ? "high" : "medium",
    };

    // Spot exposure % = spend on spot (and half of mixed) / total spend.
    const spotSpend = rows.reduce((acc, r) => {
      const spend = num(r.annual_spend) ?? 0;
      const cls = String(r.spot_or_contract ?? "").toLowerCase();
      if (cls === "spot") return acc + spend;
      if (cls === "mixed") return acc + spend * 0.5;
      return acc;
    }, 0);
    const spotPct = Math.round((spotSpend / totalSpend) * 1000) / 10;
    overrides.freight_spot_rate_exposure_pct = spotPct;
    provenance.freight_spot_rate_exposure_pct = {
      value: spotPct,
      sourceType: "derived",
      sourceLabel: "Derived from lane-level spot/contract split",
      confidence: rows.length >= 3 ? "high" : "medium",
    };

    const coverage = spendWeightedPct(rows, "annual_spend", "contract_coverage_pct");
    if (coverage !== null) {
      const cov = Math.round(coverage * 10) / 10;
      overrides.freight_contract_coverage_pct = cov;
      provenance.freight_contract_coverage_pct = {
        value: cov,
        sourceType: "derived",
        sourceLabel: "Spend-weighted lane contract coverage",
        confidence: "medium",
      };
    }
  }
  return { overrides, provenance };
}

export function deriveSupplierInputs(rows: DomainRow[]): DerivedCalibration {
  const overrides: Partial<CompanyCalibrationInput> = {};
  const provenance: Record<string, DerivedValue> = {};
  if (rows.length === 0) return { overrides, provenance };

  const byCommodity = (name: string) =>
    rows.filter((r) => String(r.commodity ?? "").toLowerCase().includes(name));

  const steel = byCommodity("steel");
  const copper = byCommodity("copper");
  const aluminum = byCommodity("alumin");

  const steelSpend = sum(steel, "annual_spend");
  if (steelSpend > 0) {
    overrides.steel_spend = steelSpend;
    provenance.steel_spend = {
      value: steelSpend,
      sourceType: "derived",
      sourceLabel: `Imported · ${steel.length} steel supplier(s)`,
      confidence: steel.length >= 2 ? "high" : "medium",
    };
    const tariffExposedSteel = steel
      .filter((r) => r.tariff_exposed === true)
      .reduce((acc, r) => acc + (num(r.annual_spend) ?? 0), 0);
    const importPct = Math.round((tariffExposedSteel / steelSpend) * 1000) / 10;
    overrides.steel_import_exposure_pct = importPct;
    provenance.steel_import_exposure_pct = {
      value: importPct,
      sourceType: "derived",
      sourceLabel: "Derived from tariff-exposed supplier spend",
      confidence: "medium",
    };
  }

  const copperSpend = sum(copper, "annual_spend");
  if (copperSpend > 0) {
    overrides.copper_spend = copperSpend;
    provenance.copper_spend = {
      value: copperSpend,
      sourceType: "derived",
      sourceLabel: `Imported · ${copper.length} copper supplier(s)`,
      confidence: "medium",
    };
  }

  const aluminumSpend = sum(aluminum, "annual_spend");
  if (aluminumSpend > 0) {
    overrides.aluminum_spend = aluminumSpend;
    provenance.aluminum_spend = {
      value: aluminumSpend,
      sourceType: "derived",
      sourceLabel: `Imported · ${aluminum.length} aluminum supplier(s)`,
      confidence: "medium",
    };
  }

  // NOTE: we deliberately do NOT derive pass_through_coverage_pct here.
  // "Supplier updated landed cost" is a different concept from "ability to pass
  // cost through to customers" — conflating them would mislead the exposure range.
  // Pass-through stays at its inferred/approved value until real pass-through data exists.
  return { overrides, provenance };
}

export function deriveFinancialInputs(rows: DomainRow[]): DerivedCalibration {
  const overrides: Partial<CompanyCalibrationInput> = {};
  const provenance: Record<string, DerivedValue> = {};
  if (rows.length === 0) return { overrides, provenance };

  // Use the latest period (last row) as the anchor.
  const anchor = rows[rows.length - 1];
  const rev = num(anchor.revenue);
  if (rev !== null) {
    overrides.annual_revenue = rev;
    provenance.annual_revenue = {
      value: rev,
      sourceType: "imported_csv",
      sourceLabel: `Financial anchor · ${anchor.period ?? "latest"}`,
      confidence: "high",
    };
  }
  const gm = num(anchor.gross_margin_pct);
  if (gm !== null) {
    overrides.gross_margin_pct = gm;
    provenance.gross_margin_pct = {
      value: gm,
      sourceType: "imported_csv",
      sourceLabel: `Financial anchor · ${anchor.period ?? "latest"}`,
      confidence: "high",
    };
  }
  const cogs = num(anchor.cogs);
  if (cogs !== null) {
    overrides.cogs = cogs;
    provenance.cogs = { value: cogs, sourceType: "imported_csv", sourceLabel: "Financial anchor", confidence: "high" };
  }
  const freightSpend = num(anchor.freight_spend);
  if (freightSpend !== null && !("freight_spend" in overrides)) {
    overrides.freight_spend = freightSpend;
    provenance.freight_spend = {
      value: freightSpend,
      sourceType: "imported_csv",
      sourceLabel: "Financial anchor (freight line)",
      confidence: "medium",
    };
  }
  return { overrides, provenance };
}

export function deriveCrmInputs(rows: DomainRow[]): DerivedCalibration {
  const overrides: Partial<CompanyCalibrationInput> = {};
  const provenance: Record<string, DerivedValue> = {};
  if (rows.length === 0) return { overrides, provenance };

  const segSum = (seg: string) =>
    rows
      .filter((r) => String(r.segment ?? "").toLowerCase().includes(seg))
      .reduce((acc, r) => acc + (num(r.revenue_current_period) ?? 0), 0);

  const mfg = segSum("manufactur");
  if (mfg > 0) {
    overrides.manufacturing_revenue = mfg;
    provenance.manufacturing_revenue = {
      value: mfg,
      sourceType: "imported_csv",
      sourceLabel: "CRM segment revenue",
      confidence: "medium",
    };
  }
  const con = segSum("construction");
  if (con > 0) {
    overrides.construction_revenue = con;
    provenance.construction_revenue = {
      value: con,
      sourceType: "imported_csv",
      sourceLabel: "CRM segment revenue",
      confidence: "medium",
    };
  }
  // Win rate proxy.
  const winRates = rows.map((r) => num(r.win_rate)).filter((n): n is number => n !== null);
  if (winRates.length > 0) {
    const avg = Math.round((winRates.reduce((a, b) => a + b, 0) / winRates.length) * 10) / 10;
    overrides.quote_win_rate_pct = avg;
    provenance.quote_win_rate_pct = {
      value: avg,
      sourceType: "imported_csv",
      sourceLabel: "CRM win rate (avg)",
      confidence: "medium",
    };
  }
  return { overrides, provenance };
}

export function deriveInventoryInputs(rows: DomainRow[]): DerivedCalibration {
  const overrides: Partial<CompanyCalibrationInput> = {};
  const provenance: Record<string, DerivedValue> = {};
  if (rows.length === 0) return { overrides, provenance };

  const fill = spendWeightedPct(rows, "inventory_value", "fill_rate_pct");
  if (fill !== null) {
    const f = Math.round(fill * 10) / 10;
    overrides.fill_rate_pct = f;
    provenance.fill_rate_pct = { value: f, sourceType: "imported_csv", sourceLabel: "Inventory value-weighted fill rate", confidence: "medium" };
  }
  const backorder = spendWeightedPct(rows, "inventory_value", "backorder_rate_pct");
  if (backorder !== null) {
    const b = Math.round(backorder * 10) / 10;
    overrides.backorder_rate_pct = b;
    provenance.backorder_rate_pct = { value: b, sourceType: "imported_csv", sourceLabel: "Inventory value-weighted backorder rate", confidence: "medium" };
  }
  return { overrides, provenance };
}

export function deriveCompetitiveInputs(rows: DomainRow[]): DerivedCalibration {
  const overrides: Partial<CompanyCalibrationInput> = {};
  const provenance: Record<string, DerivedValue> = {};
  if (rows.length === 0) return { overrides, provenance };

  const decided = rows.filter((r) => ["win", "loss"].includes(String(r.win_loss ?? "").toLowerCase()));
  if (decided.length > 0) {
    const losses = decided.filter((r) => String(r.win_loss).toLowerCase() === "loss").length;
    const lostRate = Math.round((losses / decided.length) * 1000) / 10;
    overrides.lost_quote_rate_pct = lostRate;
    provenance.lost_quote_rate_pct = {
      value: lostRate,
      sourceType: "imported_csv",
      sourceLabel: `Win/loss outcomes · ${decided.length} deals`,
      confidence: "medium",
    };
  }
  return { overrides, provenance };
}

// Merge all domains into one derived calibration patch + provenance map.
// Order matters for the input-priority rule: imported financial anchors and
// freight/supplier-derived values take precedence over inferred base.
export function deriveAllCalibration(rowsByKey: DomainRowsByKey): DerivedCalibration {
  const parts = [
    deriveFreightInputs(rowsByKey.freight),
    deriveSupplierInputs(rowsByKey.supplier),
    deriveFinancialInputs(rowsByKey.financial),
    deriveCrmInputs(rowsByKey.crm),
    deriveInventoryInputs(rowsByKey.inventory),
    deriveCompetitiveInputs(rowsByKey.competitive),
  ];

  const overrides: Partial<CompanyCalibrationInput> = {};
  const provenance: Record<string, DerivedValue> = {};
  for (const part of parts) {
    Object.assign(overrides, part.overrides);
    Object.assign(provenance, part.provenance);
  }
  return { overrides, provenance };
}

// Merge derived overrides onto a base calibration following the priority rule:
// imported/derived (workbench) wins over inferred base. Returns merged calibration.
export function mergeCalibration(
  base: CompanyCalibrationInput | null,
  derived: Partial<CompanyCalibrationInput>
): CompanyCalibrationInput {
  return { ...(base ?? {}), ...derived };
}
