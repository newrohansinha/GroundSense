import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import {
  getCalibrationForCompany,
  saveCalibrationForCompany,
  type CompanyCalibrationInput,
} from "../services/calibrationService";

import "./CalibrationPage.css";

type Company = {
  id: string;
  name: string;
  industry: string | null;
  revenue_range: string | null;
};

const numberFields: Array<{
  key: keyof CompanyCalibrationInput;
  label: string;
  helper: string;
  section: string;
}> = [
  {
    key: "annual_revenue",
    label: "Annual revenue",
    helper: "Exact annual revenue. Used as the denominator for exposure sizing.",
    section: "Core financials",
  },
  {
    key: "gross_margin_pct",
    label: "Gross margin %",
    helper: "Used to convert revenue movement into gross profit or margin exposure.",
    section: "Core financials",
  },
  {
    key: "cogs",
    label: "COGS",
    helper: "Cost of goods sold if known.",
    section: "Core financials",
  },

  {
    key: "manufacturing_revenue",
    label: "Manufacturing revenue",
    helper: "Annual revenue from manufacturing customers.",
    section: "Revenue by segment",
  },
  {
    key: "construction_revenue",
    label: "Construction revenue",
    helper: "Annual revenue from construction customers.",
    section: "Revenue by segment",
  },
  {
    key: "utilities_revenue",
    label: "Utilities revenue",
    helper: "Annual revenue from utility customers.",
    section: "Revenue by segment",
  },
  {
    key: "industrial_maintenance_revenue",
    label: "Industrial maintenance revenue",
    helper: "Annual revenue from industrial maintenance customers.",
    section: "Revenue by segment",
  },

  {
    key: "steel_spend",
    label: "Steel-linked annual spend",
    helper: "Annual spend exposed to steel or steel-linked products.",
    section: "Commodity exposure",
  },
  {
    key: "steel_import_exposure_pct",
    label: "Steel import exposure %",
    helper: "Percent of steel-linked spend exposed to imports, tariffs, duties, or cross-border sourcing.",
    section: "Commodity exposure",
  },
  {
    key: "copper_spend",
    label: "Copper-linked annual spend",
    helper: "Annual spend exposed to copper or copper-intensive products.",
    section: "Commodity exposure",
  },
  {
    key: "copper_import_exposure_pct",
    label: "Copper import exposure %",
    helper: "Percent of copper-linked spend exposed to imports, tariffs, duties, or cross-border sourcing.",
    section: "Commodity exposure",
  },
  {
    key: "aluminum_spend",
    label: "Aluminum-linked annual spend",
    helper: "Annual spend exposed to aluminum or aluminum-intensive products.",
    section: "Commodity exposure",
  },
  {
    key: "aluminum_import_exposure_pct",
    label: "Aluminum import exposure %",
    helper: "Percent of aluminum-linked spend exposed to imports, tariffs, duties, or cross-border sourcing.",
    section: "Commodity exposure",
  },

  {
    key: "pass_through_coverage_pct",
    label: "Cost pass-through coverage %",
    helper: "Percent of commodity cost increases that can usually be passed to customers.",
    section: "Pricing mechanics",
  },
  {
    key: "average_repricing_lag_days",
    label: "Average repricing lag days",
    helper: "Average days between supplier cost movement and customer price update.",
    section: "Pricing mechanics",
  },

  {
    key: "freight_spend",
    label: "Annual freight spend",
    helper: "Annual freight, shipping, logistics, or transportation spend.",
    section: "Freight exposure",
  },
  {
    key: "freight_contract_coverage_pct",
    label: "Freight contract coverage %",
    helper: "Percent of freight spend protected by contracts or fixed-rate agreements.",
    section: "Freight exposure",
  },
  {
    key: "freight_spot_rate_exposure_pct",
    label: "Freight spot-rate exposure %",
    helper: "Percent of freight spend exposed to spot market price moves.",
    section: "Freight exposure",
  },

  {
    key: "quote_win_rate_pct",
    label: "Quote win rate %",
    helper: "Used to estimate competitive revenue risk.",
    section: "Commercial history",
  },
  {
    key: "lost_quote_rate_pct",
    label: "Lost quote rate %",
    helper: "Used to estimate competitor-driven revenue leakage.",
    section: "Commercial history",
  },
  {
    key: "customer_churn_rate_pct",
    label: "Customer churn rate %",
    helper: "Used to estimate customer retention exposure.",
    section: "Commercial history",
  },

  {
    key: "backorder_rate_pct",
    label: "Backorder rate %",
    helper: "Percent of orders that go into backorder.",
    section: "Service metrics",
  },
  {
    key: "backorder_cancellation_rate_pct",
    label: "Backorder cancellation rate %",
    helper: "Percent of backorders that cancel or leak.",
    section: "Service metrics",
  },
  {
    key: "fill_rate_pct",
    label: "Fill rate %",
    helper: "Actual fill rate percentage.",
    section: "Service metrics",
  },
  {
    key: "inventory_days",
    label: "Inventory days",
    helper: "Days of inventory on hand.",
    section: "Service metrics",
  },

  {
    key: "expedite_premium_pct",
    label: "Expedite premium %",
    helper: "Historical premium paid when expediting or substitute sourcing.",
    section: "Supplier metrics",
  },
  {
    key: "average_supplier_lead_time_days",
    label: "Average supplier lead time days",
    helper: "Actual average supplier lead time.",
    section: "Supplier metrics",
  },
];

