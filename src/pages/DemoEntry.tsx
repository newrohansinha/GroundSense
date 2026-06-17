import { useEffect } from "react";
import { useAuth } from "../context/AuthContext";
import { enterDemoMode, isDemoMode } from "../services/companyService";
import "../components/auth/auth.css";

// Canonical public demo entry. For logged-out visitors it activates read-only
// demo mode and hard-navigates to the dashboard (full load so the providers
// re-init and read the flag). Authenticated users are sent to their OWN
// workspace instead — an authenticated session never views demo data.
export default function DemoEntry() {
  const { user, loading } = useAuth();
  useEffect(() => {
    if (loading) return;
    if (user) {
      window.location.replace("/dashboard");
      return;
    }
    if (!isDemoMode()) enterDemoMode();
    window.location.replace("/dashboard");
  }, [user, loading]);
  return (
    <div className="gs-route-loading"><span className="gs-spinner" />Loading demo workspace…</div>
  );
}
