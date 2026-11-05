-- Signed-in users can request source enrichment for an existing case; the existing
-- server-only ingestion worker performs the actual third-party API fetch.
create table if not exists public.ti_detail_requests(
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 case_id text not null references public.ti_cases(id) on delete cascade,
 status text not null default 'queued' check(status in ('queued','fulfilled')),
 requested_at timestamptz not null default now(),
 completed_at timestamptz,
 error_summary text,
 unique(user_id,case_id)
);
create index if not exists ti_detail_requests_queue on public.ti_detail_requests(status,requested_at,case_id);
alter table public.ti_detail_requests enable row level security;
drop policy if exists ti_detail_requests_owner_read on public.ti_detail_requests;
create policy ti_detail_requests_owner_read on public.ti_detail_requests for select to authenticated using(user_id=(select auth.uid()));
drop policy if exists ti_detail_requests_owner_insert on public.ti_detail_requests;
create policy ti_detail_requests_owner_insert on public.ti_detail_requests for insert to authenticated
 with check(user_id=(select auth.uid()) and status='queued' and completed_at is null and error_summary is null);
revoke all on public.ti_detail_requests from anon;
grant select,insert on public.ti_detail_requests to authenticated;

create or replace function public.ti_limit_detail_requests() returns trigger
language plpgsql security invoker set search_path=pg_catalog,public
as $$
begin
 if (select count(*) from public.ti_detail_requests
     where user_id=new.user_id and requested_at>now()-interval '24 hours')>=10 then
   raise exception '24 小時內最多可要求補抓 10 件標案';
 end if;
 return new;
end;
$$;
drop trigger if exists ti_detail_requests_limit on public.ti_detail_requests;
create trigger ti_detail_requests_limit before insert on public.ti_detail_requests
for each row execute function public.ti_limit_detail_requests();

create or replace function public.ti_pick_details_enrichment(p_limit integer default 8)
returns table(case_id text,unit_id text,job_number text,latest_notice_date integer,latest_notice_type text,latest_filename text)
language sql stable security invoker set search_path=pg_catalog,public
as $$
 select c.id,c.unit_id,c.job_number,c.latest_notice_date,c.latest_notice_type,c.latest_filename
 from public.ti_cases c
 left join public.ti_case_details d on d.case_id=c.id
 left join public.ti_detail_enrichment_attempts a on a.case_id=c.id
 left join (select case_id,min(requested_at) as first_requested from public.ti_detail_requests where status='queued' group by case_id) r
  on r.case_id=c.id
 where (d.case_id is null or d.latest_notice_id is distinct from
         (c.id||'::'||c.latest_notice_date::text||'::'||coalesce(c.latest_filename,'')))
   and (a.next_retry_at is null or a.next_retry_at<=now())
   and length(c.unit_id) between 1 and 80 and length(c.job_number) between 1 and 100
 order by
   case when r.first_requested is not null then -1
        when coalesce(c.latest_notice_type,'') ~ '(公開招標公告|公開取得報價單|限制性招標公告|選擇性招標)' then 0
        when coalesce(c.latest_notice_type,'') ~ '(更正公告|招標)' then 1
        when coalesce(c.latest_notice_type,'') ~ '(公開徵求|公開閱覽)' then 2
        else 3 end,
   r.first_requested nulls last,c.latest_notice_date desc,c.id asc
 limit least(greatest(coalesce(p_limit,8),1),12)
$$;
revoke all on function public.ti_pick_details_enrichment(integer) from public,anon,authenticated;
grant execute on function public.ti_pick_details_enrichment(integer) to service_role;
comment on table public.ti_detail_requests is 'Authenticated source-enrichment requests. No user can impersonate source data or set completed status.';