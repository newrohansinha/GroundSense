import { supabase } from "../lib/supabase";

export async function fetchEventsForCompany(companyId: string) {
  const { data, error } = await supabase.functions.invoke("fetch-events", {
    body: {
      companyId,
    },
  });

  console.log("Edge function data:", data);
  console.log("Edge function error:", error);

  if (error) {
    alert(error.message);
    return;
  }

  if (data?.error) {
    alert(data.error);
    return;
  }

  alert(
    `Fetch complete.
Queries checked: ${data?.queries_checked ?? 0}
Articles checked: ${data?.articles_checked ?? 0}
Inserted: ${data?.inserted ?? 0}
Skipped duplicates/errors: ${data?.skipped ?? 0}
Rejected low-quality: ${data?.rejected ?? 0}`
  );
}