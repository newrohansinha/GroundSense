import { useEffect, useState } from "react";
import { getRunHistory, type RunSummary } from "../../services/schedulerService";

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
function duration(a: string, b: string | null): string {
  if (!b) return "—";
  const s = Math.round((new Date(b).getTime() - new Date(a).getTime()) / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

const TONE: Record<string, string> = {
  completed: "var(--success-bg)",
  completed_with_warnings: "var(--warning-bg)",
  running: "var(--accent-muted)",
  skipped: "var(--bg-surface-muted)",
  failed: "var(--danger-bg)",
};
const TONE_FG: Record<string, string> = {
  completed: "var(--success)",
  completed_with_warnings: "var(--warning)",
  running: "var(--accent)",
  skipped: "var(--text-muted)",
  failed: "var(--danger)",
};

export default function RunHistoryPanel({ companyId, limit = 25, refreshKey = 0 }: { companyId: string | null; limit?: number; refreshKey?: number }) {
  const [rows, setRows] = useState<RunSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getRunHistory(companyId, limit).then((r) => { setRows(r); setLoading(false); }).catch(() => setLoading(false));
  }, [companyId, limit, refreshKey]);

  return (
    <div className="gs-runhist">
      <style>{`
        .gs-runhist { overflow-x:auto; }
        .gs-runhist table { width:100%; border-collapse:collapse; font-size:13px; }
        .gs-runhist th { text-align:left; font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.05em;
          color:var(--text-faint); padding:6px 10px; border-bottom:1px solid var(--border-default); white-space:nowrap; }
        .gs-runhist td { padding:9px 10px; border-bottom:1px solid var(--border-subtle); color:var(--text-secondary); white-space:nowrap; }
        .gs-runhist tr:last-child td { border-bottom:none; }
        .gs-runhist-status { font-size:11px; font-weight:700; padding:2px 8px; border-radius:999px; text-transform:capitalize; }
        .gs-runhist-empty { color:var(--text-muted); font-size:13px; padding:12px 2px; }
      `}</style>
      {loading ? (
        <p className="gs-runhist-empty">Loading run history…</p>
      ) : rows.length === 0 ? (
        <p className="gs-runhist-empty">No intelligence runs recorded yet. Runs appear here after the first manual or scheduled update.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Started</th><th>Trigger</th><th>Status</th><th>Duration</th>
              <th>Sources</th><th>Obs</th><th>Shocks</th><th>Generated</th>
              <th>Published</th><th>Review</th><th>Quar.</th><th>Active actions</th><th>Brief</th><th>Note</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{fmtTime(r.started_at)}</td>
                <td>{r.trigger_type}</td>
                <td>
                  <span className="gs-runhist-status" style={{ background: TONE[r.status] ?? "var(--bg-surface-muted)", color: TONE_FG[r.status] ?? "var(--text-muted)" }}>
                    {r.status.replace(/_/g, " ")}
                  </span>
                </td>
                <td>{duration(r.started_at, r.completed_at)}</td>
                <td>{r.sources_checked}</td>
                <td>{r.observations_ingested}</td>
                <td>{r.verified_shocks_created}</td>
                <td>{r.candidates_generated}</td>
                <td>{r.candidates_published}</td>
                <td>{r.candidates_review}</td>
                <td>{r.candidates_quarantined}</td>
                <td>{r.actions_created}</td>
                <td>{r.executive_brief_rebuilt ? "✓" : "—"}</td>
                <td style={{ color: "var(--text-muted)", whiteSpace: "normal", maxWidth: 220 }}>
                  {r.error_message ?? r.skipped_reason ?? ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
