export const SOURCE_HUB_CSS = `
.shub-page { background: var(--bg-app); min-height: 100vh; font-family: Inter, ui-sans-serif, system-ui, -apple-system, sans-serif; color: var(--text-primary); }
.shub-wrap { max-width: 1180px; margin: 0 auto; padding: 24px; }
.shub-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; flex-wrap: wrap; margin-bottom: 18px; }
.shub-eyebrow { margin: 0 0 2px; font-size: 12px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--accent-hover); }
.shub-title { margin: 4px 0 2px; font-size: 26px; font-weight: 800; }
.shub-sub { margin: 0; font-size: 14px; color: var(--text-muted); }
.shub-header-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.shub-btn { font-size: 13px; font-weight: 600; padding: 8px 14px; border-radius: 8px; border: 1px solid var(--border-default); background: var(--bg-surface); color: var(--text-primary); cursor: pointer; }
.shub-btn-sm { padding: 5px 10px; font-size: 12px; }
.shub-btn-primary { background: var(--accent-hover); border-color: var(--accent-hover); color: var(--text-inverse); }
.shub-summary { display: grid; grid-template-columns: repeat(6, 1fr); gap: 10px; margin-bottom: 16px; }
.shub-summary-card { background: var(--bg-surface); border: 1px solid var(--border-default); border-radius: 12px; padding: 12px 14px; display: flex; flex-direction: column; gap: 3px; }
.shub-summary-value { font-size: 22px; font-weight: 750; }
.shub-summary-label { font-size: 11px; color: var(--text-muted); }
.shub-tabs { display: flex; flex-wrap: wrap; gap: 6px; border-bottom: 1px solid var(--border-default); margin-bottom: 16px; }
.shub-tab { font-size: 13px; font-weight: 600; padding: 8px 12px; border: none; background: none; color: var(--text-muted); cursor: pointer; border-radius: 8px 8px 0 0; }
.shub-tab-on { background: var(--bg-surface); color: var(--text-primary); border: 1px solid var(--border-default); border-bottom: 2px solid var(--accent-hover); }
.shub-body { background: var(--bg-surface); border: 1px solid var(--border-default); border-radius: 14px; padding: 18px; }
.shub-h3 { margin: 0 0 12px; font-size: 15px; font-weight: 700; }
.shub-note { margin-top: 14px; font-size: 11px; color: var(--text-muted); font-style: italic; }
.shub-empty { font-size: 13px; color: var(--text-muted); }
.shub-table-wrap { overflow-x: auto; }
.shub-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.shub-table th { text-align: left; padding: 8px 10px; background: var(--bg-surface-muted); color: var(--text-muted); font-weight: 650; white-space: nowrap; }
.shub-table td { padding: 7px 10px; border-top: 1px solid var(--bg-surface-muted); vertical-align: top; }
.shub-gap { color: var(--text-muted); font-style: italic; }
.shub-status { font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 999px; white-space: nowrap; text-transform: capitalize; }
.shub-status-live { background: var(--success-bg); color: var(--success); }
.shub-status-live_no_metrics { background: var(--bg-surface-muted); color: var(--warning); }
.shub-status-needs_user_agent { background: var(--accent-muted); color: var(--accent-hover); }
.shub-status-needs_server_proxy { background: var(--accent-muted); color: var(--accent-hover); }
.shub-status-not_configured_key_required { background: var(--accent-muted); color: var(--accent-hover); }
.shub-status-context_only { background: var(--support-bg); color: var(--support); }
.shub-status-skipped { background: var(--bg-surface-muted); color: var(--text-muted); }
.shub-status-error { background: var(--danger-bg); color: var(--danger); }
.shub-status-manual_only { background: var(--support-bg); color: var(--support); }
.shub-status-unknown { background: var(--bg-surface-muted); color: var(--text-muted); }
.shub-refresh-note { font-size: 13px; color: var(--success); font-weight: 600; background: var(--success-bg); border: 1px solid var(--success-border); border-radius: 8px; padding: 8px 14px; margin: 0 0 14px; }
.shub-conn-diag { margin-top: 8px; padding-top: 8px; border-top: 1px dashed var(--border-subtle); display: flex; flex-direction: column; gap: 2px; }
.shub-conn-diag-line { font-size: 11.5px; font-weight: 650; color: var(--text-secondary); margin-bottom: 2px; }
.shub-conn-item { font-size: 11px; color: var(--text-muted); line-height: 1.35; }
.shub-conn-item-ingested { color: var(--success); }
.shub-conn-item-skipped { color: var(--accent-hover); }
.shub-conn-item-error { color: var(--danger); }
.shub-cov { font-size: 11px; font-weight: 650; padding: 2px 8px; border-radius: 999px; text-transform: capitalize; white-space: nowrap; }
.shub-cov-verified { background: var(--success-bg); color: var(--success); }
.shub-cov-manual { background: var(--support-bg); color: var(--support); }
.shub-cov-support { background: var(--support-bg); color: var(--support); }
.shub-cov-context { background: var(--support-bg); color: var(--support); }
.shub-cov-article_only { background: var(--accent-muted); color: var(--accent-hover); }
.shub-cov-scenario_only { background: var(--bg-surface-muted); color: var(--warning); }
.shub-cov-not_configured { background: var(--danger-bg); color: var(--danger); }
.shub-cov-needs_user_agent { background: var(--accent-muted); color: var(--accent-hover); }
.shub-connectors { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
.shub-conn-card { border: 1px solid var(--border-subtle); border-radius: 12px; padding: 14px; background: var(--bg-surface); }
.shub-conn-top { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 8px; }
.shub-conn-name { font-size: 14px; font-weight: 700; }
.shub-conn-meta { display: flex; flex-wrap: wrap; gap: 12px; font-size: 11.5px; color: var(--text-muted); margin-bottom: 6px; }
.shub-conn-env { font-size: 11.5px; color: var(--text-muted); margin: 0 0 6px; }
.shub-conn-env code { background: var(--bg-surface-muted); padding: 1px 5px; border-radius: 4px; }
.shub-conn-reason { font-size: 12px; color: var(--text-secondary); margin: 0 0 10px; line-height: 1.4; }
.shub-conn-actions { display: flex; gap: 8px; }
.shub-conn-import { margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--bg-surface-muted); }
.shub-import-block { margin-bottom: 18px; padding-bottom: 18px; border-bottom: 1px solid var(--bg-surface-muted); }
@media (max-width: 900px) { .shub-summary { grid-template-columns: repeat(3, 1fr); } .shub-connectors { grid-template-columns: 1fr; } }
`;
