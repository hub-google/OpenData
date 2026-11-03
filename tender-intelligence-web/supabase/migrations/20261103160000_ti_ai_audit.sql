create table if not exists public.ti_ai_jobs(
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 case_id text,
 document_name text not null,
 task_type text not null default 'qualification_check',
 state text not null default 'pending' check (state in ('pending','success','error')),
 provider_model text,
 error_summary text,
 output jsonb,
 created_at timestamptz not null default now(),
 finished_at timestamptz
);
create index if not exists ti_ai_jobs_user_time on public.ti_ai_jobs(user_id,created_at desc);
alter table public.ti_ai_jobs enable row level security;
revoke all on public.ti_ai_jobs from anon,authenticated;
grant select on public.ti_ai_jobs to authenticated;
create policy ti_ai_jobs_self_read on public.ti_ai_jobs for select to authenticated
using ((select auth.uid())=user_id);
