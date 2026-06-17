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

export function enterDemoMode(): void {
  try {
    localStorage.setItem(ACTIVE_COMPANY_KEY, DEMO_COMPANY_ID);
    localStorage.setItem(DEMO_FLAG_KEY, "1");
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
