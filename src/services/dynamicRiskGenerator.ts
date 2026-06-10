import { supabase } from "../lib/supabase";

export async function generateDynamicRisksForCompany(companyId: string) {
  const { data, error } = await supabase.functions.invoke(
    "generate-dynamic-risks",
    {
      body: {
        companyId,
        maxEvidence: 80,
      },
    }
  );

  console.log("Generate dynamic risks data:", data);
  console.log("Generate dynamic risks error:", error);

  if (error) throw error;

  if (!data?.ok) {
    throw new Error(data?.error || "Failed to generate dynamic risks.");
  }

  return data;
}