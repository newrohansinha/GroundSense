// scenarioModelService.ts
// Pure computation — no Supabase, no React imports.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FreightScenarioInputs = {
  annualFreightSpend: number;      // e.g. 90_000_000
  spotExposurePct: number;          // e.g. 28 (percent, not decimal)
  contractCoveragePct: number;      // e.g. 70
  shockLowPct: number;              // e.g. 3
  shockMidPct: number;              // e.g. 7.5
  shockHighPct: number;             // e.g. 12
  mitigationPct: number;            // e.g. 20 (% of exposure mitigated by action)
  timeHorizonMonths: number;        // e.g. 12
};

export type FreightScenarioResult = {
  spotExposedSpend: number;
  exposureLow: number;
  exposureMid: number;
  exposureHigh: number;
  protectedValueIfMitigated: number;
  netExposureLow: number;
  netExposureMid: number;
  netExposureHigh: number;
  assumptions: Array<{ label: string; value: string; source: "user" | "inferred" | "demo" }>;
};

export type CommodityScenarioInputs = {
  annualCommoditySpend: number;
  importExposurePct: number;
  passThroughPct: number;
  repricingLagDays: number;
  tariffRatePct: number;
  priorTariffRatePct: number;
  shockLowPct: number;
  shockMidPct: number;
  shockHighPct: number;
};

