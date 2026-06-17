// Calibration Center — scoped styles (single injected stylesheet).
// Kept as a string export so the whole workbench is self-contained.

export const CALIBRATION_CENTER_CSS = `
.cc-root {
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, sans-serif;
  color: var(--text-primary);
  background: var(--bg-surface);
  border: 1px solid var(--border-default);
  border-radius: 18px;
  padding: 22px;
  margin-bottom: 18px;
}
.cc-root * { box-sizing: border-box; }
.cc-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 18px; }
.cc-eyebrow { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: var(--accent-hover); margin: 0 0 4px; }
.cc-title { margin: 0 0 4px; font-size: 22px; font-weight: 720; letter-spacing: -0.02em; color: var(--text-primary); }
.cc-subtitle { margin: 0 0 6px; font-size: 14px; font-weight: 600; color: var(--text-secondary); }
.cc-blurb { margin: 0; font-size: 13px; color: var(--text-muted); max-width: 640px; line-height: 1.5; }
.cc-persistence { font-size: 12px; font-weight: 600; white-space: nowrap; padding: 5px 10px; border-radius: 8px; flex-shrink: 0; }
.cc-persistence-supabase { background: var(--success-bg); color: var(--success); border: 1px solid var(--success-border); }
.cc-persistence-local { background: var(--bg-surface-muted); color: var(--warning); border: 1px solid var(--border-default); }

/* Summary row */
.cc-summary-row { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; margin-bottom: 20px; }
.cc-summary-card { display: flex; flex-direction: column; gap: 3px; padding: 14px; border-radius: 12px; border: 1px solid var(--border-default); background: var(--bg-surface); }
.cc-summary-primary { background: var(--bg-surface-muted); border-color: var(--border-default); }
.cc-summary-good { background: var(--success-bg); border-color: var(--success-border); }
.cc-summary-warn { background: var(--accent-muted); border-color: var(--border-default); }
.cc-summary-value { font-size: 26px; font-weight: 760; letter-spacing: -0.02em; color: var(--text-primary); }
.cc-summary-label { font-size: 13px; font-weight: 680; color: var(--text-primary); }
.cc-summary-sub { font-size: 11px; color: var(--text-muted); line-height: 1.35; }

/* Tabs */
.cc-tabs { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 18px; border-bottom: 1px solid var(--bg-surface-muted); padding-bottom: 12px; }
.cc-tab { font-size: 13px; font-weight: 620; color: var(--text-muted); background: none; border: 1px solid transparent; border-radius: 8px; padding: 6px 12px; cursor: pointer; transition: all 120ms ease; }
.cc-tab:hover { background: var(--bg-surface-muted); color: var(--text-primary); }
.cc-tab-on { background: var(--accent); color: var(--text-inverse); border-color: var(--accent); }
.cc-tab-on:hover { background: var(--accent-hover); color: var(--text-inverse); }

/* Buttons */
.cc-btn { font-size: 13px; font-weight: 620; border-radius: 8px; padding: 7px 13px; cursor: pointer; transition: all 120ms ease; border: 1px solid transparent; }
.cc-btn-primary { background: var(--accent); color: var(--text-inverse); border-color: var(--accent-hover); }
.cc-btn-primary:hover { background: var(--accent-hover); }
.cc-btn-primary:disabled { background: var(--border-default); border-color: var(--border-default); cursor: not-allowed; }
.cc-btn-ghost { background: var(--bg-surface); color: var(--warning); border-color: var(--warning-border); }
.cc-btn-ghost:hover { background: var(--warning-bg); }
.cc-btn-text { background: none; color: var(--accent-hover); border: none; padding: 7px 6px; }
.cc-btn-text:hover { color: var(--accent-hover); }
.cc-btn-danger { color: var(--danger); }
.cc-btn-danger:hover { color: var(--danger); }

/* Overview */
.cc-overview-block { margin-bottom: 24px; }
.cc-block-title { margin: 0 0 12px; font-size: 15px; font-weight: 700; color: var(--text-primary); }
.cc-health-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 12px; }
.cc-health-card { border: 1px solid var(--border-default); border-radius: 12px; padding: 14px; background: var(--bg-surface); display: flex; flex-direction: column; gap: 6px; }
.cc-health-top { display: flex; justify-content: space-between; align-items: baseline; }
.cc-health-name { font-size: 14px; font-weight: 660; color: var(--text-primary); }
.cc-health-pct { font-size: 16px; font-weight: 740; }
.cc-rel-high { color: var(--success); }
.cc-rel-mid { color: var(--warning); }
.cc-rel-low { color: var(--danger); }
.cc-health-bar { width: 100%; height: 5px; background: var(--bg-surface-muted); border-radius: 3px; overflow: hidden; }
.cc-health-bar-fill { height: 100%; background: var(--accent-hover); border-radius: 3px; width: 100%; transform-origin: left center; transition: transform 300ms ease; }
.cc-health-rel { margin: 0; font-size: 12px; font-weight: 620; color: var(--text-secondary); }
.cc-health-basis { margin: 0; font-size: 12px; color: var(--text-muted); }
.cc-health-missing { margin: 0; font-size: 12px; color: var(--accent-hover); }
.cc-health-affects { margin: 0; font-size: 11px; color: var(--text-muted); }
.cc-health-btn { align-self: flex-start; margin-top: 4px; }

.cc-roadmap { display: flex; flex-direction: column; gap: 8px; }
.cc-roadmap-item { display: flex; align-items: flex-start; gap: 12px; padding: 12px 14px; border: 1px solid var(--border-default); border-radius: 12px; background: var(--bg-surface); }
.cc-roadmap-done { opacity: 0.6; }
.cc-roadmap-rank { width: 24px; height: 24px; border-radius: 50%; background: var(--text-primary); color: var(--bg-surface); font-size: 12px; font-weight: 700; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.cc-roadmap-done .cc-roadmap-rank { background: var(--success); }
.cc-roadmap-main { flex: 1; min-width: 0; }
.cc-roadmap-line { display: flex; align-items: center; gap: 10px; margin-bottom: 3px; }
.cc-roadmap-title { font-size: 14px; font-weight: 660; color: var(--text-primary); }
.cc-roadmap-detail { margin: 0 0 2px; font-size: 12px; color: var(--text-muted); }
.cc-roadmap-improve { margin: 0; font-size: 12px; color: var(--success); font-style: italic; }
.cc-impact-badge { font-size: 11px; font-weight: 700; padding: 2px 7px; border-radius: 6px; white-space: nowrap; }
.cc-impact-high { background: var(--danger-bg); color: var(--danger); }
.cc-impact-medium { background: var(--bg-surface-muted); color: var(--warning); }
.cc-impact-low { background: var(--bg-surface-muted); color: var(--text-secondary); }

.cc-deps { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; }
.cc-dep { border: 1px solid var(--border-default); border-radius: 12px; padding: 13px; background: var(--bg-surface); }
.cc-dep-head { display: flex; flex-direction: column; gap: 2px; margin-bottom: 6px; }
.cc-dep-issue { font-size: 14px; font-weight: 660; color: var(--text-primary); }
.cc-dep-rel { font-size: 12px; color: var(--warning); }
.cc-dep-missing { margin: 0 0 6px; font-size: 12px; color: var(--accent-hover); }
.cc-dep-ok { margin: 0 0 6px; font-size: 12px; color: var(--success); }

/* Domain tab */
.cc-domain-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 14px; }
.cc-domain-title { margin: 0 0 3px; font-size: 17px; font-weight: 700; color: var(--text-primary); }
.cc-domain-blurb { margin: 0; font-size: 13px; color: var(--text-muted); max-width: 560px; }
.cc-domain-score { display: flex; flex-direction: column; align-items: flex-end; flex-shrink: 0; }
.cc-domain-pct { font-size: 24px; font-weight: 760; }
.cc-domain-rel { font-size: 12px; font-weight: 620; color: var(--text-secondary); }
.cc-domain-meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; padding: 12px 0; border-top: 1px solid var(--bg-surface-muted); border-bottom: 1px solid var(--bg-surface-muted); margin-bottom: 12px; }
.cc-domain-meta-item { display: flex; flex-direction: column; gap: 2px; }
.cc-meta-label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted); }
.cc-meta-value { font-size: 13px; color: var(--text-primary); }
.cc-domain-missing { margin: 0 0 14px; font-size: 13px; color: var(--accent-hover); }
.cc-domain-missing strong { color: var(--danger); }
.cc-domain-rows { margin-bottom: 16px; }
.cc-domain-rows-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.cc-domain-rows-title { font-size: 13px; font-weight: 660; color: var(--text-primary); }
.cc-domain-section { margin-top: 18px; padding-top: 16px; border-top: 1px solid var(--bg-surface-muted); }
.cc-domain-section-label { margin: 0 0 10px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.07em; color: var(--text-muted); }

/* Tables */
.cc-preview-table-wrap { overflow-x: auto; border: 1px solid var(--bg-surface-muted); border-radius: 10px; }
.cc-preview-table, .cc-inventory-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.cc-preview-table th, .cc-inventory-table th { text-align: left; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); padding: 8px 10px; background: var(--bg-surface-muted); border-bottom: 1px solid var(--bg-surface-muted); white-space: nowrap; }
.cc-preview-table td, .cc-inventory-table td { padding: 8px 10px; border-bottom: 1px solid var(--bg-surface-muted); color: var(--text-primary); vertical-align: top; }
.cc-preview-table tr:last-child td, .cc-inventory-table tr:last-child td { border-bottom: none; }
.cc-row-invalid td { background: var(--danger-bg); }
.cc-row-ok { color: var(--success); font-weight: 620; }
.cc-row-bad { color: var(--danger); font-weight: 620; }
.cc-row-issues { color: var(--accent-hover); max-width: 240px; }
.cc-preview-more { margin: 6px 0 0; font-size: 12px; color: var(--text-muted); font-style: italic; }

/* Import */
.cc-import-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 8px; }
.cc-import-hint { margin: 0 0 8px; font-size: 12px; color: var(--text-muted); }
.cc-import-hint code { background: var(--bg-surface-muted); padding: 1px 5px; border-radius: 4px; font-size: 11px; }
.cc-import-status { margin: 0 0 8px; font-size: 13px; color: var(--success); font-weight: 600; }
.cc-preview { margin-top: 10px; border: 1px solid var(--border-default); border-radius: 12px; padding: 14px; background: var(--bg-surface); }
.cc-preview-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 10px; flex-wrap: wrap; }
.cc-preview-file { font-size: 13px; font-weight: 660; color: var(--text-primary); }
.cc-preview-counts { font-size: 12px; color: var(--text-secondary); }
.cc-preview-error { font-size: 12px; color: var(--danger); font-weight: 620; }
.cc-required-check { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.cc-req-ok { font-size: 11px; color: var(--success); font-weight: 600; }
.cc-preview-actions { display: flex; align-items: center; gap: 10px; margin-top: 12px; }

/* Manual entry */
.cc-manual { border: 1px solid var(--border-default); border-radius: 12px; padding: 14px; background: var(--bg-surface); }
.cc-manual-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 12px; margin-bottom: 12px; }
.cc-manual-field { display: flex; flex-direction: column; gap: 4px; }
.cc-manual-label { font-size: 12px; font-weight: 620; color: var(--text-secondary); }
.cc-req-star { color: var(--danger); }
.cc-manual-unit { color: var(--text-muted); font-weight: 500; }
.cc-manual-input { font-family: inherit; font-size: 13px; color: var(--text-primary); background: var(--bg-surface); border: 1px solid var(--border-strong); border-radius: 8px; padding: 7px 9px; outline: none; width: 100%; }
.cc-manual-input:focus { border-color: var(--accent-hover); }
.cc-manual-actions { display: flex; align-items: center; gap: 10px; }
.cc-manual-hint { font-size: 12px; color: var(--accent-hover); }

/* Impact */
.cc-impact { border: 1px solid var(--border-default); border-radius: 12px; padding: 14px; background: var(--bg-surface-muted); }
.cc-impact-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.cc-impact-title { font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted); }
.cc-impact-delta { font-size: 12px; font-weight: 700; padding: 2px 8px; border-radius: 6px; }
.cc-delta-down { background: var(--success-bg); color: var(--success); }
.cc-delta-up { background: var(--accent-muted); color: var(--warning); }
.cc-impact-cols { display: flex; align-items: stretch; gap: 12px; }
.cc-impact-col { flex: 1; background: var(--bg-surface); border: 1px solid var(--border-default); border-radius: 10px; padding: 12px; }
.cc-impact-col-after { border-color: var(--success-border); background: var(--success-bg); }
.cc-impact-col-label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted); margin-bottom: 8px; }
.cc-impact-line { display: flex; flex-direction: column; gap: 1px; margin-bottom: 8px; }
.cc-impact-line-label { font-size: 11px; color: var(--text-muted); }
.cc-impact-line-value { font-size: 14px; font-weight: 660; color: var(--text-primary); }
.cc-impact-line-source { font-size: 11px; color: var(--text-muted); font-style: italic; }
.cc-impact-conf { font-size: 12px; font-weight: 620; color: var(--danger); margin-top: 4px; }
.cc-impact-conf-after { color: var(--success); }
.cc-impact-arrow { display: flex; align-items: center; font-size: 20px; color: var(--accent-hover); }
.cc-impact-summary { margin: 12px 0 0; font-size: 13px; color: var(--text-secondary); line-height: 1.5; }
.cc-impact-missing { margin: 6px 0 0; font-size: 12px; color: var(--accent-hover); }

/* Inventory */
.cc-inventory-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 14px; }
.cc-inventory-filters { display: flex; gap: 6px; flex-shrink: 0; }
.cc-chip { font-size: 12px; font-weight: 620; color: var(--text-muted); background: var(--bg-surface-muted); border: 1px solid var(--border-default); border-radius: 20px; padding: 4px 12px; cursor: pointer; }
.cc-chip-on { background: var(--text-primary); color: var(--bg-surface); border-color: var(--text-primary); }
.cc-inv-label { display: block; font-weight: 640; color: var(--text-primary); }
.cc-inv-domain { display: block; font-size: 11px; color: var(--text-muted); }
.cc-inv-value { font-weight: 660; white-space: nowrap; }
.cc-inv-source { color: var(--text-muted); }
.cc-inv-usedby { color: var(--text-muted); font-size: 11px; }
.cc-conf-high { color: var(--success); font-weight: 620; }
.cc-conf-mid { color: var(--warning); font-weight: 620; }
.cc-conf-low { color: var(--text-muted); font-weight: 620; }
.cc-badge { font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 6px; white-space: nowrap; }
.cc-badge-imported { background: var(--success-bg); color: var(--success); }
.cc-badge-manual { background: var(--support-bg); color: var(--support); }
.cc-badge-approved { background: var(--support-bg); color: var(--support); }
.cc-badge-evidence { background: var(--success-bg); color: var(--success); }
.cc-badge-demo { background: var(--bg-surface-muted); color: var(--warning); }
.cc-badge-inferred { background: var(--bg-surface-muted); color: var(--text-muted); }

/* Activity */
.cc-activity-list { display: flex; flex-direction: column; gap: 8px; margin-top: 12px; }
.cc-activity-item { border: 1px solid var(--border-default); border-radius: 10px; padding: 12px; background: var(--bg-surface); }
.cc-activity-top { display: flex; justify-content: space-between; margin-bottom: 4px; }
.cc-activity-domain { font-size: 13px; font-weight: 660; color: var(--text-primary); }
.cc-activity-date { font-size: 12px; color: var(--text-muted); }
.cc-activity-note { margin: 0 0 3px; font-size: 13px; color: var(--text-secondary); }
.cc-activity-scores { margin: 0; font-size: 12px; color: var(--text-muted); }
.cc-empty { font-size: 13px; color: var(--text-muted); font-style: italic; padding: 12px 0; }

@media (max-width: 920px) {
  .cc-summary-row { grid-template-columns: repeat(2, 1fr); }
  .cc-impact-cols { flex-direction: column; }
  .cc-impact-arrow { transform: rotate(90deg); align-self: center; }
}
`;
