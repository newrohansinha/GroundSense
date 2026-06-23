// Styles for the Company Exposure Graph (read-only 2D causal map).
// Theme-aware: surfaces/text/border use design tokens so it re-skins in light & dark.
// Deterministic flex-lane layout; responsive wrap on narrow.

export const EXPOSURE_GRAPH_CSS = `
.gxg-root { font-family: Inter, ui-sans-serif, system-ui, sans-serif; color: var(--gs-text); }
.gxg-subhead { font-size: 13px; color: var(--gs-text-muted); margin: 0 0 14px; }

/* Summary chips */
.gxg-summary { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 16px; }
.gxg-chip {
  flex: 1 1 140px; min-width: 130px; background: var(--gs-surface-2); border: 1px solid var(--gs-border);
  border-radius: 10px; padding: 10px 12px; display: flex; flex-direction: column; gap: 2px;
}
.gxg-chip-primary { background: var(--gs-accent-soft); border-color: var(--gs-border-strong); }
.gxg-chip-favorable { background: var(--success-bg, var(--gs-accent-soft)); border-color: var(--success, var(--gs-border-strong)); }
.gxg-chip-favorable .gxg-chip-value { color: var(--success, var(--gs-text)); }
.gxg-chip-value { font-size: 18px; font-weight: 720; color: var(--gs-text); }
.gxg-chip-label { font-size: 11px; color: var(--gs-text-muted); }

/* Tabs */
.gxg-tabs { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-bottom: 14px; }
.gxg-tab {
  background: var(--gs-surface-2); border: 1px solid var(--gs-border); color: var(--gs-text-muted); border-radius: 8px;
  padding: 6px 12px; font-size: 13px; font-weight: 600; cursor: pointer; display: inline-flex;
  align-items: center; gap: 6px;
}
.gxg-tab-on { background: var(--gs-accent); color: var(--text-inverse); border-color: var(--gs-accent); }
.gxg-tab-count {
  font-size: 11px; font-weight: 700; background: rgba(125,125,125,0.18); border-radius: 10px;
  padding: 0 6px; min-width: 16px; text-align: center;
}
.gxg-tab-on .gxg-tab-count { background: rgba(255,255,255,0.25); }
.gxg-tab-links { margin-left: auto; display: flex; gap: 12px; }
.gxg-link { font-size: 12px; font-weight: 600; color: var(--gs-accent); text-decoration: none; }
.gxg-link:hover { text-decoration: underline; }

/* Body + optional detail panel */
.gxg-body { display: flex; gap: 16px; align-items: flex-start; }
.gxg-active { flex: 1 1 auto; min-width: 0; }

/* Column legend */
.gxg-col-legend {
  display: grid; grid-template-columns: repeat(5, minmax(150px, 1fr)); gap: 28px;
  padding: 0 4px 6px; overflow-x: auto;
  scrollbar-width: thin; scrollbar-color: var(--gs-border-strong) transparent;
}
.gxg-col-legend::-webkit-scrollbar { height: 3px; }
.gxg-col-legend::-webkit-scrollbar-track { background: transparent; }
.gxg-col-legend::-webkit-scrollbar-thumb { background: var(--gs-border-strong); border-radius: 10px; }
.gxg-col-legend::-webkit-scrollbar-thumb:hover { background: var(--gs-text-muted); }
.gxg-col-label {
  font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em;
  color: var(--gs-text-faint);
}

/* Lane */
.gxg-lane {
  border: 1px solid var(--gs-border); border-radius: 12px; padding: 12px 14px 14px; margin-bottom: 12px;
  background: var(--gs-surface-2);
}
.gxg-lane-blocked { border-style: dashed; }
.gxg-lane-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 10px; margin-bottom: 10px; }
.gxg-lane-title { font-size: 14px; font-weight: 700; color: var(--gs-text); }
.gxg-lane-type {
  font-size: 11px; font-weight: 650; color: var(--gs-info); background: var(--gs-info-soft); border-radius: 4px;
  padding: 1px 7px;
}
.gxg-lane-type-blocked { color: var(--gs-danger); background: var(--gs-danger-soft); }
.gxg-lane-impact { font-size: 12px; font-weight: 650; color: var(--gs-accent); margin-left: auto; }

/* Flow row of node cards + arrows */
.gxg-flow {
  display: flex; align-items: stretch; gap: 0; overflow-x: auto; padding-bottom: 8px;
  scrollbar-width: thin; scrollbar-color: var(--gs-border-strong) transparent;
}
.gxg-flow::-webkit-scrollbar { height: 4px; }
.gxg-flow::-webkit-scrollbar-track { background: transparent; }
.gxg-flow::-webkit-scrollbar-thumb { background: var(--gs-border-strong); border-radius: 10px; }
.gxg-flow::-webkit-scrollbar-thumb:hover { background: var(--gs-text-muted); }
.gxg-flow-cell { display: flex; align-items: stretch; }
.gxg-node {
  text-align: left; width: 168px; min-width: 168px; background: var(--gs-surface); border: 1px solid var(--gs-border);
  border-radius: 10px; padding: 10px; display: flex; flex-direction: column; gap: 4px; cursor: pointer;
  transition: box-shadow 0.12s, border-color 0.12s, transform 0.12s; font-family: inherit;
}
.gxg-node:hover { box-shadow: var(--gs-shadow-pop); transform: translateY(-1px); }
.gxg-node-selected { border-color: var(--gs-accent); box-shadow: 0 0 0 2px var(--gs-accent-soft); }
.gxg-node-title { font-size: 13px; font-weight: 680; color: var(--gs-text); line-height: 1.25; }
.gxg-node-sub { font-size: 11px; color: var(--gs-text-muted); line-height: 1.3; }
.gxg-node-value { font-size: 13px; font-weight: 720; color: var(--gs-good); margin-top: 2px; }
.gxg-node-meta { font-size: 11px; color: var(--gs-text-muted); }

/* Node status — full border color instead of side-stripe */
.gxg-node-verified { border-color: var(--gs-good); }
.gxg-node-company_calibrated { border-color: var(--gs-info); }
.gxg-node-assumption { border-color: var(--gs-warn); }
.gxg-node-estimate { border-color: var(--gs-accent); }
.gxg-node-pending { border-color: var(--gs-warn); }
.gxg-node-action { border-color: var(--gs-text-muted); }
.gxg-node-blocked { border-color: var(--gs-danger); }
.gxg-node-missing { border-color: var(--gs-text-faint); }

/* Arrow connector */
.gxg-arrow {
  align-self: center; flex: 0 0 28px; height: 2px; background: var(--gs-border-strong); position: relative;
}
.gxg-arrow::after {
  content: ""; position: absolute; right: 0; top: 50%; transform: translateY(-50%);
  border-left: 7px solid var(--gs-border-strong); border-top: 5px solid transparent; border-bottom: 5px solid transparent;
}

/* Badges */
.gxg-badge {
  display: inline-block; font-size: 10px; font-weight: 700; padding: 1px 6px; border-radius: 4px;
  width: fit-content; text-transform: uppercase; letter-spacing: 0.03em;
}
.gxg-badge-verified { background: var(--gs-good-soft); color: var(--gs-good); }
.gxg-badge-company_calibrated { background: var(--gs-info-soft); color: var(--gs-info); }
.gxg-badge-assumption { background: var(--gs-warn-soft); color: var(--gs-warn); }
.gxg-badge-estimate { background: var(--gs-accent-soft); color: var(--gs-accent); }
.gxg-badge-pending { background: var(--gs-warn-soft); color: var(--gs-warn); }
.gxg-badge-action { background: var(--gs-surface-2); color: var(--gs-text-muted); }
.gxg-badge-blocked { background: var(--gs-danger-soft); color: var(--gs-danger); }
.gxg-badge-missing { background: var(--gs-surface-2); color: var(--gs-text-muted); }
.gxg-badge-context { background: var(--gs-info-soft); color: var(--gs-info); }

/* Foot note */
.gxg-foot { font-size: 11px; color: var(--gs-text-faint); font-style: italic; margin: 6px 2px 0; }
.gxg-empty { font-size: 13px; color: var(--gs-text-faint); font-style: italic; padding: 12px 2px; }

/* Detail panel */
.gxg-detail {
  flex: 0 0 260px; max-width: 260px; border: 1px solid var(--gs-border); border-radius: 12px; padding: 12px;
  background: var(--gs-surface-2); position: sticky; top: 12px;
}
.gxg-detail-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.gxg-detail-close {
  background: none; border: none; cursor: pointer; font-size: 13px; color: var(--gs-text-muted); line-height: 1;
}
.gxg-detail-title { font-size: 14px; font-weight: 720; margin: 0 0 4px; color: var(--gs-text); }
.gxg-detail-sub { font-size: 12px; color: var(--gs-text-muted); margin: 0 0 6px; line-height: 1.35; }
.gxg-detail-value { font-size: 15px; font-weight: 720; color: var(--gs-good); margin: 0 0 8px; }
.gxg-detail-list { margin: 0; display: grid; grid-template-columns: 1fr; gap: 2px; }
.gxg-detail-list dt {
  font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;
  color: var(--gs-text-faint); margin-top: 6px;
}
.gxg-detail-list dd { font-size: 12px; color: var(--gs-text); margin: 0; line-height: 1.4; }

/* Supporting signals */
.gxg-support-note { font-size: 12px; color: var(--gs-text-muted); margin: 0 0 12px; }
.gxg-support-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px; }
.gxg-support-card { border: 1px solid var(--gs-border); border-radius: 10px; padding: 10px 12px; background: var(--gs-surface-2); }
.gxg-support-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 5px; }
.gxg-support-label { font-size: 13px; font-weight: 680; color: var(--gs-text); }
.gxg-support-detail { font-size: 11px; color: var(--gs-text-muted); margin: 0; line-height: 1.4; }

.gxg-audit { }
.gxg-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; }

/* Responsive: stack the detail panel under the graph on narrow screens */
@media (max-width: 860px) {
  .gxg-body { flex-direction: column; }
  .gxg-detail { flex-basis: auto; max-width: none; width: 100%; position: static; }
  .gxg-col-legend { display: none; }
}
`;
