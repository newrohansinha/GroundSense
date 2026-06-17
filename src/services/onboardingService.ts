// Onboarding session + per-step answer persistence (autosave).

import { supabase } from "../lib/supabase";
import { updateCompany } from "./companyService";

export type OnboardingSession = {
  id: string;
  company_id: string;
  user_id: string;
  current_step: string;
  completed_steps: string[];
  status: "in_progress" | "completed" | string;
  completed_at: string | null;
};

export async function getSession(companyId: string): Promise<OnboardingSession | null> {
  const { data } = await supabase
    .from("onboarding_sessions")
    .select("*")
    .eq("company_id", companyId)
    .maybeSingle();
  return (data as OnboardingSession) ?? null;
}

// Records progress: marks a step complete and advances the cursor. Safe to call
// repeatedly (completed_steps is de-duplicated).
export async function markStep(
  companyId: string,
  completedStep: string,
  nextStep: string
): Promise<void> {
  const session = await getSession(companyId);
  const completed = new Set(session?.completed_steps ?? []);
  completed.add(completedStep);
  await supabase
    .from("onboarding_sessions")
    .update({
      current_step: nextStep,
      completed_steps: Array.from(completed),
    })
    .eq("company_id", companyId);
}

export async function setCurrentStep(companyId: string, step: string): Promise<void> {
  await supabase
    .from("onboarding_sessions")
    .update({ current_step: step })
    .eq("company_id", companyId);
}

// All saved answers for a company, keyed by step_key — the durable source of
// truth that hydrates the wizard on mount / refresh / re-login.
export async function getAllOnboardingAnswers(
  companyId: string
): Promise<Record<string, Record<string, unknown>>> {
  const { data } = await supabase
    .from("onboarding_answers")
    .select("step_key, answers")
    .eq("company_id", companyId);
  const out: Record<string, Record<string, unknown>> = {};
  for (const row of (data ?? []) as { step_key: string; answers: Record<string, unknown> }[]) {
    out[row.step_key] = row.answers ?? {};
  }
  return out;
}

export async function getAnswers(
  companyId: string,
  stepKey: string
): Promise<Record<string, unknown>> {
  const { data } = await supabase
    .from("onboarding_answers")
    .select("answers")
    .eq("company_id", companyId)
    .eq("step_key", stepKey)
    .maybeSingle();
  return (data?.answers as Record<string, unknown>) ?? {};
}

export async function saveAnswers(
  companyId: string,
  stepKey: string,
  answers: Record<string, unknown>
): Promise<void> {
  await supabase
    .from("onboarding_answers")
    .upsert(
      { company_id: companyId, step_key: stepKey, answers },
      { onConflict: "company_id,step_key" }
    );
}

// Finishes onboarding: session → completed, company.onboarding_status → completed.
export async function completeOnboarding(companyId: string): Promise<void> {
  const now = new Date().toISOString();
  await supabase
    .from("onboarding_sessions")
    .update({ status: "completed", current_step: "done", completed_at: now })
    .eq("company_id", companyId);
  await updateCompany(companyId, {
    onboarding_status: "completed",
    onboarding_completed_at: now,
  });
}
