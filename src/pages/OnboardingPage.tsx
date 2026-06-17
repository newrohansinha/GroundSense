import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useCompany } from "../context/CompanyContext";
import { useOnboardingDraft } from "../hooks/useOnboardingDraft";
import {
  getCalibrationForCompany,
  saveCalibrationForCompany,
  type CompanyCalibrationInput,
} from "../services/calibrationService";
import { useCalibrationWorkbench } from "../services/calibration/useCalibrationWorkbench";
import { CALIBRATION_DOMAINS } from "../services/calibration/calibrationDomains";
import type { DomainKey } from "../services/calibration/types";
import { updateCompany } from "../services/companyService";
import { seedCompanySignals } from "../services/companySignalSeeder";
import * as onboarding from "../services/onboardingService";
import { CALIBRATION_CENTER_CSS } from "../components/calibration/calibrationCenterStyles";
import ScalarFieldsForm, { type ScalarField } from "../components/onboarding/ScalarFieldsForm";
import CalibrationDomainStep, { type UploadInfo } from "../components/onboarding/CalibrationDomainStep";
import "../components/onboarding/onboarding.css";

type StepKey =
  | "welcome" | "company_profile" | "financial" | "freight" | "supplier"
  | "crm" | "inventory" | "competitive" | "outcomes" | "assumptions" | "summary";

type StepDef = {
  key: StepKey;
  navLabel: string;
  eyebrow: string;
  title: string;
  purpose: string;
  domain?: DomainKey;
  helper: { why: string; where?: string; affects?: string; csv?: string };
};

