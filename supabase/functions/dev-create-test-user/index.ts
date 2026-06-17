// dev-create-test-user — DEVELOPMENT-ONLY helper for creating confirmed test
// accounts WITHOUT going through the normal email-sending sign-up flow (which
// hits Supabase Auth email rate limits during repeated testing).
//
// Security model (default-deny):
//   * APP_ENV must be explicitly NOT "production". It defaults to "production"
//     when unset, so an un-configured deployment is locked.
//   * A server-side secret header `X-Dev-Admin-Secret` must equal the
//     DEV_ADMIN_SECRET function secret. If the secret is unset, every request
//     is rejected with 403.
//   * The service-role key is used ONLY inside this function (never returned,
//     never sent to the browser).
//   * No tokens, passwords, or secrets are returned.
//
// Required function secrets (set via the Supabase dashboard / CLI — NOT checked
// into the repo): DEV_ADMIN_SECRET, APP_ENV=development.
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected by the runtime.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-dev-admin-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  // ── Gate: never available in production, always requires the dev secret ──
  const appEnv = Deno.env.get("APP_ENV") ?? "production";
  if (appEnv === "production") {
    return json({ error: "Disabled in production." }, 403);
  }
  const devSecret = Deno.env.get("DEV_ADMIN_SECRET");
  const provided = req.headers.get("x-dev-admin-secret");
  if (!devSecret || provided !== devSecret) {
    return json({ error: "Forbidden." }, 403);
  }

  let payload: {
    email?: string;
    password?: string;
    full_name?: string;
    company_name?: string;
  };
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

  const email = (payload.email ?? "").trim();
  const password = payload.password ?? "";
  const companyName = (payload.company_name ?? "").trim() || "Test Company";
  const fullName = (payload.full_name ?? "").trim() || null;
  if (!email || password.length < 8) {
    return json({ error: "email and password (min 8 chars) are required." }, 400);
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  // 1. Create a pre-confirmed auth user (no confirmation email sent).
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName, company_name: companyName },
  });
  if (createErr || !created.user) {
    return json({ error: createErr?.message ?? "Could not create user." }, 400);
  }
  const userId = created.user.id;

  // 2. Idempotently ensure workspace rows (profile is created by the
  //    handle_new_user trigger; create company + membership + onboarding here).
  const { data: company, error: companyErr } = await admin
    .from("companies")
    .insert({ name: companyName, owner_id: userId, onboarding_status: "in_progress" })
    .select("id")
    .single();
  if (companyErr || !company) {
    return json({ error: companyErr?.message ?? "Could not create company." }, 400);
  }
  await admin
    .from("company_memberships")
    .upsert({ company_id: company.id, user_id: userId, role: "owner" }, { onConflict: "company_id,user_id" });
  await admin
    .from("onboarding_sessions")
    .upsert({ company_id: company.id, user_id: userId, current_step: "welcome", status: "in_progress" }, { onConflict: "company_id" });

  // No tokens/secrets in the response.
  return json({ ok: true, user_id: userId, company_id: company.id });
});
