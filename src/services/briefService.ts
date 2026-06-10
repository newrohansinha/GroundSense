import { supabase } from "../lib/supabase";

export async function generateBriefForCompany(companyId: string) {
  const { data, error } = await supabase.functions.invoke("generate-brief", {
    body: {
      companyId,
    },
  });

  console.log("Generate brief data:", data);
  console.log("Generate brief error:", error);

  if (error) {
    const context = error.context;
    const text = context ? await context.text() : "No error context";

    console.log("Generate brief server response:", text);
    alert(text);
    return;
  }

  if (data?.error) {
    console.log("Generate brief returned error:", data.error);
    alert(data.error);
    return;
  }

  if (!data?.generated) {
    alert(data?.message || "No brief generated");
    return;
  }

  console.log("Inserted brief:", data.brief);
  alert(`Brief generated successfully. Version: ${data.version || "unknown"}`);
}