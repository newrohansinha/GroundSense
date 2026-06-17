// Thin wrapper over Supabase Auth. All auth I/O goes through here so the UI
// never touches supabase.auth directly and error handling stays consistent.

import { supabase } from "../lib/supabase";
import type { Session, User } from "@supabase/supabase-js";

export type SignUpInput = {
  email: string;
  password: string;
  companyName: string;
  fullName?: string;
  roleTitle?: string;
  companyWebsite?: string;
  industry?: string;
};

export type AuthResult = {
  user: User | null;
  session: Session | null;
  // True when Supabase requires an email confirmation before a session exists.
  needsEmailConfirmation: boolean;
};

// Classified auth failures so the UI can branch (rate limit, existing email,
// etc.) instead of dumping raw Supabase text.
export type AuthErrorKind =
  | "rate_limit"
  | "existing_email"
  | "weak_password"
  | "invalid_email"
  | "invalid_credentials"
  | "generic";

export class AuthFlowError extends Error {
  kind: AuthErrorKind;
  status?: number;
  constructor(kind: AuthErrorKind, message: string, status?: number) {
    super(message);
    this.name = "AuthFlowError";
    this.kind = kind;
    this.status = status;
  }
}

type SupabaseLikeError = { message: string; status?: number; code?: string };

function classifyAuthError(error: SupabaseLikeError): AuthFlowError {
  const m = (error.message ?? "").toLowerCase();
  const code = (error.code ?? "").toLowerCase();
  const status = error.status;

  // Rate limit — 429 or any of Supabase's rate-limit message variants.
  if (
    status === 429 ||
    code.includes("rate_limit") ||
    code === "over_email_send_rate_limit" ||
    code === "over_request_rate_limit" ||
    m.includes("rate limit") ||
    m.includes("too many") ||
    m.includes("email rate limit exceeded") ||
    m.includes("request rate limit reached")
  ) {
    return new AuthFlowError(
      "rate_limit",
      "Too many sign-up attempts were made in a short time. Wait a few minutes before trying again, or use the test-account tool in development.",
      status
    );
  }

  if (
    code === "user_already_exists" ||
    code === "email_exists" ||
    m.includes("already registered") ||
    m.includes("already been registered") ||
    m.includes("user already exists")
  ) {
    return new AuthFlowError(
      "existing_email",
      "An account may already exist for this email. Try signing in instead.",
      status
    );
  }

  if (code === "weak_password" || m.includes("password should be") || m.includes("password is too")) {
    return new AuthFlowError("weak_password", "Password is too weak. Use at least 8 characters.", status);
  }

  if (code === "validation_failed" || m.includes("invalid email") || m.includes("unable to validate email")) {
    return new AuthFlowError("invalid_email", "Enter a valid email address.", status);
  }

  if (m.includes("invalid login") || code === "invalid_credentials") {
    return new AuthFlowError("invalid_credentials", "Email or password is incorrect.", status);
  }

  return new AuthFlowError("generic", error.message || "Something went wrong. Please try again.", status);
}

export async function signUp(input: SignUpInput): Promise<AuthResult> {
  const { data, error } = await supabase.auth.signUp({
    email: input.email.trim(),
    password: input.password,
    options: {
      // Carried into raw_user_meta_data so the workspace can be created from it
      // even if the user confirms their email on a different device/session.
      data: {
        full_name: input.fullName?.trim() || null,
        role_title: input.roleTitle?.trim() || null,
        company_name: input.companyName.trim(),
        company_website: input.companyWebsite?.trim() || null,
        industry: input.industry?.trim() || null,
      },
      emailRedirectTo: `${window.location.origin}/sign-in`,
    },
  });
  if (error) throw classifyAuthError(error as SupabaseLikeError);

  // With email confirmation enabled, Supabase obfuscates "email already exists"
  // as a fake success with an empty identities array (anti-enumeration). Treat
  // that as existing-email so we don't keep re-prompting a fresh sign-up.
  if (data.user && (data.user.identities?.length ?? 0) === 0) {
    throw new AuthFlowError(
      "existing_email",
      "An account may already exist for this email. Try signing in, or reset your password."
    );
  }

  return {
    user: data.user,
    session: data.session,
    needsEmailConfirmation: !!data.user && !data.session,
  };
}

export async function signIn(email: string, password: string): Promise<AuthResult> {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim(),
    password,
  });
  if (error) throw classifyAuthError(error as SupabaseLikeError);
  return { user: data.user, session: data.session, needsEmailConfirmation: false };
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}

export async function requestPasswordReset(email: string): Promise<void> {
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
    redirectTo: `${window.location.origin}/reset-password`,
  });
  if (error) throw classifyAuthError(error as SupabaseLikeError);
}

export async function updatePassword(newPassword: string): Promise<void> {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw classifyAuthError(error as SupabaseLikeError);
}

export async function getSession(): Promise<Session | null> {
  const { data } = await supabase.auth.getSession();
  return data.session ?? null;
}
