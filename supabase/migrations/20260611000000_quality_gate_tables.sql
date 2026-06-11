-- Quality Gate tables for GroundSense evidence-to-decision layer.
-- DO NOT apply with `supabase migration repair` or destructive reset.
-- Apply manually after schema review: supabase db push (local) or via dashboard.

-- Evidence claims: structured classification of each raw_event evidence item
create table if not exists evidence_claims (
  id                      uuid primary key default gen_random_uuid(),
  company_id              uuid not null references companies(id) on delete cascade,
  raw_event_id            uuid references raw_events(id) on delete set null,
  claim_text              text,
  claim_type              text not null,          -- freight_rate_change | tariff_rate_change | ...
  driver                  text not null,          -- freight_logistics_cost | construction_demand | ...
  affected_segment        text,
  affected_commodity      text,
  affected_geography      text,
  direction               text,                   -- increase | decrease | uncertain
  magnitude_value         numeric,
  magnitude_unit          text,
  time_period             text,
  source_quality          integer,                -- 0-100
  evidence_directness     text,                   -- company_specific | industry_specific | broad_market | unrelated
  company_relevance_score integer,                -- 0-100
  industry_relevance_score integer,               -- 0-100
  recency_score           integer,                -- 0-100
  confidence_score        integer,                -- 0-100
  extraction_notes        text,
  created_at              timestamptz not null default now()
);

-- Candidate issues: generated but not yet gate-evaluated
create table if not exists candidate_issues (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references companies(id) on delete cascade,
  candidate_type        text not null,            -- risk | opportunity | watchlist | operating_change
  proposed_title        text not null,
  proposed_summary      text,
  proposed_driver       text,
  proposed_impact_low   numeric,
  proposed_impact_high  numeric,
  proposed_section      text,                     -- risk_register | opportunities | watchlist | operating_changes
  source_event_ids      uuid[],
  status                text not null default 'pending',  -- pending | promoted | downgraded | quarantined | ignored
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- Quality gate results: persistent audit trail for each gate evaluation
create table if not exists issue_quality_gate_results (
  id                        uuid primary key default gen_random_uuid(),
  company_id                uuid not null references companies(id) on delete cascade,
  candidate_issue_id        uuid references candidate_issues(id) on delete set null,
  published_risk_id         uuid references risk_register(id) on delete set null,
  published_opportunity_id  uuid references opportunity_register(id) on delete set null,
  decision                  text not null,        -- publish | watchlist | candidate_review | quarantine
  quality_score             integer,              -- 0-100
  evidence_alignment_score  integer,              -- 0-100
  company_relevance_score   integer,              -- 0-100
  mapping_score             integer,              -- 0-100
  financial_model_score     integer,              -- 0-100
  actionability_score       integer,              -- 0-100
  forecast_eligible         boolean default false,
  reasons                   text[],
  required_to_promote       text[],
  blocked_metrics           text[],
  reviewer_notes            text,
  created_at                timestamptz not null default now()
);

-- Candidate issue evidence: links claims to candidates with alignment scoring
create table if not exists candidate_issue_evidence (
  id                  uuid primary key default gen_random_uuid(),
  candidate_issue_id  uuid not null references candidate_issues(id) on delete cascade,
  evidence_claim_id   uuid references evidence_claims(id) on delete set null,
  support_type        text,                       -- aligned | misaligned | irrelevant
  alignment_score     integer,                    -- 0-100
  notes               text,
  created_at          timestamptz not null default now()
);

-- Analyst review actions: log of human decisions on quarantined candidates
create table if not exists analyst_review_actions (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies(id) on delete cascade,
  candidate_issue_id  uuid not null references candidate_issues(id) on delete cascade,
  action              text not null,              -- promote | downgrade | ignore | request_more_evidence
  reviewer_notes      text,
  created_at          timestamptz not null default now()
);

-- Indexes
create index if not exists evidence_claims_company_id_idx on evidence_claims(company_id);
create index if not exists candidate_issues_company_id_idx on candidate_issues(company_id);
create index if not exists issue_quality_gate_results_company_id_idx on issue_quality_gate_results(company_id);
create index if not exists analyst_review_actions_company_id_idx on analyst_review_actions(company_id);