export type CommodityScenarioResult = {
  importExposedSpend: number;
  unpassedExposedSpend: number;
  exposureLow: number;
  exposureMid: number;
  exposureHigh: number;
  tariffDeltaPct: number;
  assumptions: Array<{ label: string; value: string; source: "user" | "inferred" | "demo" }>;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pct(n: number): number {
  return n / 100;
}

function fmt(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `$${Math.round(n / 1_000)}k`;
  return `$${Math.round(n).toLocaleString()}`;
}

function fmtPct(n: number): string {
  return `${n}%`;
}

function fmtMonths(n: number): string {
  return `${n} month${n === 1 ? "" : "s"}`;
}

function fmtDays(n: number): string {
  return `${n} day${n === 1 ? "" : "s"}`;
}

// ---------------------------------------------------------------------------
// Freight scenario
// ---------------------------------------------------------------------------

export function calculateFreightScenario(inputs: FreightScenarioInputs): FreightScenarioResult {
  const {
    annualFreightSpend,
    spotExposurePct,
    shockLowPct,
    shockMidPct,
    shockHighPct,
    mitigationPct,
  } = inputs;

  const spotExposedSpend = annualFreightSpend * pct(spotExposurePct);

  const exposureLow = spotExposedSpend * pct(shockLowPct);
  const exposureMid = spotExposedSpend * pct(shockMidPct);
  const exposureHigh = spotExposedSpend * pct(shockHighPct);

  const protectedValueIfMitigated = exposureMid * pct(mitigationPct);

  const netExposureLow = exposureLow - exposureLow * pct(mitigationPct);
  const netExposureMid = exposureMid - protectedValueIfMitigated;
  const netExposureHigh = exposureHigh - exposureHigh * pct(mitigationPct);

  const assumptions: FreightScenarioResult["assumptions"] = [
    {
      label: "Annual freight spend",
      value: fmt(annualFreightSpend),
      source: annualFreightSpend === 90_000_000 ? "demo" : "user",
    },
    {
      label: "Spot rate exposure",
      value: fmtPct(spotExposurePct),
      source: spotExposurePct === 28 ? "demo" : "user",
    },
    {
      label: "Contract coverage",
      value: fmtPct(inputs.contractCoveragePct),
      source: inputs.contractCoveragePct === 70 ? "demo" : "user",
    },
    {
      label: "Shock range (low / mid / high)",
      value: `${fmtPct(shockLowPct)} / ${fmtPct(shockMidPct)} / ${fmtPct(shockHighPct)}`,
      source: "inferred",
    },
    {
      label: "Mitigation (actions taken)",
      value: fmtPct(mitigationPct),
      source: "inferred",
    },
    {
      label: "Time horizon",
      value: fmtMonths(inputs.timeHorizonMonths),
      source: "inferred",
    },
  ];

  return {
    spotExposedSpend,
    exposureLow,
    exposureMid,
    exposureHigh,
    protectedValueIfMitigated,
    netExposureLow,
    netExposureMid,
    netExposureHigh,
    assumptions,
  };
}

// ---------------------------------------------------------------------------
// Commodity scenario
// ---------------------------------------------------------------------------

export function calculateCommodityScenario(inputs: CommodityScenarioInputs): CommodityScenarioResult {
  const {
    annualCommoditySpend,
    importExposurePct,
    passThroughPct,
    tariffRatePct,
    priorTariffRatePct,
    shockLowPct,
    shockMidPct,
    shockHighPct,
  } = inputs;

  const importExposedSpend = annualCommoditySpend * pct(importExposurePct);
  const unpassedExposedSpend = importExposedSpend * (1 - pct(passThroughPct));
  const tariffDeltaPct = tariffRatePct - priorTariffRatePct;

  const exposureLow = unpassedExposedSpend * pct(shockLowPct);
  const exposureMid = unpassedExposedSpend * pct(shockMidPct);
  const exposureHigh = unpassedExposedSpend * pct(shockHighPct);

  const assumptions: CommodityScenarioResult["assumptions"] = [
    {
      label: "Annual commodity spend",
      value: fmt(annualCommoditySpend),
      source: annualCommoditySpend === 150_000_000 ? "demo" : "user",
    },
    {
      label: "Import exposure",
      value: fmtPct(importExposurePct),
      source: importExposurePct === 35 ? "demo" : "user",
    },
    {
      label: "Pass-through to customers",
      value: fmtPct(passThroughPct),
      source: passThroughPct === 80 ? "demo" : "user",
    },
    {
      label: "Repricing lag",
      value: fmtDays(inputs.repricingLagDays),
      source: inputs.repricingLagDays === 30 ? "demo" : "user",
    },
    {
      label: "Tariff rate (current vs. prior)",
      value: `${fmtPct(tariffRatePct)} vs. ${fmtPct(priorTariffRatePct)} (Δ ${tariffDeltaPct > 0 ? "+" : ""}${tariffDeltaPct}pp)`,
      source: "inferred",
    },
    {
      label: "Price shock range (low / mid / high)",
      value: `${fmtPct(shockLowPct)} / ${fmtPct(shockMidPct)} / ${fmtPct(shockHighPct)}`,
      source: "inferred",
    },
  ];

  return {
    importExposedSpend,
    unpassedExposedSpend,
    exposureLow,
    exposureMid,
    exposureHigh,
    tariffDeltaPct,
    assumptions,
  };
}

// ---------------------------------------------------------------------------
// Default inputs from calibration
// ---------------------------------------------------------------------------

export function getDefaultFreightInputs(
  calibration?: {
    freight_spend?: number | null;
    freight_spot_rate_exposure_pct?: number | null;
    freight_contract_coverage_pct?: number | null;
  } | null
): FreightScenarioInputs {
  return {
    annualFreightSpend: calibration?.freight_spend ?? 90_000_000,
    spotExposurePct: calibration?.freight_spot_rate_exposure_pct ?? 28,
    contractCoveragePct: calibration?.freight_contract_coverage_pct ?? 70,
    shockLowPct: 3,
    shockMidPct: 7.5,
    shockHighPct: 12,
    mitigationPct: 20,
    timeHorizonMonths: 12,
  };
}

export function getDefaultCommodityInputs(
  calibration?: {
    steel_spend?: number | null;
    steel_import_exposure_pct?: number | null;
    pass_through_coverage_pct?: number | null;
    average_repricing_lag_days?: number | null;
  } | null
): CommodityScenarioInputs {
  return {
    annualCommoditySpend: calibration?.steel_spend ?? 150_000_000,
    importExposurePct: calibration?.steel_import_exposure_pct ?? 35,
    passThroughPct: calibration?.pass_through_coverage_pct ?? 80,
    repricingLagDays: calibration?.average_repricing_lag_days ?? 30,
    tariffRatePct: 15,
    priorTariffRatePct: 25,
    shockLowPct: 5,
    shockMidPct: 10,
    shockHighPct: 20,
  };
}
