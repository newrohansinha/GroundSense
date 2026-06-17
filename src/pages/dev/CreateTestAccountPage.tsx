import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import AuthLayout from "../../components/auth/AuthLayout";
import * as authService from "../../services/authService";
import { createTestAccount } from "../../services/devTestAccountService";

// DEV-ONLY page (routed only when import.meta.env.DEV). Creates a pre-confirmed
// test account through the edge function, then signs in — no email, no rate
// limit. Hidden entirely from production builds.
export default function CreateTestAccountPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    email: `test+${Date.now()}@example.com`,
    password: "GroundSenseQA123",
    fullName: "Test User",
    companyName: "Test Company",
  });
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!import.meta.env.DEV) {
    return (
      <AuthLayout title="Not available">
        <div className="gs-auth-alert is-error">This tool is disabled in production.</div>
        <Link to="/" className="gs-auth-link">← Home</Link>
      </AuthLayout>
    );
  }

  // The helper requires a local dev secret that matches the edge function's
  // DEV_ADMIN_SECRET. Without it, disable the tool cleanly — normal sign-up is
  // unaffected and lives at /sign-up.
  if (!import.meta.env.VITE_DEV_ADMIN_SECRET) {
    return (
      <AuthLayout title="Create test account" subtitle="Development only.">
        <div className="gs-auth-alert is-error">
          Dev test-account helper disabled. Set <b>VITE_DEV_ADMIN_SECRET</b> in your local
          <code> .env.local</code> (matching the edge function's <b>DEV_ADMIN_SECRET</b>) to enable it.
        </div>
        <Link to="/sign-up" className="gs-auth-link">← Back to sign up</Link>
      </AuthLayout>
    );
  }

  function set(k: keyof typeof form, v: string) {
    setForm((p) => ({ ...p, [k]: v }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setStatus(null);
    setBusy(true);
    try {
      const res = await createTestAccount(form);
      if (!res.ok) {
        setError(res.error ?? "Could not create test account.");
        return;
      }
      setStatus("Test account created. Signing in…");
      await authService.signIn(form.email, form.password);
      navigate("/onboarding", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in after creation failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout title="Create test account" subtitle="Development only — bypasses email confirmation & rate limits.">
      <form onSubmit={onSubmit} noValidate>
        {error && <div className="gs-auth-alert is-error">{error}</div>}
        {status && <div className="gs-auth-alert is-success">{status}</div>}

        <div className="gs-field">
          <label className="gs-label" htmlFor="dev-email">Email</label>
          <input id="dev-email" className="gs-input" value={form.email} onChange={(e) => set("email", e.target.value)} />
        </div>
        <div className="gs-field">
          <label className="gs-label" htmlFor="dev-company">Company name</label>
          <input id="dev-company" className="gs-input" value={form.companyName} onChange={(e) => set("companyName", e.target.value)} />
        </div>
        <div className="gs-field">
          <label className="gs-label" htmlFor="dev-pass">Password</label>
          <input id="dev-pass" className="gs-input" value={form.password} onChange={(e) => set("password", e.target.value)} />
        </div>
        <button className="gs-btn-primary" type="submit" disabled={busy}>
          {busy ? "Creating…" : "Create test account & continue"}
        </button>
      </form>
      <p className="gs-auth-alt">
        <Link to="/sign-up" className="gs-auth-link">← Back to sign up</Link>
      </p>
    </AuthLayout>
  );
}
