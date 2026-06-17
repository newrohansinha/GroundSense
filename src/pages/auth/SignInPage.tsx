import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import AuthLayout from "../../components/auth/AuthLayout";
import * as authService from "../../services/authService";

export default function SignInPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await authService.signIn(email, password);
      // ProtectedRoute will route to onboarding if it isn't complete yet.
      navigate("/dashboard", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign in.");
      setLoading(false);
    }
  }

  return (
    <AuthLayout title="Sign in" subtitle="Sign in to your GroundSense workspace.">
      <form onSubmit={onSubmit} noValidate>
        {error && <div className="gs-auth-alert is-error">{error}</div>}

        <div className="gs-field">
          <label className="gs-label" htmlFor="email">Work email</label>
          <input
            id="email"
            type="email"
            className="gs-input"
            value={email}
            autoComplete="email"
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>

        <div className="gs-field">
          <div className="gs-auth-meta-row">
            <label className="gs-label" htmlFor="password" style={{ margin: 0 }}>
              Password
            </label>
            <Link to="/forgot-password" className="gs-auth-link" style={{ fontSize: 12.5 }}>
              Forgot password?
            </Link>
          </div>
          <input
            id="password"
            type="password"
            className="gs-input"
            value={password}
            autoComplete="current-password"
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>

        <button className="gs-btn-primary" type="submit" disabled={loading}>
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <p className="gs-auth-alt">
        New to GroundSense?{" "}
        <Link to="/sign-up" className="gs-auth-link">Create an account</Link>
      </p>
    </AuthLayout>
  );
}
