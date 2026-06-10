import { Routes, Route, Navigate } from "react-router-dom";
import OnboardingPage from "./pages/OnboardingPage";
import DashboardPage from "./pages/DashboardPage";
import CalibrationPage from "./pages/CalibrationPage";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="/onboarding" element={<OnboardingPage />} />
      <Route path="/dashboard" element={<DashboardPage />} />
      <Route path="/calibration" element={<CalibrationPage />} />
    </Routes>
  );
}