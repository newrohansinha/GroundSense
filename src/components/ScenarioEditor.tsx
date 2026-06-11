import { useState } from "react";

type ScenarioMode = "freight" | "commodity";

type FreightInputs = {
  annualFreightSpend: number;
  spotExposurePct: number;
  contractCoveragePct: number;
  shockLowPct: number;
  shockMidPct: number;
  shockHighPct: number;
  mitigationPct: number;
  timeHorizonMonths: number;
};

type CommodityInputs = {
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

type ScenarioEditorProps = {
  mode?: ScenarioMode;
  calibration?: {
    freight_spend?: number | null;
    freight_spot_rate_exposure_pct?: number | null;
    freight_contract_coverage_pct?: number | null;
    steel_spend?: number | null;
    steel_import_exposure_pct?: number | null;
    pass_through_coverage_pct?: number | null;
    average_repricing_lag_days?: number | null;
  } | null;
};

function fmt(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

function calcFreight(inputs: FreightInputs) {
  const spotExposedSpend = inputs.annualFreightSpend * (inputs.spotExposurePct / 100);
  const exposureLow = spotExposedSpend * (inputs.shockLowPct / 100);
  const exposureMid = spotExposedSpend * (inputs.shockMidPct / 100);
  const exposureHigh = spotExposedSpend * (inputs.shockHighPct / 100);
  const protectedValue = exposureMid * (inputs.mitigationPct / 100);
  return { spotExposedSpend, exposureLow, exposureMid, exposureHigh, protectedValue };
}

function calcCommodity(inputs: CommodityInputs) {
  const importExposedSpend = inputs.annualCommoditySpend * (inputs.importExposurePct / 100);
  const unpassedSpend = importExposedSpend * (1 - inputs.passThroughPct / 100);
  const tariffDelta = inputs.tariffRatePct - inputs.priorTariffRatePct;
  const exposureLow = unpassedSpend * (inputs.shockLowPct / 100);
  const exposureMid = unpassedSpend * (inputs.shockMidPct / 100);
  const exposureHigh = unpassedSpend * (inputs.shockHighPct / 100);
  return { importExposedSpend, unpassedSpend, tariffDelta, exposureLow, exposureMid, exposureHigh };
}

function NumInput({
  label,
  value,
  unit,
  onChange,
  source,
  min = 0,
  max = 100,
  step = 1,
}: {
  label: string;
  value: number;
  unit: string;
  onChange: (v: number) => void;
  source: "user" | "inferred" | "demo";
  min?: number;
  max?: number;
  step?: number;
}) {
  const sourceLabel = source === "user" ? "Company-provided" : source === "inferred" ? "Inferred" : "Demo";
  return (
    <div className="gs-scenario-field">
      <div className="gs-scenario-field-header">
        <label className="gs-scenario-label">{label}</label>
        <span className="gs-scenario-source">{sourceLabel}</span>
      </div>
      <div className="gs-scenario-input-row">
        <input
          type="number"
          className="gs-scenario-input"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <span className="gs-scenario-unit">{unit}</span>
      </div>
    </div>
  );
}

export default function ScenarioEditor({ mode: initialMode = "freight", calibration }: ScenarioEditorProps) {
  const [mode, setMode] = useState<ScenarioMode>(initialMode);
  const [isDirty, setIsDirty] = useState(false);

  const defaultFreight: FreightInputs = {
    annualFreightSpend: Number(calibration?.freight_spend ?? 90_000_000),
    spotExposurePct: Number(calibration?.freight_spot_rate_exposure_pct ?? 28),
    contractCoveragePct: Number(calibration?.freight_contract_coverage_pct ?? 70),
    shockLowPct: 3,
    shockMidPct: 7.5,
    shockHighPct: 12,
    mitigationPct: 20,
    timeHorizonMonths: 12,
  };

  const defaultCommodity: CommodityInputs = {
    annualCommoditySpend: Number(calibration?.steel_spend ?? 150_000_000),
    importExposurePct: Number(calibration?.steel_import_exposure_pct ?? 35),
    passThroughPct: Number(calibration?.pass_through_coverage_pct ?? 80),
    repricingLagDays: Number(calibration?.average_repricing_lag_days ?? 30),
    tariffRatePct: 15,
    priorTariffRatePct: 25,
    shockLowPct: 5,
    shockMidPct: 10,
    shockHighPct: 20,
  };

  const [freight, setFreight] = useState<FreightInputs>(defaultFreight);
  const [commodity, setCommodity] = useState<CommodityInputs>(defaultCommodity);

  function setF<K extends keyof FreightInputs>(key: K, value: FreightInputs[K]) {
    setFreight((prev) => ({ ...prev, [key]: value }));
    setIsDirty(true);
  }
  function setC<K extends keyof CommodityInputs>(key: K, value: CommodityInputs[K]) {
    setCommodity((prev) => ({ ...prev, [key]: value }));
    setIsDirty(true);
  }

  const fr = calcFreight(freight);
  const cr = calcCommodity(commodity);

  function freightSource(key: keyof typeof defaultFreight): "user" | "inferred" | "demo" {
    if (key === "annualFreightSpend" && calibration?.freight_spend) return "inferred";
    if (key === "spotExposurePct" && calibration?.freight_spot_rate_exposure_pct) return "inferred";
    if (key === "contractCoveragePct" && calibration?.freight_contract_coverage_pct) return "inferred";
    return "demo";
  }

  function commoditySource(key: keyof typeof defaultCommodity): "user" | "inferred" | "demo" {
    if (key === "annualCommoditySpend" && calibration?.steel_spend) return "inferred";
    if (key === "importExposurePct" && calibration?.steel_import_exposure_pct) return "inferred";
    if (key === "passThroughPct" && calibration?.pass_through_coverage_pct) return "inferred";
    if (key === "repricingLagDays" && calibration?.average_repricing_lag_days) return "inferred";
    return "demo";
  }

  return (
    <div className="gs-scenario-editor">
      <div className="gs-scenario-header">
        <div>
          <p className="gs-scenario-eyebrow">What-if analysis</p>
          <h3 className="gs-scenario-title">Scenario Editor</h3>
        </div>
        <div className="gs-scenario-mode-toggle">
          <button
            className={`gs-scenario-mode-btn${mode === "freight" ? " active" : ""}`}
            onClick={() => setMode("freight")}
          >
            Freight
          </button>
          <button
            className={`gs-scenario-mode-btn${mode === "commodity" ? " active" : ""}`}
            onClick={() => setMode("commodity")}
          >
            Steel / Tariff
          </button>
        </div>
      </div>

      {isDirty && (
        <div className="gs-scenario-preview-banner">
          Scenario preview — not saved to company model
        </div>
      )}

      {mode === "freight" && (
        <div className="gs-scenario-body">
          <div className="gs-scenario-inputs">
            <p className="gs-scenario-section-label">Exposure base</p>
            <NumInput
              label="Annual freight spend"
              value={freight.annualFreightSpend}
              unit="$"
              min={0}
              max={10_000_000_000}
              step={1_000_000}
              source={freightSource("annualFreightSpend")}
              onChange={(v) => setF("annualFreightSpend", v)}
            />
            <NumInput
              label="Spot-rate exposed freight"
              value={freight.spotExposurePct}
              unit="%"
              source={freightSource("spotExposurePct")}
              onChange={(v) => setF("spotExposurePct", v)}
            />
            <NumInput
              label="Contract coverage"
              value={freight.contractCoveragePct}
              unit="%"
              source={freightSource("contractCoveragePct")}
              onChange={(v) => setF("contractCoveragePct", v)}
            />
            <p className="gs-scenario-section-label" style={{ marginTop: 16 }}>Shock assumptions</p>
            <div className="gs-scenario-shock-row">
              <NumInput label="Low shock" value={freight.shockLowPct} unit="%" source="demo" min={0} max={100} step={0.5} onChange={(v) => setF("shockLowPct", v)} />
              <NumInput label="Mid shock" value={freight.shockMidPct} unit="%" source="demo" min={0} max={100} step={0.5} onChange={(v) => setF("shockMidPct", v)} />
              <NumInput label="High shock" value={freight.shockHighPct} unit="%" source="demo" min={0} max={100} step={0.5} onChange={(v) => setF("shockHighPct", v)} />
            </div>
            <NumInput
              label="Mitigation / action protection"
              value={freight.mitigationPct}
              unit="% of mid exposure"
              source="demo"
              onChange={(v) => setF("mitigationPct", v)}
            />
          </div>

          <div className="gs-scenario-results">
            <p className="gs-scenario-section-label">Live scenario output</p>
            <div className="gs-scenario-result-row">
              <span className="gs-scenario-result-label">Spot-exposed spend</span>
              <span className="gs-scenario-result-value">{fmt(fr.spotExposedSpend)}</span>
            </div>
            <div className="gs-scenario-result-divider" />
            <div className="gs-scenario-result-row gs-result-low">
              <span className="gs-scenario-result-label">Low ({freight.shockLowPct}% shock)</span>
              <span className="gs-scenario-result-value">{fmt(fr.exposureLow)}</span>
            </div>
            <div className="gs-scenario-result-row gs-result-mid">
              <span className="gs-scenario-result-label">Mid ({freight.shockMidPct}% shock)</span>
              <span className="gs-scenario-result-value">{fmt(fr.exposureMid)}</span>
            </div>
            <div className="gs-scenario-result-row gs-result-high">
              <span className="gs-scenario-result-label">High ({freight.shockHighPct}% shock)</span>
              <span className="gs-scenario-result-value">{fmt(fr.exposureHigh)}</span>
            </div>
            <div className="gs-scenario-result-divider" />
            <div className="gs-scenario-result-row gs-result-protected">
              <span className="gs-scenario-result-label">Protected if action succeeds</span>
              <span className="gs-scenario-result-value">{fmt(fr.protectedValue)}</span>
            </div>
            <div className="gs-scenario-result-row gs-result-net">
              <span className="gs-scenario-result-label">Net mid exposure after action</span>
              <span className="gs-scenario-result-value">{fmt(fr.exposureMid - fr.protectedValue)}</span>
            </div>
            <p className="gs-scenario-caveat">
              Scenario range based on inferred freight exposure. Validate lane-level spend before using for budget decisions.
            </p>
          </div>
        </div>
      )}

      {mode === "commodity" && (
        <div className="gs-scenario-body">
          <div className="gs-scenario-inputs">
            <p className="gs-scenario-section-label">Steel / commodity exposure</p>
            <NumInput
              label="Annual commodity spend"
              value={commodity.annualCommoditySpend}
              unit="$"
              min={0}
              max={10_000_000_000}
              step={1_000_000}
              source={commoditySource("annualCommoditySpend")}
              onChange={(v) => setC("annualCommoditySpend", v)}
            />
            <NumInput
              label="Import-exposed portion"
              value={commodity.importExposurePct}
              unit="%"
              source={commoditySource("importExposurePct")}
              onChange={(v) => setC("importExposurePct", v)}
            />
            <NumInput
              label="Pass-through coverage"
              value={commodity.passThroughPct}
              unit="%"
              source={commoditySource("passThroughPct")}
              onChange={(v) => setC("passThroughPct", v)}
            />
            <NumInput
              label="Repricing lag"
              value={commodity.repricingLagDays}
              unit="days"
              min={0}
              max={365}
              source={commoditySource("repricingLagDays")}
              onChange={(v) => setC("repricingLagDays", v)}
            />
            <p className="gs-scenario-section-label" style={{ marginTop: 16 }}>Tariff scenario</p>
            <div className="gs-scenario-shock-row">
              <NumInput label="Prior tariff" value={commodity.priorTariffRatePct} unit="%" source="demo" onChange={(v) => setC("priorTariffRatePct", v)} />
              <NumInput label="Current tariff" value={commodity.tariffRatePct} unit="%" source="demo" onChange={(v) => setC("tariffRatePct", v)} />
            </div>
            <div className="gs-scenario-shock-row">
              <NumInput label="Low shock" value={commodity.shockLowPct} unit="%" source="demo" step={0.5} onChange={(v) => setC("shockLowPct", v)} />
              <NumInput label="Mid shock" value={commodity.shockMidPct} unit="%" source="demo" step={0.5} onChange={(v) => setC("shockMidPct", v)} />
              <NumInput label="High shock" value={commodity.shockHighPct} unit="%" source="demo" step={0.5} onChange={(v) => setC("shockHighPct", v)} />
            </div>
          </div>

          <div className="gs-scenario-results">
            <p className="gs-scenario-section-label">Live scenario output</p>
            <div className="gs-scenario-result-row">
              <span className="gs-scenario-result-label">Import-exposed spend</span>
              <span className="gs-scenario-result-value">{fmt(cr.importExposedSpend)}</span>
            </div>
            <div className="gs-scenario-result-row">
              <span className="gs-scenario-result-label">Unpassed exposure base</span>
              <span className="gs-scenario-result-value">{fmt(cr.unpassedSpend)}</span>
            </div>
            <div className="gs-scenario-result-row">
              <span className="gs-scenario-result-label">Tariff delta</span>
              <span className="gs-scenario-result-value">{cr.tariffDelta > 0 ? "+" : ""}{cr.tariffDelta.toFixed(1)} ppts</span>
            </div>
            <div className="gs-scenario-result-divider" />
            <div className="gs-scenario-result-row gs-result-low">
              <span className="gs-scenario-result-label">Low ({commodity.shockLowPct}%)</span>
              <span className="gs-scenario-result-value">{fmt(cr.exposureLow)}</span>
            </div>
            <div className="gs-scenario-result-row gs-result-mid">
              <span className="gs-scenario-result-label">Mid ({commodity.shockMidPct}%)</span>
              <span className="gs-scenario-result-value">{fmt(cr.exposureMid)}</span>
            </div>
            <div className="gs-scenario-result-row gs-result-high">
              <span className="gs-scenario-result-label">High ({commodity.shockHighPct}%)</span>
              <span className="gs-scenario-result-value">{fmt(cr.exposureHigh)}</span>
            </div>
            <p className="gs-scenario-caveat">
              Evidence-backed tariff rate change. Exposure base remains inferred from company model. Country-of-origin and PO-level data would improve accuracy.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
