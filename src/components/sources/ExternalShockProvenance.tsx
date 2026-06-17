import type { ConfLevel, IssueProvenance } from "../../services/sources/issueProvenanceService";

const TONE_CLASS: Record<IssueProvenance["externalStatusTone"], string> = {
  verified: "esp-tone-verified",
  manual: "esp-tone-manual",
  support: "esp-tone-support",
  article_only: "esp-tone-article",
  scenario: "esp-tone-scenario",
};

function ConfChip({ label, level }: { label: string; level: ConfLevel }) {
  return (
    <span className={`esp-conf esp-conf-${level}`}>
      <span className="esp-conf-label">{label}</span>
      <span className="esp-conf-level">{level === "none" ? "—" : level}</span>
    </span>
  );
}

export default function ExternalShockProvenance({ prov }: { prov: IssueProvenance }) {
  return (
    <div className={`esp ${TONE_CLASS[prov.externalStatusTone]}`}>
      <style>{CSS}</style>
      <div className="esp-head">
        <span className="esp-title">External Shock Provenance</span>
        <span className="esp-status">{prov.externalStatusLabel}</span>
      </div>

      {prov.hasVerifiedShock ? (
        (() => {
          // For tariff-rate changes, lead with the percentage-point reduction (the business
          // math), not the relative % change (e.g. -40%), which is confusing.
          const isTariff = /tariff/i.test(prov.shockType ?? "");
          const b = prov.baseline ? Number(prov.baseline.replace(/[^\d.-]/g, "")) : null;
          const c = prov.current ? Number(prov.current.replace(/[^\d.-]/g, "")) : null;
          const pp = isTariff && b !== null && c !== null && Number.isFinite(b) && Number.isFinite(c) ? Math.abs(b - c) : null;
          return (
            <div className="esp-grid">
              {prov.shockType && <Field label="Shock type" value={prov.shockType} />}
              {isTariff && pp !== null ? (
                <>
                  <Field label="Change" value={`${pp} percentage-point ${c! < b! ? "reduction" : "increase"}`} />
                  <Field label="Rate move" value={`${prov.baseline} → ${prov.current}`} />
                  {prov.percentChange && <Field label="Relative change" value={prov.percentChange} />}
                </>
              ) : (
                <>
                  {prov.baseline && <Field label="Baseline" value={prov.baseline} />}
                  {prov.current && <Field label="Current" value={prov.current} />}
                  {prov.percentChange && <Field label="Change" value={prov.percentChange} />}
                </>
              )}
              {prov.source && <Field label="Source" value={prov.source} />}
              {prov.period && <Field label="Period" value={prov.period} />}
            </div>
          );
        })()
      ) : null}

      <p className="esp-reason">{prov.reason}</p>

      <div className="esp-confs">
        <ConfChip label="External source" level={prov.externalConfidence} />
        <ConfChip label="Internal exposure" level={prov.internalConfidence} />
        <ConfChip label="Final exposure" level={prov.finalConfidence} />
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="esp-field">
      <span className="esp-field-label">{label}</span>
      <span className="esp-field-value">{value}</span>
    </div>
  );
}

const CSS = `
.esp { border-radius: 10px; padding: 10px 14px; margin: 12px 0 4px; border: 1px solid var(--border-default); background: var(--bg-surface-muted); }
.esp-tone-verified { border-color: var(--success-border); background: var(--success-bg); }
.esp-tone-manual { border-color: var(--support-border); background: var(--support-bg); }
.esp-tone-support { border-color: var(--support-border); background: var(--support-bg); }
.esp-tone-article { border-color: var(--warning-border); background: var(--accent-muted); }
.esp-tone-scenario { border-color: var(--warning-border); background: var(--bg-surface-muted); }
.esp-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.esp-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); }
.esp-status { font-size: 13px; font-weight: 700; color: var(--text-primary); }
.esp-grid { display: flex; flex-wrap: wrap; gap: 14px; margin-top: 8px; }
.esp-field { display: flex; flex-direction: column; }
.esp-field-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-muted); }
.esp-field-value { font-size: 13px; font-weight: 650; color: var(--text-primary); }
.esp-reason { margin: 8px 0 0; font-size: 12px; color: var(--text-secondary); line-height: 1.45; }
.esp-confs { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.esp-conf { display: inline-flex; flex-direction: column; gap: 1px; padding: 4px 10px; border-radius: 8px; border: 1px solid var(--border-default); background: var(--bg-surface); }
.esp-conf-label { font-size: 10px; color: var(--text-muted); }
.esp-conf-level { font-size: 12px; font-weight: 700; text-transform: capitalize; }
.esp-conf-high .esp-conf-level { color: var(--success); }
.esp-conf-medium .esp-conf-level { color: var(--warning); }
.esp-conf-low .esp-conf-level { color: var(--accent-hover); }
.esp-conf-none .esp-conf-level { color: var(--text-muted); }
`;
