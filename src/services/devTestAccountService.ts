// DEV-ONLY helper to create confirmed test accounts via the
// `dev-create-test-user` edge function (bypasses email rate limits). The secret
// is read from VITE_DEV_ADMIN_SECRET, which lives only in a local .env and is
// never shipped — this module must only be imported behind import.meta.env.DEV.

import { supabase } from "../lib/supabase";

export async function createTestAccount(input: {
  email: string;
  password: string;
  fullName?: string;
  companyName?: string;
}): Promise<{ ok: boolean; userId?: string; error?: string }> {
  const secret = import.meta.env.VITE_DEV_ADMIN_SECRET as string | undefined;
  if (!secret) {
    return { ok: false, error: "VITE_DEV_ADMIN_SECRET is not set in your local .env." };
  }

  const { data, error } = await supabase.functions.invoke("dev-create-test-user", {
    body: {
      email: input.email.trim(),
      password: input.password,
      full_name: input.fullName,
      company_name: input.companyName,
    },
    headers: { "x-dev-admin-secret": secret },
  });

  if (error) return { ok: false, error: error.message };
  if (data?.error) return { ok: false, error: data.error };
  return { ok: true, userId: data?.user_id };
}
