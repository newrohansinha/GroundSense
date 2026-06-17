import { useState } from "react";

// Collapsible in-page section nav for the Dashboard only (jumps to section anchors).
// Not the same as the top nav — this scrolls within the dashboard page.
const SECTIONS = [
  { id: "overview", label: "Overview" },
  { id: "brief", label: "Brief" },
  { id: "exposure", label: "Exposure Graph" },
  { id: "actions", label: "Actions" },
  { id: "opportunities", label: "Opportunities" },
  { id: "support", label: "Calibration / Sources" },
  { id: "outcomes", label: "Outcomes" },
  { id: "register", label: "Risk Register" },
];

export default function DashboardSidebar() {
  const [collapsed, setCollapsed] = useState(false);

  function jump(id: string) {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <aside className={`gs-dash-sidebar ${collapsed ? "is-collapsed" : ""}`}>
      <div className="gs-dash-sidebar-inner">
        <button
          type="button"
          className="gs-dash-sidebar-toggle"
          onClick={() => setCollapsed((v) => !v)}
          aria-label={collapsed ? "Expand section nav" : "Collapse section nav"}
          title={collapsed ? "Expand" : "Collapse"}
        >
          {collapsed ? "»" : "«"}
        </button>
        {!collapsed && (
          <nav className="gs-dash-sidebar-nav">
            {SECTIONS.map((s) => (
              <button key={s.id} type="button" className="gs-dash-sidebar-link" onClick={() => jump(s.id)}>
                {s.label}
              </button>
            ))}
          </nav>
        )}
      </div>
    </aside>
  );
}
