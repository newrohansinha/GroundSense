import { supabase } from "../lib/supabase";

export async function buildConnectionsForCompany(companyId: string) {
  const { data, error } = await supabase.functions.invoke(
    "build-company-connections",
    {
      body: {
        companyId,
      },
    }
  );

  console.log("Build company connections data:", data);
  console.log("Build company connections error:", error);

  if (error) {
    console.log("Build company connections full error:", error);
    alert(error.message || "Connection build failed");
    return;
  }

  if (data?.error) {
    alert(data.error);
    return;
  }

  if (data?.connectionInsertError || data?.pathInsertError) {
    alert(
      `Connection insert error: ${
        data?.connectionInsertError || "none"
      }\nPath insert error: ${data?.pathInsertError || "none"}`
    );
    return;
  }

  alert(
    `Connections built.

Connections: ${data?.inserted_connections ?? 0}
Impact paths: ${data?.inserted_paths ?? 0}`
  );
}