import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { createTrackingQueries } from "../services/createQueries";

export default function OnboardingPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);

  const [form, setForm] = useState({
    companyName: "",
    industry: "",
    revenueRange: "",
    annualRevenue: "",
    grossMargin: "",
    operatingMargin: "",
    inventoryDays: "",

    facilities: "",
    suppliers: "",
    customers: "",
    commodities: "",

    supplierCountries: "",
    competitors: "",
    productLines: "",
    customerSegments: "",
    costDrivers: "",
  });

  function updateField(field: string, value: string) {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function splitValues(value: string) {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function parseNumber(value: string) {
    const cleaned = value.replace(/[$,%]/g, "").trim();
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function parsePipeRows(value: string) {
    return value
      .split("\n")
      .map((row) => row.trim())
      .filter(Boolean)
      .map((row) => row.split("|").map((part) => part.trim()));
  }

  async function handleSubmit() {
    if (!form.companyName.trim()) {
      alert("Enter a company name");
      return;
    }

    setLoading(true);

    const { data: company, error: companyError } = await supabase
      .from("companies")
      .insert({
        name: form.companyName,
        industry: form.industry,
        revenue_range: form.revenueRange,
      })
      .select()
      .single();

    if (companyError || !company) {
      alert(companyError?.message || "Could not create company");
      setLoading(false);
      return;
    }

    await supabase.from("financial_profile").insert({
      company_id: company.id,
      annual_revenue: parseNumber(form.annualRevenue),
      gross_margin_percent: parseNumber(form.grossMargin),
      operating_margin_percent: parseNumber(form.operatingMargin),
      inventory_days: parseNumber(form.inventoryDays),
    });

    const facilityRows = parsePipeRows(form.facilities);
    if (facilityRows.length > 0) {
      await supabase.from("company_facilities").insert(
        facilityRows.map((row) => ({
          company_id: company.id,
          facility_name: row[0] || "",
          city: row[1] || "",
          state: row[2] || "",
          country: row[3] || "",
          function: row[4] || "",
        }))
      );
    }

    const supplierRows = parsePipeRows(form.suppliers);
    if (supplierRows.length > 0) {
      await supabase.from("supplier_exposure").insert(
        supplierRows.map((row) => ({
          company_id: company.id,
          supplier_name: row[0] || "",
          country: row[1] || "",
          supplied_input: row[2] || "",
          spend_percent: parseNumber(row[3] || ""),
        }))
      );
    }

    const customerRows = parsePipeRows(form.customers);
    if (customerRows.length > 0) {
      await supabase.from("customer_exposure").insert(
        customerRows.map((row) => ({
          company_id: company.id,
          customer_name: row[0] || "",
          product_line: row[1] || "",
          revenue_percent: parseNumber(row[2] || ""),
          contract_notes: row[3] || "",
        }))
      );
    }

    const commodityRows = parsePipeRows(form.commodities);
    if (commodityRows.length > 0) {
      await supabase.from("commodity_exposure").insert(
        commodityRows.map((row) => ({
          company_id: company.id,
          commodity: row[0] || "",
          spend_percent: parseNumber(row[1] || ""),
          annual_spend_estimate: parseNumber(row[2] || ""),
          notes: row[3] || "",
        }))
      );
    }

    const basicEntities = [
      ...supplierRows.map((row) => ({
        company_id: company.id,
        entity_type: "supplier",
        entity_value: row[0] || "",
      })),
      ...splitValues(form.supplierCountries).map((value) => ({
        company_id: company.id,
        entity_type: "supplier_country",
        entity_value: value,
      })),
      ...splitValues(form.competitors).map((value) => ({
        company_id: company.id,
        entity_type: "competitor",
        entity_value: value,
      })),
      ...splitValues(form.productLines).map((value) => ({
        company_id: company.id,
        entity_type: "product_line",
        entity_value: value,
      })),
      ...splitValues(form.customerSegments).map((value) => ({
        company_id: company.id,
        entity_type: "customer_segment",
        entity_value: value,
      })),
      ...commodityRows.map((row) => ({
        company_id: company.id,
        entity_type: "commodity",
        entity_value: row[0] || "",
      })),
      ...splitValues(form.costDrivers).map((value) => ({
        company_id: company.id,
        entity_type: "cost_driver",
        entity_value: value,
      })),
    ].filter((entity) => entity.entity_value);

    if (basicEntities.length > 0) {
      const { error: entitiesError } = await supabase
        .from("company_entities")
        .insert(basicEntities);

      if (entitiesError) {
        alert(entitiesError.message);
        setLoading(false);
        return;
      }
    }

    await createTrackingQueries(company.id, form.industry);

    setLoading(false);
    navigate("/dashboard");
  }

  return (
    <main className="page">
      <div className="container">
        <h1>GroundSense Company Onboarding</h1>

        <div className="card grid">
          <Field label="Company Name" value={form.companyName} onChange={(v) => updateField("companyName", v)} />
          <Field label="Industry" value={form.industry} onChange={(v) => updateField("industry", v)} />
          <Field label="Revenue Range" value={form.revenueRange} onChange={(v) => updateField("revenueRange", v)} />

          <Field label="Annual Revenue Number" value={form.annualRevenue} onChange={(v) => updateField("annualRevenue", v)} />
          <Field label="Gross Margin Percent" value={form.grossMargin} onChange={(v) => updateField("grossMargin", v)} />
          <Field label="Operating Margin Percent" value={form.operatingMargin} onChange={(v) => updateField("operatingMargin", v)} />
          <Field label="Inventory Days" value={form.inventoryDays} onChange={(v) => updateField("inventoryDays", v)} />

          <TextArea
            label="Facilities"
            helper="One per line. Format: Facility Name | City | State | Country | Function"
            value={form.facilities}
            onChange={(v) => updateField("facilities", v)}
          />

          <TextArea
            label="Suppliers"
            helper="One per line. Format: Supplier | Country | Input | Spend Percent"
            value={form.suppliers}
            onChange={(v) => updateField("suppliers", v)}
          />

          <TextArea
            label="Customers"
            helper="One per line. Format: Customer | Product Line | Revenue Percent | Contract Notes"
            value={form.customers}
            onChange={(v) => updateField("customers", v)}
          />

          <TextArea
            label="Commodities"
            helper="One per line. Format: Commodity | Spend Percent | Annual Spend Estimate | Notes"
            value={form.commodities}
            onChange={(v) => updateField("commodities", v)}
          />

          <TextArea label="Supplier Countries" value={form.supplierCountries} onChange={(v) => updateField("supplierCountries", v)} />
          <TextArea label="Top Competitors" value={form.competitors} onChange={(v) => updateField("competitors", v)} />
          <TextArea label="Product Lines" value={form.productLines} onChange={(v) => updateField("productLines", v)} />
          <TextArea label="Customer Segments" value={form.customerSegments} onChange={(v) => updateField("customerSegments", v)} />
          <TextArea label="Cost Drivers" value={form.costDrivers} onChange={(v) => updateField("costDrivers", v)} />

          <button className="button" onClick={handleSubmit} disabled={loading}>
            {loading ? "Saving..." : "Save Company Model"}
          </button>
        </div>

        <div className="card">
          <h2>Example Input</h2>
          <p><b>Facilities</b></p>
          <pre>Monterrey Plant | Monterrey | Nuevo León | Mexico | Manufacturing{"\n"}Ohio Assembly Line | Toledo | Ohio | United States | Final Assembly</pre>

          <p><b>Suppliers</b></p>
          <pre>Monterrey Steel | Mexico | Hot rolled steel | 60{"\n"}Northline Aluminum | United States | Aluminum housings | 25</pre>

          <p><b>Customers</b></p>
          <pre>Ford | Stamped Brackets | 40 | Cost escalation clause{"\n"}GM | Aluminum Housings | 25 | No escalation clause</pre>

          <p><b>Commodities</b></p>
          <pre>Steel | 65 | 12000000 | Primary input{"\n"}Aluminum | 25 | 4500000 | Secondary input</pre>
        </div>
      </div>
    </main>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <div className="label">{label}</div>
      <input className="input" value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}

function TextArea({
  label,
  helper,
  value,
  onChange,
}: {
  label: string;
  helper?: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <div className="label">{label}</div>
      {helper && <p>{helper}</p>}
      <textarea className="input" value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}