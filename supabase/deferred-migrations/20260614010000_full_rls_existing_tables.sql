-- =============================================================================
-- DEFERRED — DO NOT APPLY WITHOUT REVIEW + VERIFICATION
-- =============================================================================
-- GroundSense full Row-Level Security for the existing data tables.
--
-- Why this is deferred (see sprint decision, 2026-06-14):
--   * Today the browser talks to these tables with the ANON key (RLS off).
--   * Edge functions use the SERVICE ROLE key, so they bypass RLS and are
--     unaffected by this file.
--   * The public "View demo" path is UNAUTHENTICATED (anon) and must keep
--     read access to the Fastenal demo company.
--   * Enabling RLS without the right policies will instantly break the live
--     demo and the authenticated app. Apply only after Playwright-verifying
--     each surface against a staging copy.
--
-- This file is intentionally placed OUTSIDE supabase/migrations/ so that
-- `supabase db push` does NOT pick it up automatically. To apply, copy it into
-- supabase/migrations/ (or run it manually) once verified.
--
-- Strategy:
--   * Mark the demo company with companies.is_demo = true.
--   * For every public table that has a `company_id` column:
--       - authenticated members: full access where company_id is one of the
--         caller's companies (via current_user_company_ids()).
--       - anon + authenticated: SELECT-only on rows belonging to a demo company.
--   * The `companies` table itself: members read their companies; anyone reads
--     demo companies; admins update; authenticated users may insert (sign-up).
--   * Global / non-company tables (external_sources, external_metrics, etc.)
--     are listed at the bottom for a manual decision — most are public reference
--     data and can be left readable.
-- =============================================================================

-- 0. Flag the demo company (id resolved by hand to avoid coupling to created_at).
alter table public.companies add column if not exists is_demo boolean not null default false;
update public.companies set is_demo = true
  where id = 'd56259ad-c9f0-42c1-a241-167bdab6a7c6';  -- Fastenal demo workspace

-- 1. companies table policies.
alter table public.companies enable row level security;
drop policy if exists companies_select_member_or_demo on public.companies;
create policy companies_select_member_or_demo on public.companies for select
  using (is_demo = true or public.is_company_member(id) or owner_id = auth.uid());
drop policy if exists companies_insert_authenticated on public.companies;
create policy companies_insert_authenticated on public.companies for insert
  to authenticated with check (owner_id = auth.uid());
drop policy if exists companies_update_admin on public.companies;
create policy companies_update_admin on public.companies for update
  using (public.is_company_admin(id) or owner_id = auth.uid())
  with check (public.is_company_admin(id) or owner_id = auth.uid());

-- 2. Apply a standard policy set to every company-scoped data table.
do $$
declare
  t record;
begin
  for t in
    select c.table_name
    from information_schema.columns c
    join information_schema.tables tbl
      on tbl.table_schema = c.table_schema and tbl.table_name = c.table_name
    where c.table_schema = 'public'
      and c.column_name = 'company_id'
      and tbl.table_type = 'BASE TABLE'
      and c.table_name <> 'companies'
  loop
    execute format('alter table public.%I enable row level security;', t.table_name);

    -- authenticated members: full CRUD on their own company's rows
    execute format('drop policy if exists %I on public.%I;',
                   t.table_name || '_member_all', t.table_name);
    execute format(
      'create policy %I on public.%I for all to authenticated '
      || 'using (company_id in (select public.current_user_company_ids())) '
      || 'with check (company_id in (select public.current_user_company_ids()));',
      t.table_name || '_member_all', t.table_name);

    -- anon + authenticated: read-only on demo company rows
    execute format('drop policy if exists %I on public.%I;',
                   t.table_name || '_demo_read', t.table_name);
    execute format(
      'create policy %I on public.%I for select '
      || 'using (company_id in (select id from public.companies where is_demo));',
      t.table_name || '_demo_read', t.table_name);
  end loop;
end $$;

-- 3. Global / reference tables WITHOUT company_id — review individually.
--    Most are public reference data (external sources/metrics, verified shocks).
--    Suggested: enable RLS with a permissive SELECT for all, writes service-role
--    only. Listed here for an explicit decision rather than a blanket default:
--      external_sources, external_metrics, external_metric_observations,
--      article_metric_claims, verified_shocks, source_fusion_runs,
--      manual_external_metric_imports, intelligence_run_locks,
--      intelligence_run_summaries, intelligence_change_events, briefs,
--      intelligence_briefs, news_tracking_queries
--
-- Example (uncomment per table after deciding):
--   alter table public.external_sources enable row level security;
--   create policy external_sources_read_all on public.external_sources
--     for select using (true);
-- =============================================================================
