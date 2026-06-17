import { useState } from "react";
import { Link } from "react-router-dom";
import AuthLayout from "../../components/auth/AuthLayout";
import * as authService from "../../services/authService";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await authService.requestPasswordReset(email);
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send reset link.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout
      title="Reset password"
      subtitle="We'll email you a link to set a new password."
    >
      {sent ? (
        <>
          <div className="gs-auth-alert is-success">
            If an account exists for <b>{email}</b>, a reset link is on its way.
          </div>
          <Link to="/sign-in" className="gs-auth-link">← Back to sign in</Link>
        </>
      ) : (
        <form onSubmit={onSubmit} noValidate>
          {error && <div className="gs-auth-alert is-error">{error}</div>}
          <div className="gs-field">
            <label className="gs-label" htmlFor="fp-email">Work email</label>
            <input
              id="fp-email"
              type="email"
              className="gs-input"
              value={email}
              autoComplete="email"
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <button className="gs-btn-primary" type="submit" disabled={loading}>
            {loading ? "Sending…" : "Send reset link"}
          </button>
          <p className="gs-auth-alt">
            <Link to="/sign-in" className="gs-auth-link">← Back to sign in</Link>
          </p>
        </form>
      )}
    </AuthLayout>
  );
}
