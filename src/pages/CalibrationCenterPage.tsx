import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { getCalibrationForCompany, type CompanyCalibrationInput } from "../services/calibrationService";
import { useCalibrationWorkbench } from "../services/calibration/useCalibrationWorkbench";
import { runQualityGateOnAll } from "../services/issueQualityGateService";
import { CALIBRATION_DOMAINS } from "../services/calibration/calibrationDomains";
import { downloadTemplate } from "../services/calibration/csvTemplateService";
import type { DomainKey } from "../services/calibration/types";
import CalibrationCenter from "../components/calibration/CalibrationCenter";
import CalibrationInputsEditor from "../components/calibration/CalibrationInputsEditor";
import { buyerCompanyName } from "../services/companyService";

type Company = {
  id: string;
  name: string;
  industry: string | null;
  revenue_range: string | null;
};

export default function CalibrationCenterPage() {
  const [company, setCompany] = useState<Company | null>(null);
  const [calibration, setCalibration] = useState<CompanyCalibrationInput | null>(null);
  const [blockedOpportunityCount, setBlockedOpportunityCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showDanger, setShowDanger] = useState(false);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    const savedCompanyId = localStorage.getItem("groundsense_company_id");
    let query = supabase.from("companies").select("*");
    query = savedCompanyId
      ? query.eq("id", savedCompanyId)
      : query.order("created_at", { ascending: false }).limit(1);

    const { data: companies } = await query;
    const latest = companies?.[0] as Company | undefined;
    if (!latest) {
      setLoading(false);
      return;
    }
    setCompany(latest);
    localStorage.setItem("groundsense_company_id", latest.id);

    try {
      const cal = await getCalibrationForCompany(latest.id);
      if (cal) setCalibration(cal as CompanyCalibrationInput);
    } catch {
      // calibration is non-critical
    }

    // Blocked-opportunity count so the Center's "Blocked by Missing Data" card is accurate.
    try {
      const [riskResult, oppResult] = await Promise.all([
        supabase.from("risk_register").select("*").eq("company_id", latest.id).limit(40),
        supabase.from("opportunity_register").select("*").eq("company_id", latest.id).limit(40),
      ]);
      const gate = runQualityGateOnAll(
        (riskResult.data || []) as any[],
        (oppResult.data || []) as any[]
      );
      const blocked = (oppResult.data || []).filter((o: any) => {
        const d = gate.get(o.id)?.decision;
        return d === "quarantine" || d === "candidate_review";
      }).length;
      setBlockedOpportunityCount(blocked);
    } catch {
      // non-critical
    }

    setLoading(false);
  }

  const controller = useCalibrationWorkbench(
    company?.id ?? null,
    calibration,
    blockedOpportunityCount
  );

  function handleDownloadAllTemplates() {
    CALIBRATION_DOMAINS.forEach((d) => downloadTemplate(d.key as DomainKey, false));
  }

  function handleClearAll() {
    const ok = window.confirm(
      "Clear all locally-imported calibration data (all domains)? This resets coverage to the inferred baseline. Published risks and intelligence are not affected."
    );
    if (!ok) return;
    CALIBRATION_DOMAINS.forEach((d) => controller.resetDomain(d.key as DomainKey));
  }

  if (loading) {
    return (
      <main className="calibration-center-page" style={pageStyle}>
        <div style={{ maxWidth: 1180, margin: "0 auto", padding: "32px 24px" }}>Loading…</div>
      </main>
    );
  }

  if (!company) {
    return (
      <main className="calibration-center-page" style={pageStyle}>
        <div style={{ maxWidth: 1180, margin: "0 auto", padding: "32px 24px" }}>
          <p>No company found. <Link to="/onboarding">Add a company</Link> first.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="calibration-center-page" style={pageStyle}>
      <div style={{ maxWidth: 1180, margin: "0 auto", padding: "24px" }}>
        {/* Compact label only — no large page hero. The editable base inputs render directly
            below (no broken link to a separate base page). */}
        <div style={{ ...headerBar, marginBottom: 14 }}>
          <p style={eyebrow}>{buyerCompanyName(company.name)} · calibration</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "flex-end" }}>
            <Link to="/dashboard">
              <button style={btnGhost}>← Back to Dashboard</button>
            </Link>
            <button style={btnGhost} onClick={handleDownloadAllTemplates}>Download all templates</button>
          </div>
        </div>

        {/* Base model inputs — editable, directly on this page. */}
        <CalibrationInputsEditor companyId={company.id} />

        {/* Separate the live model inputs above from the data-coverage workbench below. */}
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, margin: "26px 0 14px" }}>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, letterSpacing: "-0.01em", color: "var(--text-primary)" }}>Data coverage &amp; uploads</h2>
          <span style={{ fontSize: 12.5, color: "var(--text-muted)" }}>Domain-by-domain completeness and CSV imports that ground the inputs above.</span>
        </div>

        <CalibrationCenter controller={controller} />

        {/* Advanced / Danger Zone — destructive controls collapsed; never one click away. */}
        <div style={{ marginTop: 24, borderTop: "1px solid var(--border-default)", paddingTop: 16 }}>
          <button style={btnGhost} onClick={() => setShowDanger((v) => !v)}>
            {showDanger ? "▲ Hide Advanced / Danger Zone" : "▼ Advanced / Danger Zone"}
          </button>
          {showDanger && (
            <div
              style={{
                marginTop: 12,
                border: "1px solid var(--danger-border)",
                background: "var(--danger-bg)",
                borderRadius: 12,
                padding: 16,
                maxWidth: 560,
              }}
            >
              <p style={{ margin: "0 0 4px", fontWeight: 700, color: "var(--danger)" }}>Danger Zone</p>
              <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--text-secondary)" }}>
                Clears all locally-imported calibration data across every domain and resets coverage to the
                inferred baseline. Published risks and intelligence are not affected. Requires confirmation.
              </p>
              <button style={btnDanger} onClick={handleClearAll}>Clear all calibration data</button>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

const pageStyle: React.CSSProperties = {
  background: "var(--bg-app)",
  minHeight: "100vh",
  fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, sans-serif",
};

const headerBar: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: 16,
  flexWrap: "wrap",
  marginBottom: 18,
};

const eyebrow: React.CSSProperties = {
  margin: 0,
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--accent-hover)",
};


const btnBase: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  padding: "8px 14px",
  borderRadius: 8,
  cursor: "pointer",
  border: "1px solid var(--border-default)",
  background: "var(--bg-surface)",
  color: "var(--text-primary)",
};
const btnGhost: React.CSSProperties = { ...btnBase };
const btnDanger: React.CSSProperties = { ...btnBase, borderColor: "var(--danger-border)", color: "var(--danger)" };
