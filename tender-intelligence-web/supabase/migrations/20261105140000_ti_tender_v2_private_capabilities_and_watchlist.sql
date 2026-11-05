-- Tender intelligence v2: private company capability and intelligence workspace.
-- Additive only: no existing records or public tender source tables are changed.
create table if not exists public.ti_company_profiles (
 user_id uuid primary key references auth.users(id) on delete cascade,
 company_name text not null default '',
 tax_id text,
 services text not null default '',
 company_intro text not null default '',
 updated_at timestamptz not null default now(),
 constraint ti_company_profiles_taxid_format check (tax_id is null or tax_id ~ '^[0-9]{8}$')
);
alter table public.ti_company_profiles enable row level security;
drop policy if exists ti_company_profiles_owner on public.ti_company_profiles;
create policy ti_company_profiles_owner on public.ti_company_profiles for all to authenticated
 using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));
grant select, insert, update, delete on public.ti_company_profiles to authenticated;

create table if not exists public.ti_company_assets (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 asset_type text not null check (asset_type in ('certificate','project','catalogue','reference','service')),
 title text not null check (char_length(title) between 1 and 250),
 issuer text not null default '',
 reference_number text not null default '',
 issued_on date,
 expires_on date,
 details text not null default '',
 document_id uuid,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists ti_company_assets_owner_type on public.ti_company_assets(user_id,asset_type,created_at desc);
alter table public.ti_company_assets enable row level security;
drop policy if exists ti_company_assets_owner on public.ti_company_assets;
create policy ti_company_assets_owner on public.ti_company_assets for all to authenticated
 using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));
grant select, insert, update, delete on public.ti_company_assets to authenticated;

create table if not exists public.ti_competitor_watches (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 company_name text not null check (char_length(company_name) between 2 and 180),
 tax_id text,
 active boolean not null default true,
 created_at timestamptz not null default now(),
 constraint ti_competitor_tax_id check (tax_id is null or tax_id ~ '^[0-9]{8}$')
);
create unique index if not exists ti_competitor_watches_dedupe on public.ti_competitor_watches(user_id,lower(company_name),coalesce(tax_id,''));
alter table public.ti_competitor_watches enable row level security;
drop policy if exists ti_competitor_watches_owner on public.ti_competitor_watches;
create policy ti_competitor_watches_owner on public.ti_competitor_watches for all to authenticated
 using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));
grant select, insert, update, delete on public.ti_competitor_watches to authenticated;

create table if not exists public.ti_report_jobs (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 report_type text not null check (report_type in ('daily_cases','monthly_market','my_pipeline')),
 title text not null default '',
 filters jsonb not null default '{}'::jsonb,
 status text not null default 'queued' check (status in ('queued','running','completed','failed')),
 result_data jsonb,
 error_summary text,
 created_at timestamptz not null default now(),
 finished_at timestamptz
);
create index if not exists ti_report_jobs_owner_created on public.ti_report_jobs(user_id,created_at desc);
alter table public.ti_report_jobs enable row level security;
drop policy if exists ti_report_jobs_owner on public.ti_report_jobs;
create policy ti_report_jobs_owner on public.ti_report_jobs for select to authenticated using (user_id=(select auth.uid()));
-- Server-owned jobs only; clients cannot forge completed report outputs.
grant select on public.ti_report_jobs to authenticated;
revoke insert, update, delete on public.ti_report_jobs from anon, authenticated;
comment on table public.ti_company_assets is 'Private verified-or-user-entered company capabilities; never publicly exposed as official certification evidence';
comment on table public.ti_competitor_watches is 'Private competitor watch targets, not yet automatic delivery without source-backed events';