import { useState, useEffect, useRef } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { getTheme, toggleTheme, type Theme } from "../../lib/theme";
import { useAuth } from "../../context/AuthContext";
import { useCompany } from "../../context/CompanyContext";
import { clearActiveCompany, buyerCompanyName } from "../../services/companyService";

const NAV = [
  { to: "/dashboard", label: "Dashboard" },
  { to: "/calibration", label: "Calibration" },
  { to: "/sources", label: "Sources" },
  { to: "/risks", label: "Risks" },
];

export default function TopNav() {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const { company, demo } = useCompany();
  const [theme, setThemeState] = useState<Theme>("dark");
  const [open, setOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setThemeState(getTheme());
  }, []);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  function onToggleTheme() {
    setThemeState(toggleTheme());
  }

  async function onSignOut() {
    await signOut();
    navigate("/", { replace: true });
  }

  function exitDemo() {
    clearActiveCompany();
    navigate("/", { replace: true });
  }

  const onboardingComplete = company?.onboarding_status === "completed";
  const initial = (user?.email ?? "?").charAt(0).toUpperCase();

  return (
    <nav className="gs-topnav">
      <div className="gs-topnav-inner">
        <NavLink to="/dashboard" className="gs-brand">
          <span className="gs-brand-dot" />
          GroundSense
        </NavLink>

        {company && (
          <span className="gs-co-chip" title={buyerCompanyName(company.name)}>
            {buyerCompanyName(company.name)}
            {demo && <span className="gs-co-demo">DEMO</span>}
          </span>
        )}

        <div className={`gs-nav-links ${open ? "is-open" : ""}`}>
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => `gs-nav-link ${isActive ? "is-active" : ""}`}
              onClick={() => setOpen(false)}
            >
              {item.label}
            </NavLink>
          ))}
        </div>

        <span className="gs-nav-spacer" />

        <button
          type="button"
          className="gs-theme-toggle"
          onClick={onToggleTheme}
          aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          title={theme === "dark" ? "Light mode" : "Dark mode"}
        >
          {theme === "dark" ? "☀" : "☾"}
        </button>

        {demo && !user ? (
          <button type="button" className="gs-nav-ghost-btn" onClick={() => navigate("/sign-up")}>
            Get started
          </button>
        ) : null}

        {user ? (
          <div className="gs-usermenu" ref={menuRef}>
            <button
              type="button"
              className="gs-avatar"
              onClick={() => setMenuOpen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              title={user.email ?? "Account"}
            >
              {initial}
            </button>
            {menuOpen && (
              <div className="gs-menu" role="menu">
                <div className="gs-menu-head">
                  <div className="gs-menu-email">{user.email}</div>
                  {company && <div className="gs-menu-co">{buyerCompanyName(company.name)}</div>}
                  <div className={`gs-menu-status ${onboardingComplete ? "is-done" : "is-pending"}`}>
                    {onboardingComplete ? "Onboarding complete" : "Setup in progress"}
                  </div>
                </div>
                <button className="gs-menu-item" role="menuitem" onClick={() => { setMenuOpen(false); navigate("/calibration"); }}>
                  Company settings
                </button>
                {!onboardingComplete && (
                  <button className="gs-menu-item" role="menuitem" onClick={() => { setMenuOpen(false); navigate("/onboarding"); }}>
                    Continue setup
                  </button>
                )}
                <button className="gs-menu-item gs-menu-danger" role="menuitem" onClick={onSignOut}>
                  Sign out
                </button>
              </div>
            )}
          </div>
        ) : demo ? (
          <button type="button" className="gs-nav-ghost-btn" onClick={exitDemo}>Exit demo</button>
        ) : null}

        <button
          type="button"
          className="gs-nav-toggle"
          onClick={() => setOpen((v) => !v)}
          aria-label="Toggle navigation"
        >
          ☰
        </button>
      </div>
    </nav>
  );
}
