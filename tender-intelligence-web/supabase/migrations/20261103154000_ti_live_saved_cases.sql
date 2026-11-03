-- A live OpenFun search can find cases not yet ingested by the hourly archive.
-- Allow saving these verifiable external IDs without forging a local case row.
alter table public.ti_saved_cases drop constraint if exists ti_saved_cases_case_id_fkey;
alter table public.ti_saved_cases add column if not exists title text;
alter table public.ti_saved_cases add column if not exists agency text;
alter table public.ti_saved_cases add column if not exists unit_id text;
alter table public.ti_saved_cases add column if not exists job_number text;
alter table public.ti_saved_cases add column if not exists budget_amount numeric(18,2);
alter table public.ti_saved_cases add column if not exists source_url text;
alter table public.ti_tasks drop constraint if exists ti_tasks_case_id_fkey;
alter table public.ti_documents drop constraint if exists ti_documents_case_id_fkey;
create index if not exists ti_saved_title_idx on public.ti_saved_cases (user_id, added_at desc);
