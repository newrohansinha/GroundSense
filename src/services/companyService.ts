// Company workspace resolution + the active-company seam.
//
// The whole app already reads the active company from
// localStorage["groundsense_company_id"] (DashboardPage, CalibrationCenterPage,
// SourceHubPage, scheduler, etc.). This service is the single writer of that key
// so auth + demo mode can steer every existing page without touching their
// query code.

import { supabase } from "../lib/supabase";
import type { User } from "@supabase/supabase-js";

export const ACTIVE_COMPANY_KEY = "groundsense_company_id";
export const DEMO_FLAG_KEY = "groundsense_demo";
// Operator/admin mode is an EXPLICIT opt-in. The safe default is buyer/demo, which
// shows no pipeline/admin/scheduler controls. Operators enable it via ?operator=1.
export const OPERATOR_FLAG_KEY = "groundsense_operator";

// The live Fastenal demo workspace (3 risks, 2 actions, 15 supplier + 15 freight
// rows). Loaded by the public "View demo" path.
export const DEMO_COMPANY_ID = "d56259ad-c9f0-42c1-a241-167bdab6a7c6";

export type Company = {
  id: string;
  name: string;
  industry: string | null;
  website: string | null;
  company_size: string | null;
  primary_region: string | null;
  revenue_range: string | null;
  onboarding_status: "not_started" | "in_progress" | "completed" | string;
  onboarding_completed_at: string | null;
  owner_id: string | null;
};

export function getActiveCompanyId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_COMPANY_KEY);
  } catch {
    return null;
  }
}

export function setActiveCompany(companyId: string): void {
  try {
    localStorage.setItem(ACTIVE_COMPANY_KEY, companyId);
    localStorage.removeItem(DEMO_FLAG_KEY);
    // Buyer is the default for a freshly selected company; operator stays explicit.
    localStorage.removeItem(OPERATOR_FLAG_KEY);
  } catch {
    /* ignore */
  }
}

export function clearActiveCompany(): void {
  try {
    localStorage.removeItem(ACTIVE_COMPANY_KEY);
    localStorage.removeItem(DEMO_FLAG_KEY);
  } catch {
    /* ignore */
  }
}

export function isDemoMode(): boolean {
  try {
    return localStorage.getItem(DEMO_FLAG_KEY) === "1";
  } catch {
    return false;
  }
}

// ── Permissions: single source of truth for showing operator/admin controls ──
// Buyer/demo is the safe default (nothing operator-facing). Operator mode is an
// explicit opt-in and is NEVER on while the demo flag is set. Dashboard,
// SchedulerStatusCard, and every admin control read from here — no scattered
// `!isDemoMode()` checks.
export function isOperatorMode(): boolean {
  try {
    if (localStorage.getItem(DEMO_FLAG_KEY) === "1") return false;
    return localStorage.getItem(OPERATOR_FLAG_KEY) === "1";
  } catch {
    return false;
  }
}

export function setOperatorMode(on: boolean): void {
  try {
    if (on) localStorage.setItem(OPERATOR_FLAG_KEY, "1");
    else localStorage.removeItem(OPERATOR_FLAG_KEY);
  } catch {
    /* ignore */
  }
}

// Reads ?operator=1 / ?operator=0 from the URL and persists it. Call once on load.
// In demo mode operator is always forced OFF (and the flag cleared) so a buyer can
// never get stuck in operator view after previously visiting ?operator=1.
export function syncOperatorModeFromUrl(): void {
  try {
    if (localStorage.getItem(DEMO_FLAG_KEY) === "1") { setOperatorMode(false); return; }
    const p = new URLSearchParams(window.location.search);
    const v = p.get("operator");
    if (v === "1") setOperatorMode(true);
    else if (v === "0") setOperatorMode(false);
  } catch {
    /* ignore */
  }
}

// Clears operator mode and reloads the normal buyer view. Used by the
// "Leave operator mode" control so there is always a one-click exit.
export function leaveOperatorMode(): void {
  try {
    setOperatorMode(false);
    const url = new URL(window.location.href);
    url.searchParams.delete("operator");
    window.location.href = url.pathname + url.search;
  } catch {
    /* ignore */
  }
}

// ── Single source of truth for buyer-vs-operator UI ──────────────────────────
// Every operator/admin/pipeline/scheduler/source-audit control reads from these.
export function canViewAdminControls(): boolean {
  return isOperatorMode();
}
export function canOperatePipeline(): boolean {
  return isOperatorMode();
}
export function canViewSourceAudit(): boolean {
  return isOperatorMode();
}

