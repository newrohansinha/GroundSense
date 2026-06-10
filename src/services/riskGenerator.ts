import { supabase } from "../lib/supabase";

export async function generateRisksForCompany(companyId: string) {
  const { data, error } = await supabase.functions.invoke("generate-risks", {
    body: {
      companyId,
    },
  });

  console.log("Generate risks data:", data);
  console.log("Generate risks error:", error);

  if (error) {
    const context = error.context;
    const text = context ? await context.text() : "No error context";

    console.log("Generate risks server response:", text);
    alert(text);
    return;
  }

  if (data?.error) {
    alert(data.error);
    return;
  }

  alert(
    `Generated ${data?.inserted ?? 0} risks. Deleted ${
      data?.deleted_old ?? 0
    } old risks.`
  );
}