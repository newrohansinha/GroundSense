-- GroundSense: Auth, profiles, company workspaces, memberships, onboarding.
-- Additive only. RLS is enabled on the NEW tables created here.
-- The existing 45 data tables are handled in a separate, reviewed migration
-- (../deferred-migrations/20260614010000_full_rls_existing_tables.sql) so the
-- live Fastenal demo and the public "View demo" (anon) path are not broken.
--
-- Applied to the remote project on 2026-06-14 via the Supabase MCP. This file
-- mirrors that change so the repo history stays in sync.

-- ── generic updated_at trigger ────────────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ── 1. profiles ───────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  role_title text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── 2. companies: additive columns (owner_id already exists) ──────────────────
alter table public.companies
  add column if not exists website text,
  add column if not exists company_size text,
  add column if not exists primary_region text,
  add column if not exists onboarding_status text not null default 'not_started',
  add column if not exists onboarding_completed_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

-- ── 3. company_memberships ────────────────────────────────────────────────────
create table if not exists public.company_memberships (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'admin',
  created_at timestamptz not null default now(),
  unique (company_id, user_id)
);
create index if not exists company_memberships_user_idx on public.company_memberships(user_id);
create index if not exists company_memberships_company_idx on public.company_memberships(company_id);

-- ── 4. onboarding_sessions ────────────────────────────────────────────────────
create table if not exists public.onboarding_sessions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  current_step text not null default 'welcome',
  completed_steps text[] not null default '{}',
  status text not null default 'in_progress',
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (company_id)
);

-- ── 5. onboarding_answers ─────────────────────────────────────────────────────
create table if not exists public.onboarding_answers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  step_key text not null,
  answers jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, step_key)
);

-- ── updated_at triggers ───────────────────────────────────────────────────────
drop trigger if exists trg_profiles_updated on public.profiles;
create trigger trg_profiles_updated before update on public.profiles
  for each row execute function public.set_updated_at();

drop trigger if exists trg_companies_updated on public.companies;
create trigger trg_companies_updated before update on public.companies
  for each row execute function public.set_updated_at();

drop trigger if exists trg_onb_sessions_updated on public.onboarding_sessions;
create trigger trg_onb_sessions_updated before update on public.onboarding_sessions
  for each row execute function public.set_updated_at();

drop trigger if exists trg_onb_answers_updated on public.onboarding_answers;
create trigger trg_onb_answers_updated before update on public.onboarding_answers
  for each row execute function public.set_updated_at();

-- ── membership helper functions (SECURITY DEFINER avoids RLS recursion) ───────
create or replace function public.current_user_company_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select company_id from public.company_memberships where user_id = auth.uid()
$$;

create or replace function public.is_company_member(p_company_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.company_memberships
    where company_id = p_company_id and user_id = auth.uid()
  )
$$;

create or replace function public.is_company_admin(p_company_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.company_memberships
    where company_id = p_company_id and user_id = auth.uid()
      and role in ('owner', 'admin')
  )
$$;

-- ── auto-create profile on new auth user ──────────────────────────────────────
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, role_title)
  values (
    new.id,
    new.email,
    nullif(new.raw_user_meta_data->>'full_name', ''),
    nullif(new.raw_user_meta_data->>'role_title', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── RLS: NEW tables only ──────────────────────────────────────────────────────
alter table public.profiles enable row level security;
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles for select using (id = auth.uid());
drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own on public.profiles for insert with check (id = auth.uid());
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());

alter table public.company_memberships enable row level security;
drop policy if exists memberships_select_own on public.company_memberships;
create policy memberships_select_own on public.company_memberships for select using (user_id = auth.uid());
drop policy if exists memberships_insert_self on public.company_memberships;
create policy memberships_insert_self on public.company_memberships for insert with check (user_id = auth.uid());
drop policy if exists memberships_delete_self on public.company_memberships;
create policy memberships_delete_self on public.company_memberships for delete using (user_id = auth.uid());

alter table public.onboarding_sessions enable row level security;
drop policy if exists onb_sessions_rw on public.onboarding_sessions;
create policy onb_sessions_rw on public.onboarding_sessions for all
  using (user_id = auth.uid() or public.is_company_member(company_id))
  with check (user_id = auth.uid() or public.is_company_member(company_id));

alter table public.onboarding_answers enable row level security;
drop policy if exists onb_answers_rw on public.onboarding_answers;
create policy onb_answers_rw on public.onboarding_answers for all
  using (public.is_company_member(company_id))
  with check (public.is_company_member(company_id));