// Buyer/demo-facing company name. Operators see the exact internal workspace name; buyers
// and demo never see the internal "… DEV" suffix (e.g. "Fastenal DEV" → "Fastenal Demo").
export function buyerCompanyName(name: string | null | undefined): string {
  const n = (name ?? "").trim();
  if (!n || canViewAdminControls()) return n;
  const clean = n.replace(/\s*\bDEV\b\s*$/i, "").trim();
  return isDemoMode() && !/demo/i.test(clean) ? `${clean} Demo` : clean;
}

export function enterDemoMode(): void {
  try {
    localStorage.setItem(ACTIVE_COMPANY_KEY, DEMO_COMPANY_ID);
    localStorage.setItem(DEMO_FLAG_KEY, "1");
    // Demo always overrides operator — clear any lingering operator flag.
    localStorage.removeItem(OPERATOR_FLAG_KEY);
  } catch {
    /* ignore */
  }
}

export async function getCompany(companyId: string): Promise<Company | null> {
  const { data } = await supabase
    .from("companies")
    .select("*")
    .eq("id", companyId)
    .maybeSingle();
  return (data as Company) ?? null;
}

export async function updateCompany(
  companyId: string,
  patch: Partial<Company>
): Promise<void> {
  await supabase.from("companies").update(patch).eq("id", companyId);
}

// In-flight guard so React StrictMode's double-invoke (and rapid re-mounts)
// can't create two companies for the same user.
const inFlight = new Map<string, Promise<{ company: Company }>>();

// Idempotently guarantees the signed-in user has: a company, a membership, and
// an onboarding session. Creates them from the user's sign-up metadata on first
// authenticated load (works whether or not email confirmation is enabled).
export async function ensureWorkspace(user: User): Promise<{ company: Company }> {
  const existing = inFlight.get(user.id);
  if (existing) return existing;

  const run = (async () => {
    // 1. Existing membership → existing company.
    const { data: memberships } = await supabase
      .from("company_memberships")
      .select("company_id")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true })
      .limit(1);

    let company: Company | null = null;
    const companyId = memberships?.[0]?.company_id as string | undefined;
    if (companyId) company = await getCompany(companyId);

    // 2. No company yet → create one from sign-up metadata.
    if (!company) {
      const meta = (user.user_metadata ?? {}) as Record<string, string | null>;
      const name = (meta.company_name || "").trim() || "My Company";
      const { data: created, error } = await supabase
        .from("companies")
        .insert({
          name,
          owner_id: user.id,
          industry: meta.industry || null,
          website: meta.company_website || null,
          onboarding_status: "in_progress",
        })
        .select("*")
        .single();
      if (error) throw error;
      company = created as Company;

      await supabase
        .from("company_memberships")
        .upsert(
          { company_id: company.id, user_id: user.id, role: "owner" },
          { onConflict: "company_id,user_id" }
        );
    }

    // 3. Ensure an onboarding session exists.
    const { data: session } = await supabase
      .from("onboarding_sessions")
      .select("id")
      .eq("company_id", company.id)
      .maybeSingle();
    if (!session) {
      await supabase
        .from("onboarding_sessions")
        .upsert(
          {
            company_id: company.id,
            user_id: user.id,
            current_step: "welcome",
            status: "in_progress",
          },
          { onConflict: "company_id" }
        );
    }

    // 4. Ensure a company-scoped scheduler config exists — DISABLED by default
    //    so a new company never inherits another tenant's schedule and never
    //    auto-runs expensive generation until the user enables it.
    const { data: sched } = await supabase
      .from("intelligence_scheduler_config")
      .select("id")
      .eq("company_id", company.id)
      .maybeSingle();
    if (!sched) {
      await supabase.from("intelligence_scheduler_config").insert({
        company_id: company.id,
        enabled: false,
        schedule_name: "Daily intelligence update",
        cadence: "daily",
        cron_expression: "0 10 * * *",
        timezone: "UTC",
      });
    }

    return { company };
  })();

  inFlight.set(user.id, run);
  try {
    return await run;
  } finally {
    inFlight.delete(user.id);
  }
}

// Alias: recovery entry point used when workspace setup needs to be retried
// (e.g. profile/company/membership/onboarding creation failed after a
// successful auth sign-up). Idempotent — never calls auth.signUp; safe to run
// repeatedly. Retrying workspace setup must NOT re-trigger Supabase Auth.
export const ensureUserWorkspace = ensureWorkspace;
