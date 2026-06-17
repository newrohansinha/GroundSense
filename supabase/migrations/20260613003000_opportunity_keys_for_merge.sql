-- ============================================================================
-- Stable opportunity keys for non-destructive opportunity merge.
-- ADDITIVE ONLY. Lets generate-opportunities UPSERT by (company_id, opportunity_key)
-- instead of delete-all-then-insert, so blocked/pending candidates are preserved
-- across runs. Nothing is deleted.
-- ============================================================================

alter table public.opportunity_register add column if not exists opportunity_key text;
alter table public.opportunity_register add column if not exists last_seen_run_id uuid;
alter table public.opportunity_register add column if not exists last_seen_at timestamptz;
alter table public.opportunity_register add column if not exists archived_at timestamptz;
alter table public.opportunity_register add column if not exists archived_reason text;

-- Backfill from title keywords (must match clusterForOpportunity() namespacing in the function).
update public.opportunity_register set opportunity_key = case
  when lower(coalesce(title,'')) ~ 'construction' then 'construction_demand_opportunity_candidate'
  when lower(coalesce(title,'')) ~ 'utility|utilities' then 'utility_maintenance_opportunity_candidate'
  when lower(coalesce(title,'')) ~ 'industrial|manufacturing' then 'industrial_demand_opportunity_candidate'
  when lower(coalesce(title,'')) ~ 'competitor|capture|disruption' then 'account_capture_opportunity_candidate'
  else 'opp_' || left(md5(coalesce(title,'') || id::text), 12)
end
where opportunity_key is null;

-- Backfill opportunity action issue_key from the linked opportunity.
update public.risk_actions a
set issue_key = o.opportunity_key
from public.opportunity_register o
where a.opportunity_id = o.id and a.issue_key is null;

update public.opportunity_register set last_seen_at = coalesce(last_seen_at, now()) where last_seen_at is null;

create unique index if not exists opportunity_register_company_key
  on public.opportunity_register (company_id, opportunity_key);
