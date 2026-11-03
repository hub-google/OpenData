-- Taiwan procurement data store. Dedicated ti_ namespace in the existing Supabase project.
-- Sources: OpenFun PCC API (third-party index of Taiwan Government e-Procurement announcements).
-- Public data is normalized, not fabricated; unknown monetary values remain NULL.
create table if not exists public.ti_sources (
  id text primary key,
  provider text not null,
  api_url text not null,
  source_url text not null,
  method text not null default 'GET API',
  frequency_minutes integer not null check (frequency_minutes > 0),
  commercial_license_status text not null default '待向資料提供者確認完整商用再利用授權',
  last_success_at timestamptz,
  last_error_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now()
);
create table if not exists public.ti_cases (
  id text primary key,
  unit_id text not null,
  job_number text not null,
  title text not null,
  agency text,
  category text,
  group_name text,
  latest_notice_type text,
  latest_notice_date integer,
  budget_amount numeric(18,2),
  award_amount numeric(18,2),
  deadline_at timestamptz,
  official_url text,
  latest_filename text,
  first_seen_at timestamptz not null default now(),
  source_fetched_at timestamptz not null default now(),
  unique(unit_id,job_number)
);
create index if not exists ti_cases_date_idx on public.ti_cases(latest_notice_date desc);
create index if not exists ti_cases_agency_idx on public.ti_cases(unit_id,latest_notice_date desc);
create index if not exists ti_cases_budget_idx on public.ti_cases(budget_amount desc);
create table if not exists public.ti_notices (
  id text primary key,
  case_id text not null references public.ti_cases(id) on delete cascade,
  source_date integer not null,
  filename text not null,
  notice_type text,
  title text,
  category text,
  budget_amount numeric(18,2),
  award_amount numeric(18,2),
  official_url text,
  company_ids text[] not null default '{}',
  company_names text[] not null default '{}',
  company_role_keys jsonb not null default '{}'::jsonb,
  raw_brief jsonb not null default '{}'::jsonb,
  fetched_at timestamptz not null default now()
);
create index if not exists ti_notices_case_idx on public.ti_notices(case_id, source_date desc);
create index if not exists ti_notices_date_idx on public.ti_notices(source_date desc);
create table if not exists public.ti_case_details (
  case_id text primary key references public.ti_cases(id) on delete cascade,
  latest_notice_id text,
  details jsonb not null default '{}'::jsonb,
  records_count integer not null default 0,
  fetched_at timestamptz not null default now()
);
create table if not exists public.ti_ingest_runs (
  id bigint generated always as identity primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  source_date integer,
  status text not null default 'running' check(status in ('running','success','error','partial')),
  fetched_count integer not null default 0,
  new_notice_count integer not null default 0,
  detail_count integer not null default 0,
  error_summary text
);
create index if not exists ti_ingest_runs_at on public.ti_ingest_runs(started_at desc);

-- Personal data: only the authenticated owner can read/write their records.
create table if not exists public.ti_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  keywords text not null default '',
  excludes text not null default '',
  min_budget numeric(18,2),
  max_budget numeric(18,2),
  preferred_area text,
  updated_at timestamptz not null default now(),
  constraint ti_profile_budget_order check (min_budget is null or max_budget is null or min_budget <= max_budget)
);
create table if not exists public.ti_saved_cases (
  user_id uuid not null references auth.users(id) on delete cascade,
  case_id text not null references public.ti_cases(id) on delete cascade,
  stage text not null default '評估中'
    check(stage in ('評估中','準備投標','已投標','待決標','已得標','未得標','不投')),
  notes text not null default '',
  internal_deadline date,
  added_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(user_id,case_id)
);
create index if not exists ti_saved_cases_user_idx on public.ti_saved_cases(user_id,updated_at desc);
create table if not exists public.ti_watch_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  keywords text not null,
  excludes text not null default '',
  agency_id text,
  group_name text,
  min_budget numeric(18,2),
  max_budget numeric(18,2),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  last_checked_at timestamptz,
  constraint ti_watch_kw_length check (char_length(keywords) between 2 and 120),
  constraint ti_watch_budget_order check (min_budget is null or max_budget is null or min_budget <= max_budget)
);
create index if not exists ti_watch_rules_user_idx on public.ti_watch_rules(user_id,enabled);
create table if not exists public.ti_notifications (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  rule_id uuid not null references public.ti_watch_rules(id) on delete cascade,
  case_id text not null references public.ti_cases(id) on delete cascade,
  notice_id text not null references public.ti_notices(id) on delete cascade,
  reason text not null default '新公告',
  created_at timestamptz not null default now(),
  seen_at timestamptz,
  unique(user_id,rule_id,notice_id)
);
create index if not exists ti_notifications_user_idx on public.ti_notifications(user_id,created_at desc);
create table if not exists public.ti_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  case_id text not null references public.ti_cases(id) on delete cascade,
  title text not null check(char_length(title) between 1 and 300),
  due_at timestamptz,
  done boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ti_tasks_user_idx on public.ti_tasks(user_id,case_id,done);
