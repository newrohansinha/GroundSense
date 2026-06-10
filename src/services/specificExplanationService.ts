import { supabase } from "../lib/supabase";

export async function generateSpecificExplanationsForCompany(companyId: string) {
  const { data, error } = await supabase.functions.invoke(
    "generate-specific-explanations",
    {
      body: {
        companyId,
      },
    }
  );

  console.log("Generate specific explanations data:", data);
  console.log("Generate specific explanations error:", error);

  if (error) throw error;
  if (!data?.ok) {
    throw new Error(data?.error || "Failed to generate specific explanations.");
  }

  return data;
}