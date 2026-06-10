import { supabase } from "../lib/supabase";

export async function buildExposureGraphForCompany(companyId: string) {
  const { data, error } = await supabase.functions.invoke(
    "build-exposure-graph",
    {
      body: {
        companyId,
      },
    }
  );

  console.log("Build exposure graph data:", data);
  console.log("Build exposure graph error:", error);

  if (error) {
    const context = error.context;
    const text = context ? await context.text() : "No error context";

    console.log("Build exposure graph server response:", text);
    alert(text);
    return;
  }

  if (data?.error) {
    alert(data.error);
    return;
  }

  alert(
    `Exposure graph built. Inserted ${data?.inserted ?? 0} edges. Deleted ${
      data?.deleted_old ?? 0
    } old edges.`
  );
}