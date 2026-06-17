import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import AuthLayout from "../../components/auth/AuthLayout";
import * as authService from "../../services/authService";
import { AuthFlowError } from "../../services/authService";

type Errors = Partial<Record<"email" | "password" | "confirm" | "companyName", string>>;

const RATE_LIMIT_COOLDOWN_SECONDS = 60;

export default function SignUpPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    email: "",
    password: "",
    confirm: "",
    companyName: "",
    fullName: "",
    roleTitle: "",
  });
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [confirmSent, setConfirmSent] = useState(false);
  const [existingEmail, setExistingEmail] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  // Ref guard blocks duplicate calls fired in the same frame (double-click /
  // Enter+click), before the isSubmitting state has a chance to re-render.
  const isSubmittingRef = useRef(false);

  // Cooldown ticker after a 429. Pure timer — never re-calls signUp.
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown((c) => (c <= 1 ? 0 : c - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  function set(key: keyof typeof form, value: string) {
    setForm((p) => ({ ...p, [key]: value }));
  }

  function validate(): boolean {
    const next: Errors = {};
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim()))
      next.email = "Enter a valid email address.";
    if (form.password.length < 8) next.password = "Use at least 8 characters.";
    if (form.confirm !== form.password) next.confirm = "Passwords do not match.";
    if (!form.companyName.trim()) next.companyName = "Company name is required.";
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Single guarded entry point. Ignore re-entry while a request is in flight
    // or while we're in a rate-limit cooldown.
    if (isSubmittingRef.current || cooldown > 0) return;
    setFormError(null);
    setExistingEmail(false);
    if (!validate()) return;

    isSubmittingRef.current = true;
    setIsSubmitting(true);
    try {
      const result = await authService.signUp({
        email: form.email,
        password: form.password,
        companyName: form.companyName,
        fullName: form.fullName,
        roleTitle: form.roleTitle,
      });
      if (result.needsEmailConfirmation) {
        setConfirmSent(true);
        return;
      }
      // Session active → CompanyProvider creates the workspace from metadata.
      navigate("/onboarding", { replace: true });
    } catch (err) {
      if (err instanceof AuthFlowError) {
        // Safe diagnostic logging only — no email body, password, or tokens.
        console.warn(`[signup] auth error kind=${err.kind} status=${err.status ?? "n/a"}`);
        if (err.kind === "existing_email") {
          setExistingEmail(true);
        } else if (err.kind === "rate_limit") {
          setCooldown(RATE_LIMIT_COOLDOWN_SECONDS);
          setFormError(err.message);
        } else if (err.kind === "weak_password") {
          setErrors((p) => ({ ...p, password: err.message }));
        } else if (err.kind === "invalid_email") {
          setErrors((p) => ({ ...p, email: err.message }));
        } else {
          setFormError(err.message);
        }
      } else {
        setFormError("Something went wrong. Please try again.");
      }
    } finally {
      // Always release the guard — we never auto-retry; the user re-submits.
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  }

  if (confirmSent) {
    return (
      <AuthLayout title="Check your email" subtitle="One more step to finish setup.">
        <div className="gs-auth-alert is-success">
          We sent a confirmation link to <b>{form.email}</b>. Confirm your email,
          then sign in to start setting up <b>{form.companyName}</b>.
        </div>
        <Link to="/sign-in" className="gs-btn-ghost" style={{ display: "block", textAlign: "center", lineHeight: "42px", textDecoration: "none" }}>
          Back to sign in
        </Link>
      </AuthLayout>
    );
  }

  const submitLabel = isSubmitting
    ? "Creating account…"
    : cooldown > 0
      ? `Try again in ${cooldown}s`
      : "Create account";

  return (
    <AuthLayout title="Create your workspace" subtitle="Set up GroundSense for your company.">
      <form onSubmit={onSubmit} noValidate>
        {existingEmail && (
          <div className="gs-auth-alert is-error">
            An account may already exist for this email.
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <Link to="/sign-in" className="gs-btn-ghost" style={{ flex: 1, lineHeight: "36px", height: 36, textAlign: "center", textDecoration: "none" }}>
                Sign in
              </Link>
              <Link to="/forgot-password" className="gs-btn-ghost" style={{ flex: 1, lineHeight: "36px", height: 36, textAlign: "center", textDecoration: "none" }}>
                Reset password
              </Link>
            </div>
          </div>
        )}
        {formError && <div className="gs-auth-alert is-error">{formError}</div>}

        <div className="gs-field">
          <label className="gs-label" htmlFor="su-email">Work email</label>
          <input
            id="su-email"
            type="email"
            className={`gs-input ${errors.email ? "is-error" : ""}`}
            value={form.email}
            autoComplete="email"
            onChange={(e) => set("email", e.target.value)}
          />
          {errors.email && <p className="gs-field-error">{errors.email}</p>}
        </div>

        <div className="gs-field">
          <label className="gs-label" htmlFor="su-company">Company name</label>
          <input
            id="su-company"
            type="text"
            className={`gs-input ${errors.companyName ? "is-error" : ""}`}
            value={form.companyName}
            onChange={(e) => set("companyName", e.target.value)}
          />
          {errors.companyName && <p className="gs-field-error">{errors.companyName}</p>}
        </div>

        <div className="gs-field-row">
          <div className="gs-field">
            <label className="gs-label" htmlFor="su-name">
              Full name <span className="gs-label-opt">(optional)</span>
            </label>
            <input
              id="su-name"
              type="text"
              className="gs-input"
              value={form.fullName}
              autoComplete="name"
              onChange={(e) => set("fullName", e.target.value)}
            />
          </div>
          <div className="gs-field">
            <label className="gs-label" htmlFor="su-role">
              Role <span className="gs-label-opt">(optional)</span>
            </label>
            <input
              id="su-role"
              type="text"
              className="gs-input"
              value={form.roleTitle}
              onChange={(e) => set("roleTitle", e.target.value)}
            />
          </div>
        </div>

        <div className="gs-field-row">
          <div className="gs-field">
            <label className="gs-label" htmlFor="su-pass">Password</label>
            <input
              id="su-pass"
              type="password"
              className={`gs-input ${errors.password ? "is-error" : ""}`}
              value={form.password}
              autoComplete="new-password"
              onChange={(e) => set("password", e.target.value)}
            />
            {errors.password && <p className="gs-field-error">{errors.password}</p>}
          </div>
          <div className="gs-field">
            <label className="gs-label" htmlFor="su-confirm">Confirm</label>
            <input
              id="su-confirm"
              type="password"
              className={`gs-input ${errors.confirm ? "is-error" : ""}`}
              value={form.confirm}
              autoComplete="new-password"
              onChange={(e) => set("confirm", e.target.value)}
            />
            {errors.confirm && <p className="gs-field-error">{errors.confirm}</p>}
          </div>
        </div>

        <button className="gs-btn-primary" type="submit" disabled={isSubmitting || cooldown > 0}>
          {submitLabel}
        </button>
      </form>

      <p className="gs-auth-alt">
        Already have an account?{" "}
        <Link to="/sign-in" className="gs-auth-link">Sign in</Link>
      </p>

      {/* Dev-only test-account helper. Normal sign-up above never needs this.
          Show the link only when the local dev secret is configured; otherwise
          show a quiet dev-only hint. Nothing here renders in production. */}
      {import.meta.env.DEV && (
        import.meta.env.VITE_DEV_ADMIN_SECRET ? (
          <p className="gs-auth-alt" style={{ marginTop: 10 }}>
            <Link to="/dev/create-test-account" className="gs-auth-link">Dev: create test account</Link>
          </p>
        ) : (
          <p className="gs-field-hint" style={{ marginTop: 10, textAlign: "center" }}>
            Dev test-account helper disabled. Set VITE_DEV_ADMIN_SECRET locally to enable.
          </p>
        )
      )}
    </AuthLayout>
  );
}
