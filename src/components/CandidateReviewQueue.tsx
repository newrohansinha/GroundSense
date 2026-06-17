import { useState } from "react";
import { type IssueGateResult, type GateDecision } from "../services/issueQualityGateService";

export type CandidateQueueItem = {
  id: string;
  type: "risk" | "opportunity";
  title: string;
  gateResult: IssueGateResult;
};

function decisionLabel(decision: GateDecision): string {
  switch (decision) {
    case "quarantine": return "Quarantined";
    case "candidate_review": return "Pending Review";
    case "watchlist": return "Moved to Watchlist";
    default: return decision;
  }
}

function decisionClass(decision: GateDecision): string {
  switch (decision) {
    case "quarantine": return "cq-decision-quarantine";
    case "candidate_review": return "cq-decision-candidate";
    case "watchlist": return "cq-decision-watchlist";
    default: return "";
  }
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  const color = value >= 60 ? "var(--success)" : value >= 35 ? "var(--warning)" : "var(--danger)";
  return (
    <div className="cq-score-row">
      <span className="cq-score-label">{label}</span>
      <div className="cq-score-bar-track">
        <div className="cq-score-bar-fill" style={{ width: `${value}%`, background: color }} />
      </div>
      <span className="cq-score-value">{value}</span>
    </div>
  );
}

function CandidateCard({ item }: { item: CandidateQueueItem }) {
  const [expanded, setExpanded] = useState(false);
  const { gateResult } = item;

  return (
    <div className="cq-card">
      <div className="cq-card-top">
        <div className="cq-card-left">
          <div className="cq-badge-row">
            <span className={`cq-decision-badge ${decisionClass(gateResult.decision)}`}>
              {decisionLabel(gateResult.decision)}
            </span>
            <span className="cq-type-badge">
              {item.type === "opportunity" ? "Opportunity candidate" : "Risk candidate"}
            </span>
          </div>
          <p className="cq-title">{item.title}</p>
        </div>
        <div className="cq-card-right">
          <span className="cq-quality-score">Quality {gateResult.qualityScore}/100</span>
          <button className="text-button" onClick={() => setExpanded(!expanded)}>
            {expanded ? "Hide analysis" : "Show analysis"}
          </button>
        </div>
      </div>

      {!expanded && gateResult.reasons.length > 0 && (
        <p className="cq-reason-preview">{gateResult.reasons[0]}</p>
      )}

      {expanded && (
        <div className="cq-expanded">
          <div className="cq-scores-section">
            <ScoreBar label="Evidence alignment" value={gateResult.evidenceAlignmentScore} />
            <ScoreBar label="Company relevance" value={gateResult.companyRelevanceScore} />
            <ScoreBar label="Overall quality" value={gateResult.qualityScore} />
          </div>

          {gateResult.reasons.length > 0 && (
            <div className="cq-section">
              <p className="cq-section-title">Why blocked</p>
              <ul className="cq-list">
                {gateResult.reasons.map((r, i) => (
                  <li key={i} className="cq-list-item cq-reason">{r}</li>
                ))}
              </ul>
            </div>
          )}

          {gateResult.claims.length > 0 && (
            <div className="cq-section">
              <p className="cq-section-title">
                Evidence reviewed ({gateResult.evidenceCount} items — {gateResult.alignedCount} aligned, {gateResult.irrelevantCount} unrelated)
              </p>
              <ul className="cq-list">
                {gateResult.claims.map((c, i) => (
                  <li key={i} className="cq-list-item">
                    <span className={`cq-evidence-status ${c.driver === "irrelevant" || c.claim_type === "irrelevant_or_noise" ? "cq-ev-unrelated" : "cq-ev-aligned"}`}>
                      {c.driver === "irrelevant" || c.claim_type === "irrelevant_or_noise" ? "✗ unrelated" : "✓ aligned"}
                    </span>
                    <span className="cq-ev-title">{c.title || "(no title)"}</span>
                    {c.source && <span className="cq-ev-source"> — {c.source}</span>}
                    {c.alignment_note && (
                      <span className="cq-ev-note"> · {c.alignment_note}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {gateResult.requiredToPromote.length > 0 && (
            <div className="cq-section">
              <p className="cq-section-title">Required to promote to executive dashboard</p>
              <ul className="cq-list">
                {gateResult.requiredToPromote.map((r, i) => (
                  <li key={i} className="cq-list-item cq-required">{r}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="cq-forecast-row">
            <span className="cq-forecast-label">Forecast eligible:</span>
            <span className={`cq-forecast-value ${gateResult.forecastEligible ? "cq-forecast-yes" : "cq-forecast-no"}`}>
              {gateResult.forecastEligible ? "Yes" : "No — not eligible until promoted"}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

export default function CandidateReviewQueue({ items }: { items: CandidateQueueItem[] }) {
  if (items.length === 0) return null;

  const quarantined = items.filter((i) => i.gateResult.decision === "quarantine").length;
  const candidateReview = items.filter((i) => i.gateResult.decision === "candidate_review").length;

  return (
    <section className="card cq-section-wrapper">
      <div className="card-header">
        <div>
          <p className="eyebrow">Reviewed but excluded from executive estimates until evidence improves</p>
          <h2 className="section-title">Items not promoted</h2>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {quarantined > 0 && (
            <span className="badge cq-badge-quarantine">{quarantined} quarantined</span>
          )}
          {candidateReview > 0 && (
            <span className="badge cq-badge-candidate">{candidateReview} pending review</span>
          )}
        </div>
      </div>
      <p className="cq-intro">
        These items were generated but did not pass the evidence quality gate.
        They are not shown in executive sections until promoted.
      </p>
      <div className="cq-cards">
        {items.map((item) => (
          <CandidateCard key={item.id} item={item} />
        ))}
      </div>
    </section>
  );
}