create table if not exists public.ti_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  case_id text references public.ti_cases(id) on delete set null,
  filename text not null,
  storage_path text not null,
  mime_type text,
  bytes bigint check(bytes is null or bytes >= 0),
  extraction_status text not null default 'uploaded'
    check(extraction_status in ('uploaded','processing','processed','error')),
  extracted jsonb,
  created_at timestamptz not null default now()
);
create index if not exists ti_documents_user_idx on public.ti_documents(user_id,created_at desc);

-- All exposed tables have RLS. Public factual reads are separated from private user records.
alter table public.ti_sources enable row level security;
alter table public.ti_cases enable row level security;
alter table public.ti_notices enable row level security;
alter table public.ti_case_details enable row level security;
alter table public.ti_ingest_runs enable row level security;
alter table public.ti_profiles enable row level security;
alter table public.ti_saved_cases enable row level security;
alter table public.ti_watch_rules enable row level security;
alter table public.ti_notifications enable row level security;
alter table public.ti_tasks enable row level security;
alter table public.ti_documents enable row level security;

revoke all on public.ti_sources, public.ti_cases, public.ti_notices, public.ti_case_details,
 public.ti_ingest_runs, public.ti_profiles, public.ti_saved_cases, public.ti_watch_rules,
 public.ti_notifications, public.ti_tasks, public.ti_documents from anon,authenticated;
grant select on public.ti_sources,public.ti_cases,public.ti_notices,public.ti_case_details,public.ti_ingest_runs to anon,authenticated;
grant select,insert,update,delete on public.ti_profiles,public.ti_saved_cases,
 public.ti_watch_rules,public.ti_tasks,public.ti_documents to authenticated;
grant select,update,delete on public.ti_notifications to authenticated;
grant usage,select on all sequences in schema public to service_role;

drop policy if exists ti_sources_public_read on public.ti_sources;
create policy ti_sources_public_read on public.ti_sources for select to anon,authenticated using(true);
drop policy if exists ti_cases_public_read on public.ti_cases;
create policy ti_cases_public_read on public.ti_cases for select to anon,authenticated using(true);
drop policy if exists ti_notices_public_read on public.ti_notices;
create policy ti_notices_public_read on public.ti_notices for select to anon,authenticated using(true);
drop policy if exists ti_details_public_read on public.ti_case_details;
create policy ti_details_public_read on public.ti_case_details for select to anon,authenticated using(true);
drop policy if exists ti_runs_public_read on public.ti_ingest_runs;
create policy ti_runs_public_read on public.ti_ingest_runs for select to anon,authenticated using(true);

drop policy if exists ti_profile_self on public.ti_profiles;
create policy ti_profile_self on public.ti_profiles for all to authenticated
 using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
drop policy if exists ti_saved_self on public.ti_saved_cases;
create policy ti_saved_self on public.ti_saved_cases for all to authenticated
 using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
drop policy if exists ti_watches_self on public.ti_watch_rules;
create policy ti_watches_self on public.ti_watch_rules for all to authenticated
 using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
drop policy if exists ti_tasks_self on public.ti_tasks;
create policy ti_tasks_self on public.ti_tasks for all to authenticated
 using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
drop policy if exists ti_documents_self on public.ti_documents;
create policy ti_documents_self on public.ti_documents for all to authenticated
 using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
drop policy if exists ti_notifications_self on public.ti_notifications;
create policy ti_notifications_self on public.ti_notifications for select to authenticated
 using ((select auth.uid())=user_id);
drop policy if exists ti_notifications_self_update on public.ti_notifications;
create policy ti_notifications_self_update on public.ti_notifications for update to authenticated
 using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
drop policy if exists ti_notifications_self_delete on public.ti_notifications;
create policy ti_notifications_self_delete on public.ti_notifications for delete to authenticated
 using ((select auth.uid())=user_id);

insert into public.ti_sources(id,provider,api_url,source_url,method,frequency_minutes,commercial_license_status)
values ('openfun-pcc','OpenFun 政府採購公告 API','https://pcc-api.openfun.app/api','https://web.pcc.gov.tw','GET API（不直接爬政府網站）',60,'正式商業重製及批次再利用授權仍須向提供者確認')
on conflict (id) do update set frequency_minutes=excluded.frequency_minutes,method=excluded.method,api_url=excluded.api_url;
