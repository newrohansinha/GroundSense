import React, { useState, useEffect } from "react";
import { canViewAdminControls } from "../services/companyService";

type DecisionEntry = {
  firstDetectedAt: string | null;
  lastReviewedAt: string | null;
  nextReviewAt: string | null;
  triageStatus: string | null;
  owner: string | null;
  decisionMade: string | null;
  decisionNotes: string | null;
  actionStatus: string | null;
  status: string;
};

type DecisionMemoryPanelProps = {
  issueId: string;
  issueTitle: string;
  issueType: "risk" | "opportunity" | "operating_change" | "watchlist";
  existing?: DecisionEntry | null;
  ownerFromAction?: string | null;
  // Issue lifecycle dates — used as a fallback for first-detected / last-updated so
  // published issues never show "Not tracked yet" before a decision is recorded.
  issueCreatedAt?: string | null;
  issueUpdatedAt?: string | null;
  onSave?: (entry: Omit<DecisionEntry, "firstDetectedAt" | "lastReviewedAt">) => void;
};

type FormState = {
  decisionMade: string;
  owner: string;
  nextReviewAt: string;
  decisionNotes: string;
  status: string;
};

const EMPTY_FORM: FormState = {
  decisionMade: "",
  owner: "",
  nextReviewAt: "",
  decisionNotes: "",
  status: "open",
};

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return iso;
  }
}

function localKey(issueId: string) {
  return `gs-decision-memory:${issueId}`;
}

