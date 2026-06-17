import { useState } from "react";
import { useNavigate } from "react-router-dom";
import AuthLayout from "../../components/auth/AuthLayout";
import * as authService from "../../services/authService";

// Supabase delivers the user here via the recovery link with an active recovery
// session, so updateUser({ password }) works without re-entering the old one.
export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Use at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setLoading(true);
    try {
      await authService.updatePassword(password);
      setDone(true);
      setTimeout(() => navigate("/dashboard", { replace: true }), 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update password.");
      setLoading(false);
    }
  }

  return (
    <AuthLayout title="Set a new password" subtitle="Choose a new password for your account.">
      {done ? (
        <div className="gs-auth-alert is-success">
          Password updated. Taking you to your dashboard…
        </div>
      ) : (
        <form onSubmit={onSubmit} noValidate>
          {error && <div className="gs-auth-alert is-error">{error}</div>}
          <div className="gs-field">
            <label className="gs-label" htmlFor="rp-pass">New password</label>
            <input
              id="rp-pass"
              type="password"
              className="gs-input"
              value={password}
              autoComplete="new-password"
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <div className="gs-field">
            <label className="gs-label" htmlFor="rp-confirm">Confirm password</label>
            <input
              id="rp-confirm"
              type="password"
              className="gs-input"
              value={confirm}
              autoComplete="new-password"
              onChange={(e) => setConfirm(e.target.value)}
            />
          </div>
          <button className="gs-btn-primary" type="submit" disabled={loading}>
            {loading ? "Updating…" : "Update password"}
          </button>
        </form>
      )}
    </AuthLayout>
  );
}
