-- Per-user, source-grounded manual comparison of tender requirements to private company assets.
create table if not exists public.ti_qualification_checks (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 case_id text,
 document_name text not null check(length(document_name) between 1 and 255),
 page_count integer not null default 0 check(page_count between 0 and 150),
 checks jsonb not null default '[]'::jsonb check(jsonb_typeof(checks)='array'),
 created_at timestamptz not null default now()
);
create index if not exists ti_qualification_checks_owner_case on public.ti_qualification_checks(user_id,case_id,created_at desc);
alter table public.ti_qualification_checks enable row level security;
drop policy if exists ti_qualification_checks_owner on public.ti_qualification_checks;
create policy ti_qualification_checks_owner on public.ti_qualification_checks for all to authenticated
 using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
grant select,insert,update,delete on public.ti_qualification_checks to authenticated;
revoke all on public.ti_qualification_checks from anon;
comment on table public.ti_qualification_checks is 'Private manual review records; text matching is only a candidate suggestion and does not assert verified qualifications';