const STEPS: StepDef[] = [
  {
    key: "welcome", navLabel: "Overview", eyebrow: "Setup", title: "Set up GroundSense for your company",
    purpose: "GroundSense turns external shocks into company-specific dollar exposure using your operating data. Enter key values manually or upload CSVs — you can skip any step and refine it later from Calibration.",
    helper: { why: "Each step maps to a calibration domain that grounds a different part of the exposure model." },
  },
  {
    key: "company_profile", navLabel: "Company", eyebrow: "Stage 1", title: "Company profile",
    purpose: "Frames source matching, exposure logic, and operating assumptions.",
    helper: {
      why: "Used to frame which external events matter and how exposure is modeled.",
      where: "Company website, annual report, or finance summary.",
      affects: "Source matching, segment exposure, operating assumptions.",
    },
  },
  {
    key: "financial", navLabel: "Financial", eyebrow: "Stage 2", title: "Financial anchors",
    purpose: "Revenue, margin, and spend anchors. These anchor every percentage-based exposure estimate.",
    domain: "financial",
    helper: {
      why: "Anchors all percentage-based exposure estimates and margin sensitivity.",
      where: "Finance exports, ERP financial reports, FP&A models, annual planning sheets.",
      affects: "Every % exposure estimate, margin sensitivity, scenario editor.",
      csv: "financial_anchor_template.csv — period, revenue, gross_margin_pct, freight_spend, commodity_spend…",
    },
  },
  {
    key: "freight", navLabel: "Freight", eyebrow: "Stage 3", title: "Freight & logistics",
    purpose: "Lane-level freight spend, spot/contract split, and surcharge exposure.",
    domain: "freight",
    helper: {
      why: "Replaces inferred freight assumptions with real lane economics.",
      where: "TMS exports, carrier invoices, freight audit tools, lane-level spend files.",
      affects: "Freight risk estimate, logistics action ROI, surcharge validation, exposure graph.",
      csv: "freight_lane_template.csv — lane_name, annual_spend, spot_or_contract, surcharge_exposed…",
    },
  },
  {
    key: "supplier", navLabel: "Supplier", eyebrow: "Stage 4", title: "Supplier / procurement",
    purpose: "Supplier country-of-origin, tariff exposure, pass-through, and open PO exposure.",
    domain: "supplier",
    helper: {
      why: "Grounds tariff/steel exposure in real supplier data instead of inference.",
      where: "ERP procurement exports, supplier master data, AP spend reports, PO exports.",
      affects: "Tariff/steel operating change, procurement action, supplier exposure, source validation.",
      csv: "supplier_procurement_template.csv — supplier_name, country_of_origin, annual_spend, tariff_exposed…",
    },
  },
  {
    key: "crm", navLabel: "Customer", eyebrow: "Stage 5", title: "Customer / CRM",
    purpose: "Segment pipeline, quote/order growth, and account-level demand evidence.",
    domain: "crm",
    helper: {
      why: "Without demand evidence, construction/demand opportunities stay blocked and won't be promoted.",
      where: "CRM exports, quote/order systems, sales pipeline reports, revenue dashboards.",
      affects: "Demand opportunity promotion, customer/revenue model, commercial upside validation.",
      csv: "crm_demand_template.csv — segment, account_name, quote_volume_change_pct, order_growth_pct…",
    },
  },
  {
    key: "inventory", navLabel: "Inventory", eyebrow: "Stage 6", title: "Inventory & service levels",
    purpose: "Inventory value, fill rate, backorders, and supplier lead-time exposure.",
    domain: "inventory",
    helper: {
      why: "Sizes service-level and supply-disruption exposure.",
      where: "ERP inventory reports, WMS, service-level dashboards, supply planning exports.",
      affects: "Service-level risks, disruption exposure, working-capital exposure.",
      csv: "inventory_service_template.csv — product_category, inventory_value, fill_rate_pct, backorder_rate_pct…",
    },
  },
  {
    key: "competitive", navLabel: "Competitive", eyebrow: "Stage 7", title: "Competitive / win-loss",
    purpose: "Win/loss outcomes, price gaps, and account-displacement signals.",
    domain: "competitive",
    helper: {
      why: "Sizes competitive pressure and account-retention exposure.",
      where: "CRM win/loss exports, sales notes, competitive intel, RevOps reports.",
      affects: "Competitive pressure issues, account retention exposure, pricing strategy.",
      csv: "competitive_win_loss_template.csv — competitor_name, win_loss, deal_value, price_gap_pct…",
    },
  },
  {
    key: "outcomes", navLabel: "Outcomes", eyebrow: "Stage 8", title: "Outcomes & accuracy",
    purpose: "Resolved forecast outcomes that train future model accuracy.",
    domain: "outcomes",
    helper: {
      why: "Builds forecast accuracy history and improves future confidence scoring.",
      where: "Post-mortems, finance actuals, project trackers, forecast reviews.",
      affects: "Forecast accuracy, model calibration, board credibility.",
      csv: "forecast_outcomes_template.csv — issue_title, predicted_mid, actual_impact, protected_value…",
    },
  },
  {
    key: "assumptions", navLabel: "Assumptions", eyebrow: "Stage 9", title: "Review assumptions",
    purpose: "These inferred assumptions fill gaps until you provide company data. Accept them for now or replace with your own values — they stay visible in audit views and can be changed later from Calibration.",
    helper: {
      why: "Inferred assumptions keep estimates running where data is missing; replacing them improves accuracy.",
      where: "Procurement, logistics, and commercial teams usually hold these rates.",
      affects: "Tariff/freight exposure %, pass-through, repricing lag, demand capture.",
    },
  },
  {
    key: "summary", navLabel: "Finish", eyebrow: "Stage 10", title: "You're ready",
    purpose: "Here's what GroundSense can produce with your current calibration. You can finish later and keep refining from Calibration any time.",
    helper: { why: "Finishing opens your company-scoped dashboard. Nothing runs automatically." },
  },
];

