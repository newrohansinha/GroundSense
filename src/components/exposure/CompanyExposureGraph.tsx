// Company Exposure Graph — read-only 2D node-and-edge operating map.
//
// Renders canonical exposure paths left→right: external signal → company exposure →
// calculation → business impact → action. Consumes ExposureGraphModel only; it never
// computes dollars itself. Supporting signals and blocked candidates live behind tabs
// so they can never be mistaken for separately quantified exposures.

import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type {
  ExposureGraphModel,
  ExposureGraphNode,
  ExposurePath,
} from "../../services/exposure/exposureGraphViewModel";
import { EXPOSURE_GRAPH_CSS } from "./exposureGraphStyles";

type TabKey = "active" | "supporting" | "blocked" | "audit";

const COLUMN_LABELS = [
  "External signal",
  "Company exposure",
  "Calculation",
  "Business impact",
  "Action",
];

function statusClass(status: ExposureGraphNode["status"]): string {
  return `gxg-node-${status}`;
}

function ColumnLabel({ index }: { index: number }) {
  const label = COLUMN_LABELS[Math.min(index, COLUMN_LABELS.length - 1)];
  return <span className="gxg-col-label">{label}</span>;
}

function NodeCard({
  node,
  selected,
  onSelect,
}: {
  node: ExposureGraphNode;
  selected: boolean;
  onSelect: (n: ExposureGraphNode) => void;
}) {
  return (
    <button
      type="button"
      className={`gxg-node ${statusClass(node.status)} ${selected ? "gxg-node-selected" : ""}`}
      onClick={() => onSelect(node)}
      aria-pressed={selected}
    >
      <span className={`gxg-badge gxg-badge-${node.status}`}>{node.statusLabel}</span>
      <span className="gxg-node-title">{node.title}</span>
      {node.subtitle && <span className="gxg-node-sub">{node.subtitle}</span>}
      {node.valueLabel && <span className="gxg-node-value">{node.valueLabel}</span>}
      {node.meta?.owner && (
        <span className="gxg-node-meta">
          {node.meta.owner}
          {node.meta.due ? ` · Due ${node.meta.due}` : ""}
        </span>
      )}
    </button>
  );
}

function PathLane({
  path,
  selectedId,
  onSelect,
}: {
  path: ExposurePath;
  selectedId: string | null;
  onSelect: (n: ExposureGraphNode) => void;
}) {
  return (
    <div className="gxg-lane">
      <div className="gxg-lane-head">
        <span className="gxg-lane-title">{path.label}</span>
        <span className="gxg-lane-type">{path.issueType}</span>
        <span className="gxg-lane-impact">{path.impactDisplay} value at stake</span>
      </div>
      <div className="gxg-flow" role="list">
        {path.nodes.map((node, i) => (
          <div className="gxg-flow-cell" role="listitem" key={node.id}>
            <NodeCard node={node} selected={selectedId === node.id} onSelect={onSelect} />
            {i < path.nodes.length - 1 && <span className="gxg-arrow" aria-hidden="true" />}
          </div>
        ))}
      </div>
    </div>
  );
}

function DetailPanel({ node, onClose }: { node: ExposureGraphNode; onClose: () => void }) {
  return (
    <aside className="gxg-detail">
      <div className="gxg-detail-head">
        <span className={`gxg-badge gxg-badge-${node.status}`}>{node.statusLabel}</span>
        <button type="button" className="gxg-detail-close" onClick={onClose} aria-label="Close detail">
          ✕
        </button>
      </div>
      <h4 className="gxg-detail-title">{node.title}</h4>
      {node.subtitle && <p className="gxg-detail-sub">{node.subtitle}</p>}
      {node.valueLabel && <p className="gxg-detail-value">{node.valueLabel}</p>}
      <dl className="gxg-detail-list">
        {node.sourceLabel && (
          <>
            <dt>Source</dt>
            <dd>{node.sourceLabel}</dd>
          </>
        )}
        {node.meta?.formula && (
          <>
            <dt>Formula</dt>
            <dd>{node.meta.formula}</dd>
          </>
        )}
        {node.meta?.owner && (
          <>
            <dt>Owner</dt>
            <dd>
              {node.meta.owner}
              {node.meta.due ? ` · Due ${node.meta.due}` : ""}
            </dd>
          </>
        )}
        {node.caveat && (
          <>
            <dt>Caveat</dt>
            <dd>{node.caveat}</dd>
          </>
        )}
      </dl>
    </aside>
  );
}

