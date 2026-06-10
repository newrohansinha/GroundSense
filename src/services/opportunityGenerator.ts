import { supabase } from "../lib/supabase";

export async function generateOpportunitiesForCompany(companyId: string) {
  const { data, error } = await supabase.functions.invoke(
    "generate-opportunities",
    {
      body: {
        companyId,
      },
    }
  );

  console.log("Generate opportunities data:", data);
  console.log("Generate opportunities error:", error);

  if (error) {
    const context = error.context;
    const text = context ? await context.text() : "No error context";
    alert(text);
    return;
  }

  if (data?.error) {
    alert(data.error);
    return;
  }

  alert(
    `Generated ${data?.inserted ?? 0} opportunities. Deleted ${
      data?.deleted_old ?? 0
    } old opportunities.`
  );
}