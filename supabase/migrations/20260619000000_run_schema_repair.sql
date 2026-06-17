-- ============================================================================
-- Run-schema REPAIR — consolidated, idempotent guarantee of every column +
-- table the server-owned run system requires.
--
-- Why a new migration instead of relying on 20260616/17/18: on the live project
-- those versions were recorded/skipped without their columns actually landing
-- (start-intelligence-run failed with "Could not find the `debug` column …").
-- A NEW version always runs on the next `db push`, and every statement here is
-- ADD COLUMN / CREATE TABLE IF NOT EXISTS, so it is safe to apply repeatedly and
-- on top of any partial prior state. No drops, no data deletion.
-- ============================================================================

-- ── 1. intelligence_run_summaries: every column the Edge Functions touch ────
alter table public.intelligence_run_summaries
  -- run metadata
  add column if not exists run_mode               text,
  add column if not exists force                  boolean not null default false,
  add column if not exists trigger_type           text not null default 'manual',
  add column if not exists schedule_name          text,
  -- progress / heartbeat
  add column if not exists current_stage          text,
  add column if not exists current_stage_label    text,
  add column if not exists current_stage_index    integer,
  add column if not exists total_stages           integer,
  add column if not exists next_stage             text,
  add column if not exists stage_cursor           jsonb   not null default '{}'::jsonb,
  add column if not exists progress_pct           integer,
  add column if not exists heartbeat_at           timestamptz,
  add column if not exists last_seen_by_client_at timestamptz,
  -- locking
  add column if not exists lock_key               text,
  add column if not exists lock_expires_at        timestamptz,
  add column if not exists worker_claimed_until   timestamptz,
  -- result / errors
  add column if not exists error_code             text,
  add column if not exists error_message          text,
  add column if not exists warning_message        text,
  add column if not exists note                   text,
  add column if not exists summary                jsonb   not null default '{}'::jsonb,
  add column if not exists debug                  jsonb   not null default '{}'::jsonb,
  -- counters
  add column if not exists raw_queries_generated       integer not null default 0,
  add column if not exists deduped_queries             integer not null default 0,
  add column if not exists capped_queries              integer not null default 0,
  add column if not exists queries_executed            integer not null default 0,
  add column if not exists articles_fetched            integer not null default 0,
  add column if not exists articles_normalized         integer not null default 0,
  add column if not exists articles_inserted           integer not null default 0,
  add column if not exists article_duplicates          integer not null default 0,
  add column if not exists articles_rejected           integer not null default 0,
  add column if not exists company_evaluations_created integer not null default 0,
  add column if not exists verified_shocks_created     integer not null default 0,
  add column if not exists candidates_generated        integer not null default 0,
  add column if not exists candidates_published        integer not null default 0,
  add column if not exists candidates_review           integer not null default 0,
  add column if not exists candidates_quarantined      integer not null default 0,
  add column if not exists watch_items_created         integer not null default 0,
  add column if not exists actions_created             integer not null default 0,
  add column if not exists exposure_paths_created      integer not null default 0,
  add column if not exists forecasts_created           integer not null default 0,
  add column if not exists briefs_created              integer not null default 0;

create index if not exists intelligence_run_summaries_company_status_started
  on public.intelligence_run_summaries (company_id, status, started_at desc);
create index if not exists intelligence_run_summaries_worker_sweep
  on public.intelligence_run_summaries (status, worker_claimed_until, started_at)
  where status in ('queued', 'running');

-- ── 2. intelligence_run_events (per-stage breadcrumbs) ──────────────────────
create table if not exists public.intelligence_run_events (
  id          uuid primary key default gen_random_uuid(),
  run_id      uuid,
  summary_id  uuid references public.intelligence_run_summaries(id) on delete cascade,
  company_id  uuid references public.companies(id) on delete set null,
  stage       text not null,
  level       text not null default 'info',
  message     text not null,
  counters    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
-- Defensive: ensure columns exist even if the table predates this shape.
alter table public.intelligence_run_events
  add column if not exists run_id     uuid,
  add column if not exists summary_id uuid,
  add column if not exists company_id uuid,
  add column if not exists stage      text,
  add column if not exists level      text default 'info',
  add column if not exists message    text,
  add column if not exists counters   jsonb not null default '{}'::jsonb,
  add column if not exists created_at timestamptz not null default now();

create index if not exists intelligence_run_events_summary_created
  on public.intelligence_run_events (summary_id, created_at desc);
create index if not exists intelligence_run_events_run_created
  on public.intelligence_run_events (run_id, created_at desc);
create index if not exists intelligence_run_events_company_created
  on public.intelligence_run_events (company_id, created_at desc);

-- ── 3. Schema-readiness probe RPC (used by intelligence-healthcheck) ────────
-- Returns { ready boolean, missing text[] } so the healthcheck can report a
-- precise run_schema_ready without exposing anything sensitive.
create or replace function public.intelligence_run_schema_status()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  required text[] := array[
    'run_mode','force','trigger_type','current_stage','current_stage_label',
    'current_stage_index','total_stages','next_stage','stage_cursor','progress_pct',
    'heartbeat_at','last_seen_by_client_at','lock_key','lock_expires_at',
    'worker_claimed_until','error_code','error_message','warning_message','note',
    'summary','debug','raw_queries_generated','deduped_queries','capped_queries',
    'queries_executed','articles_fetched','articles_normalized','articles_inserted',
    'article_duplicates','articles_rejected','company_evaluations_created',
    'verified_shocks_created','candidates_generated','candidates_published',
    'candidates_review','candidates_quarantined','watch_items_created',
    'actions_created','exposure_paths_created','forecasts_created','briefs_created'
  ];
  missing text[];
  events_ok boolean;
begin
  select array_agg(c)
    into missing
  from unnest(required) as c
  where not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'intelligence_run_summaries'
      and column_name = c
  );

  select exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'intelligence_run_events'
  ) into events_ok;

  return jsonb_build_object(
    'ready', (missing is null and events_ok),
    'missing', coalesce(missing, array[]::text[]),
    'events_table', events_ok
  );
end;
$$;

grant execute on function public.intelligence_run_schema_status() to anon, authenticated, service_role;

-- ── 4. Force PostgREST to reload its schema cache immediately ────────────────
notify pgrst, 'reload schema';
