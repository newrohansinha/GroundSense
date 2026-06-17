import { Routes, Route } from "react-router-dom";
import LandingPage from "./pages/LandingPage";
import DashboardPage from "./pages/DashboardPage";
import CalibrationPage from "./pages/CalibrationPage";
import CalibrationCenterPage from "./pages/CalibrationCenterPage";
import SourceHubPage from "./pages/SourceHubPage";
import AppShell from "./components/shell/AppShell";
import SignInPage from "./pages/auth/SignInPage";
import SignUpPage from "./pages/auth/SignUpPage";
import ForgotPasswordPage from "./pages/auth/ForgotPasswordPage";
import ResetPasswordPage from "./pages/auth/ResetPasswordPage";
import OnboardingPage from "./pages/OnboardingPage";
import DemoEntry from "./pages/DemoEntry";
import CreateTestAccountPage from "./pages/dev/CreateTestAccountPage";
import {
  ProtectedRoute,
  OnboardingRoute,
  PublicAuthRoute,
} from "./components/auth/ProtectedRoute";

export default function App() {
  return (
    <Routes>
      {/* Public marketing homepage. */}
      <Route path="/" element={<LandingPage />} />

      {/* Public read-only demo (Fastenal sample workspace). */}
      <Route path="/demo" element={<DemoEntry />} />

      {/* Auth. PublicAuthRoute bounces already-signed-in users onward. */}
      <Route path="/sign-in" element={<PublicAuthRoute><SignInPage /></PublicAuthRoute>} />
      <Route path="/sign-up" element={<PublicAuthRoute><SignUpPage /></PublicAuthRoute>} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />

      {/* DEV-ONLY: confirmed test-account creator (bypasses email rate limits). */}
      {import.meta.env.DEV && (
        <Route path="/dev/create-test-account" element={<CreateTestAccountPage />} />
      )}

      {/* Multi-stage onboarding — standalone, no app shell. Requires auth. */}
      <Route
        path="/onboarding"
        element={<OnboardingRoute><OnboardingPage /></OnboardingRoute>}
      />

      {/* Protected app. Demo mode is allowed through ProtectedRoute. */}
      <Route
        path="/dashboard"
        element={<ProtectedRoute><AppShell><DashboardPage view="dashboard" /></AppShell></ProtectedRoute>}
      />
      {/* Risks = system of record; shares the dashboard data layer via the `view` prop. */}
      <Route
        path="/risks"
        element={<ProtectedRoute><AppShell><DashboardPage view="risks" /></AppShell></ProtectedRoute>}
      />
      {/* Full Calibration Center workbench (single source of truth). */}
      <Route
        path="/calibration"
        element={<ProtectedRoute><AppShell><CalibrationCenterPage /></AppShell></ProtectedRoute>}
      />
      {/* Legacy scalar base-assumptions form, now a sub-page under the Center. */}
      <Route
        path="/calibration/base"
        element={<ProtectedRoute><AppShell><CalibrationPage /></AppShell></ProtectedRoute>}
      />
      {/* Free Source Fusion — connectors, structured metrics, verified shocks. */}
      <Route
        path="/sources"
        element={<ProtectedRoute><AppShell><SourceHubPage /></AppShell></ProtectedRoute>}
      />
    </Routes>
  );
}