const FINANCIAL_FIELDS: ScalarField[] = [
  { key: "annual_revenue", label: "Annual revenue", unit: "$" },
  { key: "gross_margin_pct", label: "Gross margin", unit: "%" },
  { key: "cogs", label: "COGS", unit: "$" },
  { key: "freight_spend", label: "Freight spend", unit: "$" },
  { key: "steel_spend", label: "Steel-linked spend", unit: "$" },
  { key: "copper_spend", label: "Copper-linked spend", unit: "$" },
  { key: "aluminum_spend", label: "Aluminum-linked spend", unit: "$" },
  { key: "inventory_days", label: "Inventory days", unit: "days" },
  { key: "manufacturing_revenue", label: "Manufacturing revenue", unit: "$" },
  { key: "construction_revenue", label: "Construction revenue", unit: "$" },
  { key: "utilities_revenue", label: "Utilities revenue", unit: "$" },
  { key: "industrial_maintenance_revenue", label: "Ind. maintenance revenue", unit: "$" },
];

const ASSUMPTION_FIELDS: ScalarField[] = [
  { key: "steel_import_exposure_pct", label: "Steel import-exposed", unit: "%" },
  { key: "copper_import_exposure_pct", label: "Copper import-exposed", unit: "%" },
  { key: "aluminum_import_exposure_pct", label: "Aluminum import-exposed", unit: "%" },
  { key: "pass_through_coverage_pct", label: "Supplier pass-through", unit: "%" },
  { key: "average_repricing_lag_days", label: "Repricing lag", unit: "days" },
  { key: "freight_contract_coverage_pct", label: "Freight contract coverage", unit: "%" },
  { key: "freight_spot_rate_exposure_pct", label: "Freight spot exposure", unit: "%" },
  { key: "quote_win_rate_pct", label: "Quote win rate", unit: "%" },
  { key: "customer_churn_rate_pct", label: "Customer churn rate", unit: "%" },
  { key: "backorder_rate_pct", label: "Backorder rate", unit: "%" },
  { key: "expedite_premium_pct", label: "Expedite premium", unit: "%" },
  { key: "average_supplier_lead_time_days", label: "Supplier lead time", unit: "days" },
];

const ALL_CALIB_KEYS = [...FINANCIAL_FIELDS, ...ASSUMPTION_FIELDS].map((f) => String(f.key));

