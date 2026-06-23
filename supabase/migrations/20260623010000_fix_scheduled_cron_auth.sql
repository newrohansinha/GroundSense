-- Fix: daily scheduled intelligence run never executed.
--
-- ROOT CAUSE
-- The daily cron job (cron.job jobid 2, 'groundsense-daily-intelligence-update',
-- schedule '0 10 * * *') POSTs to the scheduled-intelligence-run edge function.
-- That function is deployed with verify_jwt = true, but the cron command sent
-- only the 'x-scheduler-secret' header and NO 'Authorization' header. The
-- Supabase Edge gateway therefore rejected every daily call with HTTP 401
-- (UNAUTHORIZED_NO_AUTH_HEADER) before the function's own scheduler-secret check
-- could run. Result: zero rows in intelligence_run_summaries with
-- trigger_type = 'scheduled'. (The every-minute worker cron — jobid 3,
-- continue-intelligence-run — kept working because that function is
-- verify_jwt = false.)
--
-- FIX
-- Add the PUBLIC anon (publishable) JWT as the Authorization header so the
-- gateway forwards the request to the function. Defense-in-depth is preserved:
-- verify_jwt stays true AND the function still independently verifies
-- x-scheduler-secret via verify_scheduler_secret(). The anon key is stored in
-- vault.secrets as 'anon_key' (run once, out of band):
--
--   select vault.create_secret('<public anon jwt>', 'anon_key',
--     'Public anon key used only as the Authorization header for cron-invoked edge functions');
--
-- This migration only re-points the existing job's command; it does not create
-- the job (created in an earlier migration) or touch the secret.

select cron.alter_job(
  job_id := 2,
  command := $job$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
             || '/functions/v1/scheduled-intelligence-run',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'anon_key'),
        'x-scheduler-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'intelligence_scheduler_secret')
      ),
      body := jsonb_build_object(
        'trigger_type', 'scheduled',
        'run_mode', 'full',
        'source_scope', 'all'
      ),
      timeout_milliseconds := 280000
    );
  $job$
);
