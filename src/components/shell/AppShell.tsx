import type { ReactNode } from "react";
import TopNav from "./TopNav";
import "./shell.css";

// Wraps every page with the minimal top nav (Dashboard | Calibration | Sources | Risks)
// and the themed page frame.
export default function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="gs-shell">
      <TopNav />
      {children}
    </div>
  );
}