function num(raw: string): number | null {
  if (raw == null) return null;
  const cleaned = String(raw).replace(/[$,%\s]/g, "");
  if (cleaned === "") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export default function OnboardingPage() {
  const navigate = useNavigate();
  const { company, refresh, setupError, loading: companyLoading } = useCompany();
  const companyId = company?.id ?? null;

  const [stepIndex, setStepIndex] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [baseCalibration, setBaseCalibration] = useState<CompanyCalibrationInput | null>(null);

  // Durable per-step draft (onboarding_answers) — the source of truth for the
  // form so values survive stage changes, refresh, route changes, and re-login.
  const draft = useOnboardingDraft(companyId);
  const wb = useCalibrationWorkbench(companyId, baseCalibration);

  // ── One-time baseline load (never clobbers the draft) ─────────────────────
  // Only loads the durable calibration (fallback display) + the saved current
  // step. Form values come from the draft, so this can't wipe in-progress edits
  // even if the company object identity changes.
  // One-time baseline load. Do NOT gate state updates on an `active` cleanup
  // flag — under StrictMode the surviving fetch would otherwise never set
  // `loaded`, leaving the step stuck on "Loading…". The ref dedupes the fetch.
  const baselineLoaded = useRef(false);
  useEffect(() => {
    if (!companyId || baselineLoaded.current) return;
    baselineLoaded.current = true;
    (async () => {
      const [calib, session] = await Promise.all([
        getCalibrationForCompany(companyId).catch(() => null),
        onboarding.getSession(companyId).catch(() => null),
      ]);
      if (calib) setBaseCalibration(calib as CompanyCalibrationInput);
      const idx = STEPS.findIndex((s) => s.key === session?.current_step);
      if (idx > 0) setStepIndex(idx);
      setLoaded(true);
    })();
  }, [companyId]);

  const step = STEPS[stepIndex];
  const progressPct = Math.round((stepIndex / (STEPS.length - 1)) * 100);

  // ── Value resolvers: draft overlay first, durable store as fallback ───────
  function calibVal(stepKey: string, key: string): string {
    const d = draft.getStep(stepKey)[key];
    if (typeof d === "string") return d;
    const b = (baseCalibration as Record<string, unknown> | null)?.[key];
    return b != null ? String(b) : "";
  }
  function calibValues(fields: ScalarField[], stepKey: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const f of fields) out[String(f.key)] = calibVal(stepKey, String(f.key));
    return out;
  }
  function profileVal(key: string): string {
    const d = draft.getStep("company_profile")[key];
    if (typeof d === "string") return d;
    switch (key) {
      case "name": return company?.name ?? "";
      case "website": return company?.website ?? "";
      case "industry": return company?.industry ?? "";
      case "primary_region": return company?.primary_region ?? "";
      case "revenue_range": return company?.revenue_range ?? "";
      case "company_size": return company?.company_size ?? "";
      default: return "";
    }
  }

  function buildCalibrationInput(): CompanyCalibrationInput {
    const out: Record<string, number | null> = {};
    for (const k of ALL_CALIB_KEYS) {
      const fin = draft.getStep("financial")[k];
      const asm = draft.getStep("assumptions")[k];
      const raw = typeof fin === "string" ? fin : typeof asm === "string" ? asm : undefined;
      out[k] = raw !== undefined ? num(raw) : (((baseCalibration as Record<string, number | null> | null)?.[k]) ?? null);
    }
    return { ...(baseCalibration ?? {}), ...out } as CompanyCalibrationInput;
  }

  // Persist the current step's durable data; the draft (onboarding_answers) is
  // always flushed so nothing is lost regardless of step.
  async function persistStep(currentKey: StepKey) {
    if (!companyId) return;
    if (currentKey === "company_profile") {
      await updateCompany(companyId, {
        name: profileVal("name").trim() || company?.name || "My Company",
        website: profileVal("website").trim() || null,
        industry: profileVal("industry").trim() || null,
        primary_region: profileVal("primary_region").trim() || null,
        revenue_range: profileVal("revenue_range").trim() || null,
        company_size: profileVal("company_size").trim() || null,
      });
    } else if (currentKey === "financial" || currentKey === "assumptions") {
      const input = buildCalibrationInput();
      await saveCalibrationForCompany(companyId, input);
      setBaseCalibration(input);
    }
    await draft.flush();
  }

  async function goNext(skip = false) {
    if (!companyId) return;
    const currentKey = step.key;
    const nextStep = STEPS[Math.min(stepIndex + 1, STEPS.length - 1)];
    setSaving(true);
    try {
      if (!skip) await persistStep(currentKey);
      else await draft.flush(); // skip still saves any typed-but-unsaved draft
      await onboarding.markStep(companyId, currentKey, nextStep.key);
      setSavedNote(skip ? "Skipped" : "Saved");
      setStepIndex((i) => Math.min(i + 1, STEPS.length - 1));
      window.scrollTo({ top: 0 });
    } catch (e) {
      setSavedNote(e instanceof Error ? `Couldn't save: ${e.message}` : "Couldn't save");
    } finally {
      setSaving(false);
    }
  }

  async function goBack() {
    await draft.flush();
    const prev = STEPS[Math.max(stepIndex - 1, 0)];
    setStepIndex((i) => Math.max(i - 1, 0));
    if (companyId) await onboarding.setCurrentStep(companyId, prev.key);
    window.scrollTo({ top: 0 });
  }

  async function jumpTo(idx: number) {
    if (idx > stepIndex) return; // only go back to visited steps
    await draft.flush();
    setStepIndex(idx);
    if (companyId) await onboarding.setCurrentStep(companyId, STEPS[idx].key);
    window.scrollTo({ top: 0 });
  }

  async function finish() {
    if (!companyId) return;
    setFinishing(true);
    try {
      await persistStep("assumptions"); // flush any last calibration edits
      // Seed the signal inputs (entities + news tracking queries) the pipeline
      // needs, derived from this company's onboarding data — so the first
      // intelligence run has real queries to fetch instead of being a no-op.
      await seedCompanySignals(companyId).catch(() => undefined);
      await onboarding.completeOnboarding(companyId);
      await refresh();
      navigate("/dashboard", { replace: true });
    } catch (e) {
      setSavedNote(e instanceof Error ? e.message : "Couldn't finish");
      setFinishing(false);
    }
  }

  if (!company) {
    // Workspace setup failed (not an auth failure) → offer a retry that re-runs
    // ensureWorkspace only. Never re-calls auth.signUp.
    if (setupError && !companyLoading) {
      return (
        <div className="gs-route-loading" style={{ flexDirection: "column", gap: 14 }}>
          <span>We couldn't finish setting up your workspace.</span>
          <button className="ob-btn ob-btn-primary" onClick={() => void refresh()}>
            Retry workspace setup
          </button>
        </div>
      );
    }
    return (
      <div className="gs-route-loading"><span className="gs-spinner" />Preparing your workspace…</div>
    );
  }

  const isLast = step.key === "summary";
  const canSkip = step.key !== "welcome" && step.key !== "summary";

  return (
    <div className="ob">
      <style>{CALIBRATION_CENTER_CSS}</style>
      <div className="ob-topbar">
        <div className="ob-brand"><span className="ob-brand-dot" />GroundSense</div>
        <div className="ob-topbar-right">
          <span className="ob-topbar-co">{company.name}</span>
          <button className="ob-exit" onClick={() => navigate("/dashboard")}>Finish later</button>
        </div>
      </div>

      <div className="ob-body">
        {/* Progress rail */}
        <nav className="ob-rail">
          <div className="ob-rail-progress">
            Step {stepIndex + 1} of {STEPS.length} · {progressPct}% complete
            <div className="ob-rail-bar"><div className="ob-rail-bar-fill" style={{ width: `${progressPct}%` }} /></div>
          </div>
          <ul className="ob-step-list">
            {STEPS.map((s, i) => (
              <li key={s.key}>
                <button
                  className={`ob-step ${i === stepIndex ? "is-active" : ""} ${i < stepIndex ? "is-done" : ""}`}
                  disabled={i > stepIndex}
                  onClick={() => jumpTo(i)}
                >
                  <span className="ob-step-marker">{i < stepIndex ? "✓" : i + 1}</span>
                  {s.navLabel}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        {/* Center form */}
        <main className="ob-main">
          <p className="ob-step-eyebrow">{step.eyebrow}</p>
          <h1 className="ob-step-title">{step.title}</h1>
          <p className="ob-step-purpose">{step.purpose}</p>

          {renderStepBody()}

          <div className="ob-foot">
            <div>
              {stepIndex > 0 && (
                <button className="ob-btn ob-btn-ghost" onClick={goBack} disabled={saving || finishing}>
                  Back
                </button>
              )}
            </div>
            <div className="ob-foot-right">
              {savedNote && <span className="ob-save-state">{savedNote}</span>}
              {canSkip && (
                <button className="ob-btn-text" onClick={() => goNext(true)} disabled={saving || finishing}>
                  Skip for now
                </button>
              )}
              {isLast ? (
                <button className="ob-btn ob-btn-primary" onClick={finish} disabled={finishing}>
                  {finishing ? "Finishing…" : "Finish & open dashboard"}
                </button>
              ) : (
                <button className="ob-btn ob-btn-primary" onClick={() => goNext(false)} disabled={saving}>
                  {saving ? "Saving…" : step.key === "welcome" ? "Start setup" : "Save & continue"}
                </button>
              )}
            </div>
          </div>
        </main>

        {/* Helper panel */}
        <aside className="ob-helper">
          <div className="ob-helper-block">
            <p className="ob-helper-h">Why this matters</p>
            <p className="ob-helper-p">{step.helper.why}</p>
          </div>
          {step.helper.where && (
            <div className="ob-helper-block">
              <p className="ob-helper-h">Where to find it</p>
              <p className="ob-helper-p">{step.helper.where}</p>
            </div>
          )}
          {step.helper.affects && (
            <div className="ob-helper-block">
              <p className="ob-helper-h">What it affects</p>
              <p className="ob-helper-p">{step.helper.affects}</p>
            </div>
          )}
          {step.helper.csv && (
            <div className="ob-helper-block">
              <p className="ob-helper-h">CSV template</p>
              <p className="ob-helper-p">{step.helper.csv}</p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );

  // Renders one domain's manual+CSV body using the stable imported component
  // (no inner component definition → no remount/state-loss on re-render).
  function domainBody(domainKey: DomainKey) {
    const rows = wb.state.domains[domainKey]?.rows ?? [];
    const upload = draft.getStep(domainKey).upload as UploadInfo | undefined;
    return (
      <CalibrationDomainStep
        domain={domainKey}
        existingRows={rows}
        rowCount={rows.length}
        onApplyRows={(r, st, name) => wb.applyDomainRows(domainKey, r, st, name)}
        uploadInfo={upload && upload.status !== "removed" ? upload : undefined}
        onUploaded={(meta) => draft.setStep(domainKey, { upload: meta })}
      />
    );
  }

  function renderStepBody() {
    if ((!loaded || draft.loading) && step.key !== "welcome") {
      return <p className="ob-helper-p">Loading…</p>;
    }
    switch (step.key) {
      case "welcome":
        return <WelcomeBody />;
      case "company_profile":
        return (
          <CompanyProfileBody
            profileVal={profileVal}
            onChange={(k, v) => draft.setField("company_profile", k, v)}
          />
        );
      case "financial":
        return (
          <>
            <div className="ob-section">
              <p className="ob-section-label">Key financial anchors</p>
              <ScalarFieldsForm
                fields={FINANCIAL_FIELDS}
                values={calibValues(FINANCIAL_FIELDS, "financial")}
                onChange={(k, raw) => draft.setField("financial", k, raw)}
                columns={3}
              />
            </div>
            <div className="ob-divider-or">or upload a CSV</div>
            {domainBody("financial")}
          </>
        );
      case "assumptions":
        return (
          <div className="ob-section">
            <p className="ob-section-label">Inferred assumptions (editable)</p>
            <ScalarFieldsForm
              fields={ASSUMPTION_FIELDS}
              values={calibValues(ASSUMPTION_FIELDS, "assumptions")}
              onChange={(k, raw) => draft.setField("assumptions", k, raw)}
              columns={3}
            />
            <div className="ob-callout">
              Accepted assumptions stay visible in audit views and can be replaced any time from Calibration.
              Leave a field blank to keep GroundSense's inferred default.
            </div>
          </div>
        );
      case "summary":
        return (
          <div>
            <div className="ob-summary-stats">
              <div className="ob-stat">
                <div className="ob-stat-num">{wb.workbench.summary.modelReliability}%</div>
                <div className="ob-stat-label">Model reliability</div>
              </div>
              <div className="ob-stat">
                <div className="ob-stat-num">{wb.workbench.summary.importedDataSources}</div>
                <div className="ob-stat-label">Data sources imported</div>
              </div>
              <div className="ob-stat">
                <div className="ob-stat-num">{wb.workbench.summary.inferredAssumptions}</div>
                <div className="ob-stat-label">Inferred assumptions</div>
              </div>
            </div>

            <p className="ob-section-label">Calibration by domain</p>
            <div className="ob-summary-rows">
              {CALIBRATION_DOMAINS.map((d) => {
                const n = wb.state.domains[d.key]?.rows.length ?? 0;
                return (
                  <div className="ob-summary-row" key={d.key}>
                    <span className="ob-srk">{d.label}</span>
                    {n > 0
                      ? <span className="ob-pill ob-pill-done">{n} row{n === 1 ? "" : "s"}</span>
                      : <span className="ob-pill ob-pill-empty">Not yet added</span>}
                  </div>
                );
              })}
            </div>

            <div className="ob-callout">
              <b>Nothing runs automatically.</b> When you're ready, open the dashboard and use
              “Run intelligence update” to generate your first risks, operating changes, and
              opportunities — scoped to {company?.name}. You can keep refining calibration any time.
            </div>
          </div>
        );
      default:
        return step.domain ? domainBody(step.domain) : null;
    }
  }
}

function WelcomeBody() {
  const items = [
    ["1", "Company profile", "Industry, region, revenue band, segments."],
    ["2", "Financial anchors", "Revenue, margin, freight & commodity spend."],
    ["3", "Freight & logistics", "Lane spend, spot/contract split, surcharges."],
    ["4", "Supplier / procurement", "Country of origin, tariff exposure, open PO."],
    ["5", "Customer / CRM", "Segment pipeline, quote/order growth."],
    ["6", "Inventory & service", "Inventory value, fill rate, backorders."],
    ["7", "Competitive / win-loss", "Win/loss, price gaps, displacement."],
    ["8", "Outcomes & accuracy", "Resolved forecasts vs actuals."],
    ["9", "Assumptions review", "Accept or replace inferred defaults."],
    ["10", "Imports summary", "Review coverage and finish."],
  ];
  return (
    <div className="ob-overview-grid">
      {items.map(([n, t, d]) => (
        <div className="ob-overview-item" key={n}>
          <span className="ob-overview-num">{n}</span>
          <div>
            <p className="ob-overview-t">{t}</p>
            <p className="ob-overview-d">{d}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function CompanyProfileBody({
  profileVal, onChange,
}: {
  profileVal: (key: string) => string;
  onChange: (key: string, value: string) => void;
}) {
  // Plain element-returning helper (NOT a nested component) so inputs aren't
  // remounted on every keystroke — that would steal focus.
  const field = (k: string, label: string, ph?: string) => (
    <div key={k}>
      <label className="ob-field-label">{label}</label>
      <input className="ob-input" value={profileVal(k)} placeholder={ph} onChange={(e) => onChange(k, e.target.value)} />
    </div>
  );
  return (
    <div className="ob-section" style={{ marginBottom: 0 }}>
      <div className="ob-grid">
        {field("name", "Company name")}
        {field("website", "Website", "https://")}
        {field("industry", "Industry")}
        {field("primary_region", "Primary operating region")}
        {field("revenue_range", "Revenue band", "$100M – $500M")}
        {field("company_size", "Employee count / size")}
        {field("currency", "Reporting currency", "USD")}
        {field("fiscal_year_start", "Fiscal year start (month)", "January")}
      </div>
      <div className="ob-grid" style={{ marginTop: 14 }}>
        <div>
          <label className="ob-field-label">Main customer segments</label>
          <textarea className="ob-textarea" value={profileVal("customer_segments")}
            placeholder="Manufacturing, Construction, Utilities…"
            onChange={(e) => onChange("customer_segments", e.target.value)} />
        </div>
        <div>
          <label className="ob-field-label">Main product / service categories</label>
          <textarea className="ob-textarea" value={profileVal("product_categories")}
            placeholder="Fasteners, tools, safety…"
            onChange={(e) => onChange("product_categories", e.target.value)} />
        </div>
      </div>
    </div>
  );
}
