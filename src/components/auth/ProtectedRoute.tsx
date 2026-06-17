import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { useCompany } from "../../context/CompanyContext";
import "./auth.css";

function RouteLoading() {
  return (
    <div className="gs-route-loading">
      <span className="gs-spinner" />
      Loading your workspace…
    </div>
  );
}

// App pages (dashboard, calibration, sources, risks).
// Allows the public demo path. Otherwise requires auth + completed onboarding.
export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const { company, loading: companyLoading, demo } = useCompany();

  if (demo) return <>{children}</>;
  if (authLoading) return <RouteLoading />;
  if (!user) return <Navigate to="/sign-in" replace />;
  if (companyLoading) return <RouteLoading />;
  if (!company || company.onboarding_status !== "completed") {
    return <Navigate to="/onboarding" replace />;
  }
  return <>{children}</>;
}

// The onboarding wizard. Requires auth. If already onboarded, go to dashboard.
export function OnboardingRoute({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const { company, loading: companyLoading } = useCompany();

  if (authLoading) return <RouteLoading />;
  if (!user) return <Navigate to="/sign-in" replace />;
  if (companyLoading) return <RouteLoading />;
  if (company?.onboarding_status === "completed") {
    return <Navigate to="/dashboard" replace />;
  }
  return <>{children}</>;
}

// Auth pages (sign-in / sign-up). Bounce already-authenticated users onward.
export function PublicAuthRoute({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const { company, loading: companyLoading } = useCompany();

  if (authLoading) return <RouteLoading />;
  if (user) {
    if (companyLoading) return <RouteLoading />;
    return (
      <Navigate
        to={company?.onboarding_status === "completed" ? "/dashboard" : "/onboarding"}
        replace
      />
    );
  }
  return <>{children}</>;
}
