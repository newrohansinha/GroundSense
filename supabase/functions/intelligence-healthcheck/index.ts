// intelligence-healthcheck — fast, dependency-light reachability + readiness
// probe for the intelligence run subsystem.
//
// Use this BEFORE starting a run to distinguish "function not deployed / CORS /
// network" from "function reachable but a secret/DB is missing". It NEVER does
// real work, NEVER returns secret VALUES — only presence booleans.
//
// Public (verify_jwt = false) so the dashboard can probe reachability even
// before/independently of an auth session. It exposes no secret material.

// deno-lint-ignore-file no-explicit-any
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function present(name: string): boolean {
  const v = Deno.env.get(name);
  return typeof v === "string" && v.length > 0;
}

Deno.serve(async (req) => {
  // CORS preflight — must succeed or the browser blocks every call.
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  console.info("[intelligence-healthcheck] invoked", { method: req.method });

  const secrets_present = {
    SUPABASE_URL: present("SUPABASE_URL"),
    SUPABASE_ANON_KEY: present("SUPABASE_ANON_KEY"),
    SUPABASE_SERVICE_ROLE_KEY: present("SUPABASE_SERVICE_ROLE_KEY"),
    CURRENTS_API_KEY: present("CURRENTS_API_KEY"),
    GEMINI_API_KEY: present("GEMINI_API_KEY"),
  };

  // DB reachability + run-schema readiness via the service client.
  let db_reachable = false;
  let db_error: string | null = null;
  let run_schema_ready = false;
  let missing_columns: string[] = [];
  let run_events_table = false;
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (url && key) {
      const db = createClient(url, key, { auth: { persistSession: false } });
      const { error } = await db
        .from("intelligence_run_summaries")
        .select("id", { count: "exact", head: true })
        .limit(1);
      db_reachable = !error;
      db_error = error?.message ?? null;

      // Precise schema check: which required run columns are missing (no secrets).
      const { data: schema, error: schemaErr } = await db.rpc("intelligence_run_schema_status");
      if (schemaErr) {
        // RPC itself missing → the repair migration hasn't been applied either.
        missing_columns = ["intelligence_run_schema_status (run db push)"];
      } else if (schema) {
        run_schema_ready = !!(schema as any).ready;
        missing_columns = ((schema as any).missing ?? []) as string[];
        run_events_table = !!(schema as any).events_table;
      }
    } else {
      db_error = "missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY";
    }
  } catch (e) {
    db_error = e instanceof Error ? e.message : String(e);
  }

  // Project ref is safe to surface (it is part of the public URL).
  const projectRef = (Deno.env.get("SUPABASE_URL") ?? "").match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1] ?? null;

  const ok = secrets_present.SUPABASE_SERVICE_ROLE_KEY && db_reachable && run_schema_ready;

  return json({
    ok,
    function: "intelligence-healthcheck",
    db_reachable,
    db_error,
    run_schema_ready,
    run_events_table,
    missing_columns,
    secrets_present,
    project_ref: projectRef,
    time: new Date().toISOString(),
  });
});
