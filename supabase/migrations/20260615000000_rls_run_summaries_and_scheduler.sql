-- Multi-tenant RLS for the two tables that were leaking across companies:
-- intelligence_run_summaries (run history) and intelligence_scheduler_config.
-- Edge Functions use the service role and bypass RLS (scheduled runs unaffected).
-- Authenticated members get their own company's rows; the public demo (anon)
-- gets read-only access to the demo company's rows.
--
-- Applied to the remote project on 2026-06-15 via the Supabase MCP.

-- Demo flag (idempotent; mirrors the deferred full-RLS migration).
alter table public.companies add column if not exists is_demo boolean not null default false;
update public.companies set is_demo = true
  where id = 'd56259ad-c9f0-42c1-a241-167bdab6a7c6' and is_demo = false;

-- ── intelligence_run_summaries ────────────────────────────────────────────────
alter table public.intelligence_run_summaries enable row level security;

drop policy if exists irs_member_all on public.intelligence_run_summaries;
create policy irs_member_all on public.intelligence_run_summaries for all to authenticated
  using (company_id in (select public.current_user_company_ids()))
  with check (company_id in (select public.current_user_company_ids()));

drop policy if exists irs_demo_read on public.intelligence_run_summaries;
create policy irs_demo_read on public.intelligence_run_summaries for select
  using (company_id in (select id from public.companies where is_demo));

-- ── intelligence_scheduler_config ─────────────────────────────────────────────
alter table public.intelligence_scheduler_config enable row level security;

drop policy if exists isc_member_all on public.intelligence_scheduler_config;
create policy isc_member_all on public.intelligence_scheduler_config for all to authenticated
  using (company_id in (select public.current_user_company_ids()))
  with check (company_id in (select public.current_user_company_ids()));

drop policy if exists isc_demo_read on public.intelligence_scheduler_config;
create policy isc_demo_read on public.intelligence_scheduler_config for select
  using (company_id in (select id from public.companies where is_demo));
