-- Official PCC government open-data dataset 5988: published debarred vendor announcements.
-- Store only public procurement-relevant fields, not personal contacts/addresses.
create table if not exists public.ti_debarred_vendor_notices(
 id text primary key,
 company_name text not null,
 company_number text,
 case_number text,
 case_name text,
 agency_name text,
 legal_clause text,
 effective_date text,
 expiration_date text,
 announcement_date text,
 appeal_result text,
 source_url text not null default 'https://data.gov.tw/dataset/5988',
 fetched_at timestamptz not null default now()
);
alter table public.ti_debarred_vendor_notices enable row level security;
revoke all on public.ti_debarred_vendor_notices from anon,authenticated;
grant select on public.ti_debarred_vendor_notices to anon,authenticated;
create policy ti_debarred_public_records on public.ti_debarred_vendor_notices
 for select to anon,authenticated using(true);
create index if not exists ti_debarred_company_number
 on public.ti_debarred_vendor_notices(company_number);
create index if not exists ti_debarred_company_name
 on public.ti_debarred_vendor_notices(company_name);
create table if not exists public.ti_external_source_runs(
 id bigint generated always as identity primary key,
 source_id text not null,
 started_at timestamptz not null default now(),
 finished_at timestamptz,
 status text not null check(status in ('running','success','error')),
 fetched_count integer,
 stored_count integer,
 error_summary text
);
alter table public.ti_external_source_runs enable row level security;
revoke all on public.ti_external_source_runs from anon,authenticated;
grant select on public.ti_external_source_runs to anon,authenticated;
create policy ti_external_runs_public_read on public.ti_external_source_runs
 for select to anon,authenticated using(true);
select cron.schedule('ti_pcc_debarred_daily','24 0 * * *',$job$
 select net.http_post(
 url:='https://unapiwajmgqqtdkixaab.supabase.co/functions/v1/ti-debarred-ingest',
 headers:=jsonb_build_object('Content-Type','application/json','x-ti-cron',
   (select decrypted_secret from vault.decrypted_secrets where name='ti_pcc_ingest_token')),
 body:='{}'::jsonb,timeout_milliseconds:=120000);
$job$);
