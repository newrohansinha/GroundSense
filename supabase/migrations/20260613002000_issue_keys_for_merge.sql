-- ============================================================================
-- Stable issue keys for non-destructive intelligence merge.
--
-- ADDITIVE ONLY. Adds a stable `issue_key` + lifecycle columns so generate-dynamic-risks
-- can UPSERT by (company_id, issue_key) instead of delete-all-then-insert. Existing rows
-- are backfilled by driver keywords; nothing is deleted.
-- ============================================================================

alter table public.risk_register add column if not exists issue_key text;
alter table public.risk_register add column if not exists last_seen_run_id uuid;
alter table public.risk_register add column if not exists last_seen_at timestamptz;
alter table public.risk_register add column if not exists archived_at timestamptz;
alter table public.risk_register add column if not exists archived_reason text;
alter table public.risk_actions add column if not exists issue_key text;

-- Backfill issue_key from title/type keywords (tariff checked before steel/aluminum so the
-- tariff operating change keys as a tariff, not a metal watch).
update public.risk_register set issue_key = case
  when lower(coalesce(risk_title,'') || ' ' || coalesce(risk_type,'')) ~ 'freight|logistic|shipping|container' then 'freight_logistics_pressure'
  when lower(coalesce(risk_title,'') || ' ' || coalesce(risk_type,'')) ~ 'tariff|duty|trade' then 'tariff_trade_policy_relief'
  when lower(coalesce(risk_title,'')) ~ 'copper' then 'copper_macro_watch'
  when lower(coalesce(risk_title,'')) ~ 'aluminum|aluminium' then 'aluminum_macro_watch'
  when lower(coalesce(risk_title,'')) ~ 'steel' then 'steel_metal_watch'
  when lower(coalesce(risk_title,'') || ' ' || coalesce(risk_type,'')) ~ 'demand|pmi|manufacturing|construction' then 'demand_macro_watch'
  when lower(coalesce(risk_title,'') || ' ' || coalesce(risk_type,'')) ~ 'compet|grainger|msc|applied' then 'competitor_watch'
  else 'issue_' || left(md5(coalesce(risk_title,'') || id::text), 12)
end
where issue_key is null;

-- Backfill action issue_key from the linked risk.
update public.risk_actions a
set issue_key = r.issue_key
from public.risk_register r
where a.risk_id = r.id and a.issue_key is null;

-- Stamp existing rows as seen (so they read as preserved, not freshly generated).
update public.risk_register set last_seen_at = coalesce(last_seen_at, now()) where last_seen_at is null;

-- Unique key for upsert. One active issue per (company, issue_key).
create unique index if not exists risk_register_company_issue_key
  on public.risk_register (company_id, issue_key);