export default function CompanyExposureGraph({
  model,
  auditContent,
}: {
  model: ExposureGraphModel;
  auditContent?: ReactNode;
}) {
  const [tab, setTab] = useState<TabKey>("active");
  const [selected, setSelected] = useState<ExposureGraphNode | null>(null);

  const allNodes = [
    ...model.activePaths.flatMap((p) => p.nodes),
    ...model.blockedLanes.flatMap((l) => l.nodes),
  ];
  const selectNode = (n: ExposureGraphNode) =>
    setSelected((prev) => (prev?.id === n.id ? null : n));

  const tabs: { key: TabKey; label: string; count?: number }[] = [
    { key: "active", label: "Active paths", count: model.summary.activeCount },
    { key: "supporting", label: "Supporting signals", count: model.summary.supportingCount },
    { key: "blocked", label: "Blocked candidates", count: model.summary.blockedCount },
    { key: "audit", label: "Audit / raw paths" },
  ];

  return (
    <div className="gxg-root">
      <style>{EXPOSURE_GRAPH_CSS}</style>

      <p className="gxg-subhead">
        Verified shocks mapped to company exposure, calculations, business impact, and actions.
      </p>

      {/* Summary chips */}
      <div className="gxg-summary">
        <div className="gxg-chip">
          <span className="gxg-chip-value">{model.summary.activeCount}</span>
          <span className="gxg-chip-label">Active paths</span>
        </div>
        <div className="gxg-chip gxg-chip-primary">
          <span className="gxg-chip-value">{model.summary.valueAtStake}</span>
          <span className="gxg-chip-label">Quantified value at stake</span>
        </div>
        <div className="gxg-chip">
          <span className="gxg-chip-value">{model.summary.blockedCount}</span>
          <span className="gxg-chip-label">Blocked candidates</span>
        </div>
        <div className="gxg-chip">
          <span className="gxg-chip-value">{model.summary.supportingCount}</span>
          <span className="gxg-chip-label">Supporting signals</span>
        </div>
      </div>

      {/* Tabs */}
      <div className="gxg-tabs" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            className={`gxg-tab ${tab === t.key ? "gxg-tab-on" : ""}`}
            onClick={() => {
              setTab(t.key);
              setSelected(null);
            }}
          >
            {t.label}
            {typeof t.count === "number" && <span className="gxg-tab-count">{t.count}</span>}
          </button>
        ))}
        <div className="gxg-tab-links">
          <Link to="/sources" className="gxg-link">
            Source Hub →
          </Link>
          <Link to="/calibration" className="gxg-link">
            Calibration Center →
          </Link>
        </div>
      </div>

      {/* Active paths */}
      {tab === "active" && (
        <div className="gxg-body">
          <div className="gxg-active">
            <div className="gxg-col-legend" aria-hidden="true">
              {COLUMN_LABELS.map((_, i) => (
                <ColumnLabel key={i} index={i} />
              ))}
            </div>
            {model.activePaths.length === 0 ? (
              <p className="gxg-empty">No active exposure paths — verified shocks not yet mapped.</p>
            ) : (
              model.activePaths.map((p) => (
                <PathLane key={p.id} path={p} selectedId={selected?.id ?? null} onSelect={selectNode} />
              ))
            )}
            <p className="gxg-foot">
              Steel, aluminum, and copper price signals support the tariff path but are not separate
              dollar estimates — see the Supporting signals tab.
            </p>
          </div>
          {selected && <DetailPanel node={selected} onClose={() => setSelected(null)} />}
        </div>
      )}

      {/* Supporting signals */}
      {tab === "supporting" && (
        <div className="gxg-support">
          <p className="gxg-support-note">
            Context only — supporting signals do not receive independent dollar estimates and are never
            counted in value at stake.
          </p>
          <div className="gxg-support-grid">
            {model.supportingSignals.map((s) => (
              <div key={s.id} className="gxg-support-card">
                <div className="gxg-support-top">
                  <span className="gxg-support-label">{s.label}</span>
                  <span className={`gxg-badge gxg-badge-context`}>{s.statusLabel}</span>
                </div>
                <p className="gxg-support-detail">{s.detail}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Blocked candidates */}
      {tab === "blocked" && (
        <div className="gxg-body">
          <div className="gxg-active">
            {model.blockedLanes.length === 0 ? (
              <p className="gxg-empty">No blocked candidates this cycle.</p>
            ) : (
              model.blockedLanes.map((lane) => (
                <div key={lane.id} className="gxg-lane gxg-lane-blocked">
                  <div className="gxg-lane-head">
                    <span className="gxg-lane-title">{lane.label}</span>
                    <span className="gxg-lane-type gxg-lane-type-blocked">
                      Not promoted · excluded from value at stake
                    </span>
                  </div>
                  <div className="gxg-flow" role="list">
                    {lane.nodes.map((node, i) => (
                      <div className="gxg-flow-cell" role="listitem" key={node.id}>
                        <NodeCard node={node} selected={selected?.id === node.id} onSelect={selectNode} />
                        {i < lane.nodes.length - 1 && <span className="gxg-arrow gxg-arrow-blocked" aria-hidden="true" />}
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
            <p className="gxg-foot">
              Blocked candidates carry no dollar estimate and create no executive action until
              company-specific evidence promotes them through the quality gate.
            </p>
          </div>
          {selected && <DetailPanel node={selected} onClose={() => setSelected(null)} />}
        </div>
      )}

      {/* Audit / raw paths */}
      {tab === "audit" && (
        <div className="gxg-audit">
          <p className="gxg-support-note">
            Raw exposure paths and sensitivity — engineering audit view, not the executive estimate.
          </p>
          {auditContent ?? <p className="gxg-empty">No raw paths recorded.</p>}
        </div>
      )}

      {/* a11y: keyboard users can still reach every node via the tab order above */}
      {allNodes.length === 0 && <span className="gxg-sr" />}
    </div>
  );
}