function emptyForm(): CompanyCalibrationInput {
  return {
    annual_revenue: null,
    gross_margin_pct: null,
    cogs: null,

    manufacturing_revenue: null,
    construction_revenue: null,
    utilities_revenue: null,
    industrial_maintenance_revenue: null,

    steel_spend: null,
    copper_spend: null,
    aluminum_spend: null,
    freight_spend: null,

    steel_import_exposure_pct: null,
    copper_import_exposure_pct: null,
    aluminum_import_exposure_pct: null,

    pass_through_coverage_pct: null,
    average_repricing_lag_days: null,

    freight_contract_coverage_pct: null,
    freight_spot_rate_exposure_pct: null,

    quote_win_rate_pct: null,
    lost_quote_rate_pct: null,
    customer_churn_rate_pct: null,

    backorder_rate_pct: null,
    backorder_cancellation_rate_pct: null,
    expedite_premium_pct: null,
    average_supplier_lead_time_days: null,
    inventory_days: null,
    fill_rate_pct: null,

    notes: "",
  };
}

function CalibrationPage() {
  const [company, setCompany] = useState<Company | null>(null);
  const [form, setForm] = useState<CompanyCalibrationInput>(emptyForm());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);

    const { data: companies, error } = await supabase
      .from("companies")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(1);

    if (error) {
      alert(error.message);
      setLoading(false);
      return;
    }

    const latest = companies?.[0];

    if (!latest) {
      setLoading(false);
      return;
    }

    setCompany(latest);

    try {
      const calibration = await getCalibrationForCompany(latest.id);
      if (calibration) setForm({ ...emptyForm(), ...calibration });
    } catch (err: any) {
      alert(err.message || "Failed to load calibration");
    }

    setLoading(false);
  }

  function updateNumber(key: keyof CompanyCalibrationInput, value: string) {
    setForm((current) => ({
      ...current,
      [key]: value === "" ? null : Number(value),
    }));
  }

  async function save() {
  if (!company) return;

  setSaving(true);

  try {
    const saved = await saveCalibrationForCompany(company.id, form);

    console.log("Calibration page saved row:", saved);

    const reloaded = await getCalibrationForCompany(company.id);

    console.log("Calibration page reloaded row:", reloaded);

    setForm({ ...emptyForm(), ...reloaded });

    alert("Calibration saved. Go back to Dashboard and click Build Connections.");
  } catch (err: any) {
    console.error("Failed to save calibration:", err);
    alert(err.message || "Failed to save calibration");
  } finally {
    setSaving(false);
  }
}

  const sections = [...new Set(numberFields.map((field) => field.section))];

  if (loading) {
    return (
      <main className="calibration-page">
        <div className="calibration-container">Loading...</div>
      </main>
    );
  }

  return (
    <main className="calibration-page">
      <div className="calibration-container">
        <header className="calibration-header">
          <div>
            <p className="calibration-eyebrow">GroundSense Calibration</p>
            <h1>Calibrate Exposure Model</h1>
            <p>
              Use real financial, sales, procurement, and operating numbers.
              Leave unknown fields blank.
            </p>
          </div>

          <Link to="/dashboard">
            <button className="calibration-secondary">Back to dashboard</button>
          </Link>
        </header>

        <section className="calibration-company-card">
          <div>
            <p className="calibration-label">Company</p>
            <h2>{company?.name || "No company"}</h2>
            <p>{company?.industry || "Industry not set"}</p>
          </div>

          <div>
            <p className="calibration-label">Current revenue range</p>
            <h2>{company?.revenue_range || "Not set"}</h2>
            <p>Use exact annual revenue below when available.</p>
          </div>
        </section>

        {sections.map((section) => (
          <section key={section} className="calibration-card">
            <h2>{section}</h2>

            <div className="calibration-grid">
              {numberFields
                .filter((field) => field.section === section)
                .map((field) => (
                  <label key={field.key} className="calibration-field">
                    <span>{field.label}</span>
                    <input
                      type="number"
                      value={
                        form[field.key] === null || form[field.key] === undefined
                          ? ""
                          : String(form[field.key])
                      }
                      onChange={(event) =>
                        updateNumber(field.key, event.target.value)
                      }
                      placeholder="Leave blank if unknown"
                    />
                    <small>{field.helper}</small>
                  </label>
                ))}
            </div>
          </section>
        ))}

        <section className="calibration-card">
          <h2>Notes</h2>
          <textarea
            value={form.notes || ""}
            onChange={(event) =>
              setForm((current) => ({ ...current, notes: event.target.value }))
            }
            placeholder="Optional notes about data source, time period, or confidence."
          />
        </section>

        <div className="calibration-footer">
          <button
            className="calibration-primary"
            onClick={save}
            disabled={saving}
          >
            {saving ? "Saving..." : "Save Calibration"}
          </button>
        </div>
      </div>
    </main>
  );
}

export default CalibrationPage;