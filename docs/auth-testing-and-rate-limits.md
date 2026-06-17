# Auth testing & rate limits

GroundSense uses Supabase Auth with **email confirmation enabled**. Repeated
sign-ups during testing can trigger `429 / too many attempts` errors because the
built-in email sender has a low hourly cap.

## Why "too many attempts" happens

- Supabase Auth rate-limits sign-ups and **confirmation-email sends**.
- The default project SMTP allows only a few emails per hour.
- Re-using the same email, or signing up many test accounts quickly, hits the
  **email-send** rate limit (not just the request limit).
- This is server-side. The app already prevents accidental duplicate requests
  (single guarded submit, disabled button, ref guard, no `signUp` in effects),
  so a 429 almost always means a real Supabase limit was reached.

## What the app does about it

- Sends `auth.signUp()` **exactly once per submit** (ref + state guard).
- On `429` / rate-limit: shows a friendly message and a **60-second cooldown**
  on the submit button. It never auto-retries.
- On an existing email (including Supabase's anti-enumeration "obfuscated
  success"): shows **Sign in** / **Reset password** instead of re-trying sign-up.
- Workspace setup (profile/company/membership/onboarding) is **idempotent**
  (`ensureUserWorkspace`) and is retried **without** re-calling `auth.signUp()`.

## Normal sign-up needs no secrets

The standard email/password sign-up at `/sign-up` requires **nothing extra** —
no `VITE_DEV_ADMIN_SECRET`, no dev configuration. `VITE_DEV_ADMIN_SECRET` is
used **only** by the optional development test-account helper below. When it is
absent, the dev helper is simply hidden/disabled; normal sign-up is unaffected.

## Testing multiple accounts safely

1. **Use plus-addressing** so each test is a distinct address that still reaches
   one inbox: `you+1@example.com`, `you+2@example.com`, …
   (You will still hit the *email-send* limit eventually.)
2. **Preferred: the dev test-account helper** (no email sent at all):
   - Visit `/dev/create-test-account` (only routed when `import.meta.env.DEV`).
   - It calls the `dev-create-test-user` edge function, which uses the Admin API
     to create a **pre-confirmed** user, then signs you in straight to onboarding.
   - This avoids the email flow entirely, so it never hits email rate limits.

### Enabling the dev helper (one-time)

The helper is **default-deny** and **optional**. Leaving it unconfigured does
**not** affect normal sign-up — the dev button just stays hidden. To enable it
for local development, set two server-side function secrets and one local
frontend env var (none are committed):

```bash
# Function secrets (server-side; via the Supabase dashboard or CLI)
supabase secrets set APP_ENV=development
supabase secrets set DEV_ADMIN_SECRET=some-local-dev-secret

# Local frontend (.env.local, git-ignored) — must match DEV_ADMIN_SECRET
VITE_DEV_ADMIN_SECRET=some-local-dev-secret
```

The Edge Function validates the request against the **server-side**
`DEV_ADMIN_SECRET` (never a browser value). The browser only sends
`VITE_DEV_ADMIN_SECRET` in dev builds; it is stripped from production bundles.
Never commit either value and never enable this helper in production.

Then deploy the function: `supabase functions deploy dev-create-test-user`.

> Note: `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected into the
> function runtime automatically — do not set them yourself.

### Production safety

- The edge function returns **403** unless `APP_ENV !== "production"` **and** the
  `X-Dev-Admin-Secret` header matches `DEV_ADMIN_SECRET`. With neither set, every
  request is rejected.
- The dev route and the "Create test account" link only exist in dev builds
  (`import.meta.env.DEV`); they are stripped from production bundles.
- The **service-role key is used only inside the edge function** and is never
  exposed to the browser. No tokens or secrets are returned.

## Configuring Supabase rate limits / SMTP

- Adjust limits under **Authentication → Rate Limits** in the Supabase dashboard.
- For real email volume (production), configure **custom SMTP** under
  **Authentication → Emails → SMTP Settings**.
- Never put the service-role key in the browser or in committed files.
