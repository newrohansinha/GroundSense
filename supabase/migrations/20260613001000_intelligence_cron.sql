-- ============================================================================
-- Automatic Intelligence Updates — Supabase Cron (Vault-RPC design).
--
-- Matches the LIVE deployed setup. Schedules a daily call to the
-- `scheduled-intelligence-run` Edge Function via pg_cron + pg_net. The scheduler
-- secret is generated SERVER-SIDE into Vault (never hardcoded), and the Edge
-- Function authorizes each call by verifying the provided `x-scheduler-secret`
-- against that Vault secret through the SECURITY DEFINER RPC public.verify_scheduler_secret().
-- No function env secret and no `supabase secrets set` are required; no secret
-- value ever appears in SQL, logs, or migration history.
--
-- Edge Function deploy (custom secret auth ⇒ no JWT gate):
--   supabase functions deploy scheduled-intelligence-run --no-verify-jwt
--
-- This migration is GUARDED + IDEMPOTENT: if pg_cron / pg_net / vault are not
-- available in the environment it skips gracefully so the migration never fails.
--
-- NOTE FOR OTHER ENVIRONMENTS: the cron job needs this project's functions base
-- URL. Replace the project ref in the 'project_url' secret below with your own.
-- ============================================================================

-- 1) Scheduler secret + project URL in Vault (secret VALUE generated server-side).
do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'vault') then
    raise notice 'vault not available — skipping scheduler secret/cron setup.';
    return;
  end if;

  if not exists (select 1 from vault.secrets where name = 'intelligence_scheduler_secret') then
    perform vault.create_secret(encode(gen_random_bytes(32), 'hex'), 'intelligence_scheduler_secret');
  end if;

  if not exists (select 1 from vault.secrets where name = 'project_url') then
    -- CHANGE this for other environments to your own https://<PROJECT_REF>.supabase.co
    perform vault.create_secret('https://kfzdvqhrkfquakqaqfbf.supabase.co', 'project_url');
  end if;
end $$;

-- 2) Verifier RPC. Compares a provided secret to the Vault secret and returns ONLY
--    a boolean — the secret never leaves the database. Callable by service_role only
--    (the Edge Function); revoked from anon/authenticated/public.
create or replace function public.verify_scheduler_secret(p_secret text)
returns boolean
language plpgsql
security definer
set search_path = public, vault
as $$
declare v text;
begin
  select decrypted_secret into v from vault.decrypted_secrets where name = 'intelligence_scheduler_secret' limit 1;
  return v is not null and p_secret is not null and p_secret = v;
end;
$$;

revoke all on function public.verify_scheduler_secret(text) from public;
revoke all on function public.verify_scheduler_secret(text) from anon;
revoke all on function public.verify_scheduler_secret(text) from authenticated;
grant execute on function public.verify_scheduler_secret(text) to service_role;

-- 3) Schedule the daily cron job (reads secret + URL from Vault at fire time).
do $$
begin
  begin
    create extension if not exists pg_cron;
    create extension if not exists pg_net;
  exception when others then
    raise notice 'pg_cron/pg_net not available — skipping cron job creation. %', sqlerrm;
    return;
  end;

  if not exists (select 1 from vault.decrypted_secrets where name = 'project_url')
     or not exists (select 1 from vault.decrypted_secrets where name = 'intelligence_scheduler_secret') then
    raise notice 'Vault secrets not present — skipping cron job creation.';
    return;
  end if;

  -- Idempotent: drop a prior job with the same name before (re)scheduling.
  begin
    perform cron.unschedule('groundsense-daily-intelligence-update');
  exception when others then
    null; -- job did not exist
  end;

  -- Daily at 10:00 UTC. Change to '0 */6 * * *' for every 6 hours.
  perform cron.schedule(
    'groundsense-daily-intelligence-update',
    '0 10 * * *',
    $cron$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
             || '/functions/v1/scheduled-intelligence-run',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-scheduler-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'intelligence_scheduler_secret')
      ),
      body := jsonb_build_object(
        'trigger_type', 'scheduled',
        'run_mode', 'full',
        'source_scope', 'all'
      ),
      timeout_milliseconds := 280000
    );
    $cron$
  );

  raise notice 'Scheduled groundsense-daily-intelligence-update (daily 10:00 UTC).';
end;
$$;
