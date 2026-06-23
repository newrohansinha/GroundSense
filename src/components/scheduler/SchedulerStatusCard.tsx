import { useEffect, useState, useCallback } from "react";
import {
  getSchedulerStatus,
  setScheduleEnabled,
  type SchedulerStatus,
} from "../../services/schedulerService";
import RunHistoryPanel from "./RunHistoryPanel";

function relative(iso: string | null): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.round(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function cronTime(cron: string): string {
  const parts = cron.split(" ");
  const minute = parts[0] ?? "0";
  const hour = parts[1] ?? "0";
  return `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
}

function nextLabel(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short" });
}

const STATUS_TONE: Record<string, string> = {
  completed: "var(--success)",
  completed_with_warnings: "var(--warning)",
  running: "var(--accent)",
  queued: "var(--text-muted)",
  skipped: "var(--text-muted)",
  failed: "var(--danger)",
};

export default function SchedulerStatusCard({
  companyId,
  onRunNow,
  running,
  refreshKey = 0,
  canWrite = true,
  currentRegister,
}: {
  companyId: string | null;
  onRunNow?: () => void;
  running?: boolean;
  refreshKey?: number;
  canWrite?: boolean;
  // Live register counts from the dashboard. Preferred over the stored last-run
  // snapshot so the card never contradicts the current published issue count.
  currentRegister?: { published: number; pending: number; quarantined: number };
}) {
  const [status, setStatus] = useState<SchedulerStatus | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    getSchedulerStatus(companyId).then(setStatus).catch(() => setStatus(null));
  }, [companyId]);

  useEffect(() => { load(); }, [load, refreshKey]);

  const cfg = status?.config;
  const last = status?.lastRun;
  const lastScheduled = status?.lastScheduledRun ?? null;
  const scheduledSuccessEver = status?.scheduledSuccessEver ?? false;
  const enabled = cfg?.enabled ?? false;
  const activeRun = status?.activeRun ?? null;

  // The schedule says "enabled" but the automated path has never produced a
  // successful run — surface that honestly instead of a silent green "enabled".
  const scheduleNeverSucceeded = enabled && !scheduledSuccessEver;
  const lastScheduledFailed = lastScheduled?.status === "failed";

  // Honest one-liner for the scheduled path's last result.
  const scheduledLine = !lastScheduled
    ? "No scheduled run has executed yet"
    : lastScheduled.status === "failed"
    ? `Failed — ${lastScheduled.error_message ?? "see history"}`
    : lastScheduled.status === "skipped"
    ? `Skipped — ${lastScheduled.skipped_reason ?? "no material change"}`
    : `${lastScheduled.status.replace(/_/g, " ")} · ${relative(lastScheduled.started_at)}`;

  async function toggleEnabled() {
    if (!cfg) return;
    setBusy(true);
    await setScheduleEnabled(cfg.id, !cfg.enabled);
    load();
    setBusy(false);
  }

  // Prefer the live register count over the last-run snapshot, which can lag the
  // current dashboard (e.g. snapshot says 4 published while the register now has 5).
  const resultLine = last && last.status === "skipped"
    ? `Skipped — ${last.skipped_reason ?? "no material change"}`
    : last && last.status === "failed"
    ? `Failed — ${last.error_message ?? "see history"}`
    : currentRegister
    ? `Current register: ${currentRegister.published} published · ${currentRegister.pending} pending · ${currentRegister.quarantined} quarantined`
    : last
    ? `${last.candidates_published} published · ${last.candidates_review} pending · ${last.candidates_quarantined} quarantined`
    : "No runs recorded yet";

  return (
    <section className="card">
      <style>{`
        .gs-sched-head { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; flex-wrap:wrap; }
        .gs-sched-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:14px; margin-top:14px; }
        .gs-sched-k { font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.05em; color:var(--text-faint); margin:0 0 3px; }
        .gs-sched-v { font-size:14px; color:var(--text-primary); margin:0; font-weight:600; }
        .gs-sched-actions { display:flex; gap:8px; flex-wrap:wrap; margin-top:14px; }
        .gs-sched-dot { display:inline-block; width:8px; height:8px; border-radius:50%; margin-right:6px; vertical-align:middle; }
      `}</style>
      <div className="gs-sched-head">
        <div>
          <p className="eyebrow">Automation</p>
          <h2 className="section-title">Intelligence Schedule</h2>
          <p className="dashboard-subtitle" style={{ marginTop: 4, marginBottom: 0 }}>
            <span className="gs-sched-dot" style={{ background: enabled ? "var(--success)" : "var(--text-faint)" }} />
            {cfg ? (enabled ? `Enabled · ${cfg.cadence} at ${cronTime(cfg.cron_expression)} ${cfg.timezone}` : "Disabled") : "Schedule not configured"}
          </p>
        </div>
        <span className="badge" style={{ color: STATUS_TONE[last?.status ?? "queued"] }}>
          {last ? last.status.replace(/_/g, " ") : "no runs"}
        </span>
      </div>

      <div className="gs-sched-grid">
        <div>
          <p className="gs-sched-k">Last run (any trigger)</p>
          <p className="gs-sched-v">{last ? `${last.trigger_type} · ${relative(last.started_at)}` : "—"}</p>
        </div>
        <div>
          <p className="gs-sched-k">Last scheduled run</p>
          <p className="gs-sched-v" style={lastScheduledFailed ? { color: "var(--danger)" } : undefined}>
            {scheduledLine}
          </p>
        </div>
        <div>
          <p className="gs-sched-k">Result</p>
          <p className="gs-sched-v">{resultLine}</p>
        </div>
        <div>
          <p className="gs-sched-k">Next scheduled</p>
          <p className="gs-sched-v">{enabled ? nextLabel(status?.nextRunIso ?? null) : "Paused"}</p>
        </div>
      </div>

      {(scheduleNeverSucceeded || lastScheduledFailed) && (
        <div className="dashboard-subtitle" style={{ marginTop: 12, padding: "10px 12px", borderRadius: 8, background: "var(--danger-bg)", border: "1px solid var(--danger-border, var(--danger))" }}>
          <b style={{ color: "var(--danger)" }}>⚠ Scheduled automation needs attention</b> —{" "}
          {scheduleNeverSucceeded
            ? "the schedule is enabled but no scheduled run has ever completed. The daily run history below will confirm once the next 10:00 UTC run succeeds."
            : `the last scheduled run failed${lastScheduled?.error_message ? ` (${lastScheduled.error_message})` : ""}. Check run history for details.`}
        </div>
      )}

      {activeRun && (
        <div className="dashboard-subtitle" style={{ marginTop: 12, padding: "10px 12px", borderRadius: 8, background: "var(--accent-muted)", border: "1px solid var(--accent)" }}>
          <b>Run in progress</b> — {activeRun.current_stage_label ?? "working…"}
          {typeof activeRun.progress_pct === "number" ? ` · ${activeRun.progress_pct}%` : ""}
          {activeRun.current_stage_index && activeRun.total_stages ? ` (stage ${activeRun.current_stage_index}/${activeRun.total_stages})` : ""}.
          {" "}Dashboard below shows the latest completed results until it finishes.
        </div>
      )}

      <div className="gs-sched-actions">
        {onRunNow && canWrite && (
          <button className="primary-button" onClick={onRunNow} disabled={running || !!activeRun}>
            {running || activeRun ? "Run in progress…" : "Run now"}
          </button>
        )}
        {canWrite && (
          <button className="secondary-button" onClick={() => { setShowHistory((v) => !v); }}>
            {showHistory ? "Hide run history" : "View run history"}
          </button>
        )}
        {cfg && canWrite && (
          <button className="secondary-button" onClick={toggleEnabled} disabled={busy}>
            {enabled ? "Disable schedule" : "Enable schedule"}
          </button>
        )}
      </div>

      {showHistory && (
        <div style={{ marginTop: 16 }}>
          <RunHistoryPanel companyId={companyId} limit={10} refreshKey={refreshKey} />
        </div>
      )}
    </section>
  );
}
