-- ============================================================================
-- Automatic Intelligence Updates — scheduler data model + run locking.
--
-- ADDITIVE ONLY. Creates new tables/functions for scheduling, locking, run
-- history, and meaningful-change tracking. Does NOT touch existing intelligence,
-- calibration, or source data. RLS is left disabled to match the existing
-- demo-table convention in this project (reads use the anon client).
-- ============================================================================

-- ── 1. Scheduler configuration ─────────────────────────────────────────────
create table if not exists public.intelligence_scheduler_config (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid references public.companies(id) on delete cascade,
  enabled          boolean not null default true,
  schedule_name    text not null default 'default',
  cadence          text not null default 'daily',
  cron_expression  text not null default '0 10 * * *',
  timezone         text not null default 'UTC',
  run_mode         text not null default 'full',
  source_scope     text not null default 'all',
  min_change_threshold numeric,
  allow_generation boolean not null default true,
  allow_publishing boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- One config per (company, schedule_name); company_id null = global default.
create unique index if not exists intelligence_scheduler_config_unique
  on public.intelligence_scheduler_config (coalesce(company_id, '00000000-0000-0000-0000-000000000000'::uuid), schedule_name);

-- ── 2. Run locks (overlap prevention) ──────────────────────────────────────
create table if not exists public.intelligence_run_locks (
  lock_key     text primary key,
  run_id       uuid,
  acquired_at  timestamptz not null default now(),
  expires_at   timestamptz not null,
  acquired_by  text,
  metadata     jsonb not null default '{}'::jsonb
);

-- ── 3. Run history / summaries (UI-readable) ───────────────────────────────
create table if not exists public.intelligence_run_summaries (
  id                     uuid primary key default gen_random_uuid(),
  pipeline_run_id        uuid,
  trigger_type           text not null default 'manual',     -- manual | scheduled | upload_triggered | retry
  status                 text not null default 'queued',     -- queued | running | completed | completed_with_warnings | skipped | failed
  started_at             timestamptz not null default now(),
  completed_at           timestamptz,
  company_id             uuid references public.companies(id) on delete set null,
  schedule_name          text,
  sources_checked        integer not null default 0,
  observations_ingested  integer not null default 0,
  verified_shocks_created integer not null default 0,
  candidates_generated   integer not null default 0,
  candidates_published   integer not null default 0,
  candidates_review      integer not null default 0,
  candidates_quarantined integer not null default 0,
  actions_created        integer not null default 0,
  exposure_graph_rebuilt boolean not null default false,
  executive_brief_rebuilt boolean not null default false,
  skipped_reason         text,
  error_message          text,
  summary                jsonb not null default '{}'::jsonb,
  created_at             timestamptz not null default now()
);

create index if not exists intelligence_run_summaries_status_started
  on public.intelligence_run_summaries (status, started_at desc);
create index if not exists intelligence_run_summaries_trigger_started
  on public.intelligence_run_summaries (trigger_type, started_at desc);
create index if not exists intelligence_run_summaries_company_started
  on public.intelligence_run_summaries (company_id, started_at desc);

-- ── 4. Meaningful-change events (avoid needless regeneration) ──────────────
create table if not exists public.intelligence_change_events (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid references public.companies(id) on delete cascade,
  run_summary_id uuid references public.intelligence_run_summaries(id) on delete set null,
  source_domain text not null,
  metric_key    text,
  previous_value numeric,
  current_value numeric,
  absolute_change numeric,
  percent_change numeric,
  change_type   text not null default 'observation',
  materiality   text not null default 'none',               -- none | low | medium | high
  should_trigger_generation boolean not null default false,
  detected_at   timestamptz not null default now(),
  metadata      jsonb not null default '{}'::jsonb
);

create index if not exists intelligence_change_events_detected
  on public.intelligence_change_events (detected_at desc);
create index if not exists intelligence_change_events_trigger
  on public.intelligence_change_events (should_trigger_generation);

-- ── 5. Lock RPCs (SECURITY DEFINER so the anon/edge client can call safely) ─

-- Acquire a lock. Returns true if acquired (free or stale), false if held & fresh.
create or replace function public.acquire_intelligence_run_lock(
  p_lock_key text,
  p_run_id uuid,
  p_ttl_seconds integer default 900,
  p_acquired_by text default 'unknown'
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
begin
  insert into public.intelligence_run_locks (lock_key, run_id, acquired_at, expires_at, acquired_by)
  values (p_lock_key, p_run_id, v_now, v_now + make_interval(secs => p_ttl_seconds), p_acquired_by)
  on conflict (lock_key) do update
    set run_id = excluded.run_id,
        acquired_at = excluded.acquired_at,
        expires_at = excluded.expires_at,
        acquired_by = excluded.acquired_by
    -- only steal the lock if the existing one has expired
    where public.intelligence_run_locks.expires_at < v_now;

  -- We hold the lock iff the current row's run_id is ours.
  return exists (
    select 1 from public.intelligence_run_locks
    where lock_key = p_lock_key and run_id = p_run_id
  );
end;
$$;

-- Release a lock we own (no-op if someone else holds it).
create or replace function public.release_intelligence_run_lock(
  p_lock_key text,
  p_run_id uuid
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.intelligence_run_locks
  where lock_key = p_lock_key and run_id = p_run_id;
  return found;
end;
$$;

-- Sweep expired locks (call from cron or before acquiring).
create or replace function public.expire_stale_intelligence_locks()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  delete from public.intelligence_run_locks where expires_at < now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ── 6. updated_at trigger for config ───────────────────────────────────────
create or replace function public.touch_intelligence_scheduler_config()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists trg_touch_scheduler_config on public.intelligence_scheduler_config;
create trigger trg_touch_scheduler_config
  before update on public.intelligence_scheduler_config
  for each row execute function public.touch_intelligence_scheduler_config();

-- ── 7. Seed a single global default schedule (idempotent) ───────────────────
insert into public.intelligence_scheduler_config (company_id, enabled, schedule_name, cadence, cron_expression, timezone, run_mode, source_scope)
select null, true, 'default', 'daily', '0 10 * * *', 'UTC', 'full', 'all'
where not exists (
  select 1 from public.intelligence_scheduler_config
  where company_id is null and schedule_name = 'default'
);
