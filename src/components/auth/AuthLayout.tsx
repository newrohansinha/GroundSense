import type { ReactNode } from "react";
import "./auth.css";

// Split auth chrome: left value-prop rail, right form pane. Theme-safe.
export default function AuthLayout({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <div className="gs-auth">
      <aside className="gs-auth-aside">
        <div className="gs-auth-brand">
          <span className="gs-auth-brand-dot" />
          GroundSense
        </div>

        <div className="gs-auth-pitch">
          <h1>External shocks, mapped to your dollar exposure.</h1>
          <p>
            GroundSense turns events into company-specific exposure — event →
            operating path → financial driver → dollar impact → action — using
            your own operating data.
          </p>
          <div className="gs-auth-flow">
            <div className="gs-auth-flow-step">
              <b>Event</b> <span className="gs-auth-flow-arrow">→</span> operating path
            </div>
            <div className="gs-auth-flow-step">
              <span className="gs-auth-flow-arrow">→</span> financial driver
              <span className="gs-auth-flow-arrow">→</span> <b>$ exposure</b>
            </div>
            <div className="gs-auth-flow-step">
              <span className="gs-auth-flow-arrow">→</span> recommended action
            </div>
          </div>
        </div>

        <div className="gs-auth-foot">Executive intelligence, evidence-backed.</div>
      </aside>

      <main className="gs-auth-main">
        <div className="gs-auth-card">
          <h2>{title}</h2>
          {subtitle && <p className="gs-auth-sub">{subtitle}</p>}
          {children}
        </div>
      </main>
    </div>
  );
}