export default function DecisionMemoryPanel({
  issueId,
  issueTitle,
  issueType: _issueType,
  existing,
  ownerFromAction,
  issueCreatedAt,
  issueUpdatedAt,
  onSave,
}: DecisionMemoryPanelProps) {
  const [saved, setSaved] = useState<DecisionEntry | null>(existing ?? null);
  const [form, setForm] = useState<FormState>(() => {
    if (existing) {
      return {
        decisionMade: existing.decisionMade ?? "",
        owner: existing.owner ?? "",
        nextReviewAt: existing.nextReviewAt ?? "",
        decisionNotes: existing.decisionNotes ?? "",
        status: existing.status ?? "open",
      };
    }
    return { ...EMPTY_FORM, owner: ownerFromAction ?? "" };
  });
  const [savedLocally, setSavedLocally] = useState(false);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    if (!existing) {
      try {
        const raw = localStorage.getItem(localKey(issueId));
        if (raw) {
          const parsed: DecisionEntry = JSON.parse(raw);
          setSaved(parsed);
          setForm({
            decisionMade: parsed.decisionMade ?? "",
            owner: parsed.owner ?? ownerFromAction ?? "",
            nextReviewAt: parsed.nextReviewAt ?? "",
            decisionNotes: parsed.decisionNotes ?? "",
            status: parsed.status ?? "open",
          });
        } else if (ownerFromAction) {
          setForm((prev) => ({ ...prev, owner: ownerFromAction }));
        }
      } catch {
        // ignore parse errors
      }
    }
  }, [issueId, existing, ownerFromAction]);

  function handleChange(
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  }

  function handleSave() {
    const entry: Omit<DecisionEntry, "firstDetectedAt" | "lastReviewedAt"> = {
      nextReviewAt: form.nextReviewAt || null,
      triageStatus: null,
      owner: form.owner || null,
      decisionMade: form.decisionMade || null,
      decisionNotes: form.decisionNotes || null,
      actionStatus: null,
      status: form.status,
    };

    if (onSave) {
      onSave(entry);
    } else {
      const toStore: DecisionEntry = {
        ...entry,
        firstDetectedAt: saved?.firstDetectedAt ?? new Date().toISOString(),
        lastReviewedAt: new Date().toISOString(),
      };
      try {
        localStorage.setItem(localKey(issueId), JSON.stringify(toStore));
        setSaved(toStore);
        setSavedLocally(true);
      } catch {
        // ignore storage errors
      }
    }

    setShowForm(false);
  }

  const isLocalOnly = !onSave;

  const displayStatus = saved?.status || "Open";
  const displayOwner = saved?.owner || null;
  // Fall back to the issue's own lifecycle dates so published issues show a real
  // "first detected" / "last updated" instead of "Not tracked yet".
  const displayFirstDetected = saved?.firstDetectedAt || issueCreatedAt || null;
  const displayLastReviewed = saved?.lastReviewedAt || issueUpdatedAt || issueCreatedAt || null;
  const displayNextReview = saved?.nextReviewAt || null;

  return (
    <div className="gs-decision-memory-panel">
      <style>{`
        .gs-decision-memory-panel {
          font-family: Inter, ui-sans-serif, system-ui, -apple-system, sans-serif;
          color: var(--text-primary);
          background: var(--bg-surface);
          border: 1px solid var(--border-default);
          border-radius: 18px;
          padding: 20px;
          margin-bottom: 18px;
        }
        .gs-dmp-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 16px;
          gap: 12px;
        }
        .gs-dmp-title {
          margin: 0 0 3px;
          font-size: 17px;
          font-weight: 700;
          letter-spacing: -0.02em;
          color: var(--text-primary);
        }
        .gs-dmp-issue-name {
          font-size: 13px;
          color: var(--text-muted);
          margin: 0;
        }
        .gs-dmp-record-btn {
          font-size: 13px;
          font-weight: 650;
          color: var(--accent-hover);
          background: none;
          border: 1px solid var(--warning-border);
          border-radius: 8px;
          padding: 6px 12px;
          cursor: pointer;
          white-space: nowrap;
          flex-shrink: 0;
          transition: background 120ms ease, border-color 120ms ease;
        }
        .gs-dmp-record-btn:hover {
          background: var(--warning-bg);
          border-color: var(--warning);
        }
        .gs-dmp-status-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 12px 20px;
          margin-bottom: 16px;
          padding-bottom: 16px;
          border-bottom: 1px solid var(--bg-surface-muted);
        }
        .gs-dmp-field {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .gs-dmp-field-label {
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.07em;
          color: var(--text-muted);
        }
        .gs-dmp-field-value {
          font-size: 14px;
          color: var(--text-primary);
          line-height: 1.4;
        }
        .gs-dmp-field-null {
          font-size: 14px;
          color: var(--text-faint);
          font-style: italic;
        }
        .gs-dmp-outcome-row {
          margin-bottom: 16px;
          padding-bottom: 16px;
          border-bottom: 1px solid var(--bg-surface-muted);
        }
        .gs-dmp-outcome-label {
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.07em;
          color: var(--text-muted);
          display: block;
          margin-bottom: 3px;
        }
        .gs-dmp-outcome-text {
          font-size: 14px;
          color: var(--text-secondary);
        }
        .gs-dmp-decision-row {
          margin-bottom: 12px;
          padding-bottom: 12px;
        }
        .gs-dmp-divider {
          border: none;
          border-top: 1px solid var(--border-default);
          margin: 16px 0;
        }
        .gs-dmp-form {
          display: flex;
          flex-direction: column;
          gap: 14px;
        }
        .gs-dmp-form-row {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
        }
        .gs-dmp-form-group {
          display: flex;
          flex-direction: column;
          gap: 5px;
        }
        .gs-dmp-form-group-full {
          grid-column: 1 / -1;
        }
        .gs-dmp-label {
          font-size: 12px;
          font-weight: 650;
          color: var(--text-secondary);
          letter-spacing: 0.01em;
        }
        .gs-dmp-input,
        .gs-dmp-textarea,
        .gs-dmp-select {
          font-family: Inter, ui-sans-serif, system-ui, sans-serif;
          font-size: 14px;
          color: var(--text-primary);
          background: var(--bg-surface);
          border: 1px solid var(--border-strong);
          border-radius: 8px;
          padding: 8px 10px;
          transition: border-color 120ms ease;
          outline: none;
          width: 100%;
          box-sizing: border-box;
        }
        .gs-dmp-input:focus,
        .gs-dmp-textarea:focus,
        .gs-dmp-select:focus {
          border-color: var(--accent-hover);
        }
        .gs-dmp-textarea {
          resize: vertical;
          min-height: 72px;
          line-height: 1.5;
        }
        .gs-dmp-form-actions {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-top: 4px;
        }
        .gs-dmp-save-btn {
          font-size: 14px;
          font-weight: 650;
          color: var(--text-inverse);
          background: var(--accent);
          border: 1px solid var(--accent-hover);
          border-radius: 9px;
          padding: 9px 18px;
          cursor: pointer;
          transition: background 120ms ease;
        }
        .gs-dmp-save-btn:hover {
          background: var(--accent-hover);
        }
        .gs-dmp-cancel-btn {
          font-size: 13px;
          font-weight: 600;
          color: var(--text-muted);
          background: none;
          border: none;
          cursor: pointer;
          padding: 0;
        }
        .gs-dmp-cancel-btn:hover {
          color: var(--text-primary);
        }
        .gs-dmp-local-note {
          font-size: 12px;
          color: var(--text-muted);
          font-style: italic;
        }
        .gs-dmp-saved-banner {
          font-size: 13px;
          color: var(--success);
          font-weight: 600;
        }
      `}</style>

      <div className="gs-dmp-header">
        <div>
          <h3 className="gs-dmp-title">{canViewAdminControls() ? "Decision Memory" : "Decision tracking"}</h3>
          <p className="gs-dmp-issue-name">{issueTitle}</p>
        </div>
        {!showForm && (
          <button className="gs-dmp-record-btn" onClick={() => setShowForm(true)}>
            Record decision
          </button>
        )}
      </div>

      {/* Always show status grid — with placeholders if no data */}
      <div className="gs-dmp-status-grid">
        <div className="gs-dmp-field">
          <span className="gs-dmp-field-label">Status</span>
          <span className="gs-dmp-field-value" style={{ textTransform: "capitalize" }}>{displayStatus}</span>
        </div>
        <div className="gs-dmp-field">
          <span className="gs-dmp-field-label">Owner</span>
          {displayOwner ? (
            <span className="gs-dmp-field-value">{displayOwner}</span>
          ) : ownerFromAction ? (
            <>
              <span className="gs-dmp-field-value">{ownerFromAction}</span>
              <span className="gs-dmp-field-null" style={{ fontSize: 11, display: "block", marginTop: 1 }}>Source: linked action</span>
            </>
          ) : (
            <span className="gs-dmp-field-null">Not assigned</span>
          )}
        </div>
        <div className="gs-dmp-field">
          <span className="gs-dmp-field-label">Next review</span>
          {displayNextReview ? (
            <span className="gs-dmp-field-value">{formatDate(displayNextReview)}</span>
          ) : (
            <span className="gs-dmp-field-null">Not scheduled</span>
          )}
        </div>
        <div className="gs-dmp-field">
          <span className="gs-dmp-field-label">First detected</span>
          {displayFirstDetected ? (
            <span className="gs-dmp-field-value">{formatDate(displayFirstDetected)}</span>
          ) : (
            <span className="gs-dmp-field-null">—</span>
          )}
        </div>
        <div className="gs-dmp-field">
          <span className="gs-dmp-field-label">Last updated</span>
          {displayLastReviewed ? (
            <span className="gs-dmp-field-value">{formatDate(displayLastReviewed)}</span>
          ) : (
            <span className="gs-dmp-field-null">—</span>
          )}
        </div>
        <div className="gs-dmp-field">
          <span className="gs-dmp-field-label">Outcome</span>
          {saved?.decisionMade ? (
            <span className="gs-dmp-field-value">{String(saved.decisionMade).slice(0, 60)}</span>
          ) : (
            <span className="gs-dmp-field-null">Awaiting decision</span>
          )}
        </div>
      </div>

      {saved?.decisionNotes && (
        <div className="gs-dmp-decision-row">
          <span className="gs-dmp-field-label">Notes</span>
          <p className="gs-dmp-field-value" style={{ marginTop: 3 }}>{saved.decisionNotes}</p>
        </div>
      )}

      {savedLocally && isLocalOnly && (
        <p className="gs-dmp-saved-banner" style={{ marginBottom: 12 }}>
          Saved locally. <span className="gs-dmp-local-note">(Local — apply migration to persist)</span>
        </p>
      )}

      {showForm && (
        <>
          <hr className="gs-dmp-divider" />
          <div className="gs-dmp-form">
            <div className="gs-dmp-form-row">
              <div className="gs-dmp-form-group gs-dmp-form-group-full">
                <label className="gs-dmp-label">Decision</label>
                <textarea
                  className="gs-dmp-textarea"
                  name="decisionMade"
                  value={form.decisionMade}
                  onChange={handleChange}
                  placeholder="What was decided? What action was taken or deferred?"
                  rows={3}
                />
              </div>
            </div>
            <div className="gs-dmp-form-row">
              <div className="gs-dmp-form-group">
                <label className="gs-dmp-label">Owner</label>
                <input
                  className="gs-dmp-input"
                  name="owner"
                  type="text"
                  value={form.owner}
                  onChange={handleChange}
                  placeholder="Name or team"
                />
              </div>
              <div className="gs-dmp-form-group">
                <label className="gs-dmp-label">Next review date</label>
                <input
                  className="gs-dmp-input"
                  name="nextReviewAt"
                  type="date"
                  value={form.nextReviewAt}
                  onChange={handleChange}
                />
              </div>
            </div>
            <div className="gs-dmp-form-row">
              <div className="gs-dmp-form-group gs-dmp-form-group-full">
                <label className="gs-dmp-label">Notes</label>
                <textarea
                  className="gs-dmp-textarea"
                  name="decisionNotes"
                  value={form.decisionNotes}
                  onChange={handleChange}
                  placeholder="Context, dependencies, or constraints that informed this decision"
                  rows={2}
                />
              </div>
            </div>
            <div className="gs-dmp-form-row">
              <div className="gs-dmp-form-group">
                <label className="gs-dmp-label">Status</label>
                <select
                  className="gs-dmp-select"
                  name="status"
                  value={form.status}
                  onChange={handleChange}
                >
                  <option value="open">Open</option>
                  <option value="in_review">In review</option>
                  <option value="decided">Decided</option>
                  <option value="closed">Closed</option>
                </select>
              </div>
            </div>
            <div className="gs-dmp-form-actions">
              <button className="gs-dmp-save-btn" onClick={handleSave}>
                Save locally
              </button>
              <button className="gs-dmp-cancel-btn" onClick={() => setShowForm(false)}>
                Cancel
              </button>
              {isLocalOnly && (
                <span className="gs-dmp-local-note">
                  (Local — apply migration to persist)
                </span>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
