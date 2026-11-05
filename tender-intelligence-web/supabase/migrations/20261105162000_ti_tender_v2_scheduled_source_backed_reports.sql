-- Tender v2: persistent scheduled reports; SQL produces actual source-backed snapshots.
create table if not exists public.ti_report_schedules (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 report_type text not null check(report_type in ('daily_cases','monthly_market','my_pipeline')),
 title text not null default '' check(length(title)<=180),
 keyword text not null default '' check(length(keyword)<=100),
 agency text not null default '' check(length(agency)<=100),
 frequency text not null default 'daily' check(frequency in ('daily','weekly','monthly')),
 enabled boolean not null default true,
 last_report_on date,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists ti_report_schedules_owner on public.ti_report_schedules(user_id,enabled);
alter table public.ti_report_schedules enable row level security;
drop policy if exists ti_report_schedules_owner on public.ti_report_schedules;
create policy ti_report_schedules_owner on public.ti_report_schedules for all to authenticated
 using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
grant select,insert,update,delete on public.ti_report_schedules to authenticated;

alter table public.ti_report_jobs add column if not exists schedule_id uuid references public.ti_report_schedules(id) on delete set null;
alter table public.ti_report_jobs add column if not exists report_day date;
create unique index if not exists ti_report_jobs_schedule_day on public.ti_report_jobs(schedule_id,report_day) where schedule_id is not null;

create or replace function ti_private.generate_scheduled_reports(p_report_day date default (now() at time zone 'Asia/Taipei')::date)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,ti_private
as $$
declare
 item public.ti_report_schedules%rowtype;
 start_day date;
 end_day date := p_report_day-1;
 start_date_int integer;
 end_date_int integer;
 payload jsonb;
 report_rows jsonb;
 made integer := 0;
begin
 for item in select * from public.ti_report_schedules
   where enabled and (last_report_on is null or last_report_on<p_report_day)
   order by created_at limit 200
 loop
   if item.frequency='weekly' and extract(dow from p_report_day)<>1 then continue;end if;
   if item.frequency='monthly' and extract(day from p_report_day)<>1 then continue;end if;
   start_day := case item.frequency
      when 'weekly' then p_report_day-7
      when 'monthly' then (date_trunc('month',p_report_day::timestamp)-interval '1 month')::date
      else p_report_day-1 end;
   if item.frequency='monthly' then end_day := (date_trunc('month',p_report_day::timestamp)-interval '1 day')::date;
   else end_day := p_report_day-1;end if;
   start_date_int := to_char(start_day,'YYYYMMDD')::integer;
   end_date_int := to_char(end_day,'YYYYMMDD')::integer;

   if item.report_type='my_pipeline' then
     select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into report_rows
     from (
       select case_id,title,agency,stage,internal_deadline,added_at
       from public.ti_saved_cases
       where user_id=item.user_id
       order by added_at desc limit 300
     ) r;
     payload:=jsonb_build_object('columns',jsonb_build_array('case_id','title','agency','stage','internal_deadline','added_at'),
       'rows',report_rows,'period_start',start_day,'period_end',end_day,
       'description','本人已收藏並保存的投標案件；並非全國得標績效');

   elsif item.report_type='monthly_market' then
     select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into report_rows
     from (
       select coalesce(nullif(group_name,''),'未分類') as category,count(*)::integer as case_count,
              count(budget_amount)::integer as budget_known,
              sum(budget_amount) as budget_total,
              count(award_amount)::integer as award_known,
              sum(award_amount) as award_total
       from public.ti_cases
       where latest_notice_date between start_date_int and end_date_int
         and (item.keyword='' or title ilike '%'||item.keyword||'%')
         and (item.agency='' or agency ilike '%'||item.agency||'%')
       group by 1 order by count(*) desc limit 30
     ) r;
     payload:=jsonb_build_object('columns',jsonb_build_array('category','case_count','budget_known','budget_total','award_known','award_total'),
       'rows',report_rows,'period_start',start_day,'period_end',end_day,
       'description','本平台已成功入庫公告按案號去重的樣本統計；金額未知不當零、資料缺日不代表無採購');

   else
     select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into report_rows
     from (
       select id as case_id,title,agency,latest_notice_type as status,latest_notice_date as notice_date,
              budget_amount,deadline_at,official_url
       from public.ti_cases
       where latest_notice_date between start_date_int and end_date_int
         and (item.keyword='' or title ilike '%'||item.keyword||'%')
         and (item.agency='' or agency ilike '%'||item.agency||'%')
       order by latest_notice_date desc,id limit 200
     ) r;
     payload:=jsonb_build_object('columns',jsonb_build_array('case_id','title','agency','status','notice_date','budget_amount','deadline_at','official_url'),
       'rows',report_rows,'period_start',start_day,'period_end',end_day,
       'description','最近成功入庫的公告案件（最多 200 筆）與原始來源；不是全國完整清單');
   end if;

   insert into public.ti_report_jobs(user_id,report_type,title,filters,status,result_data,finished_at,schedule_id,report_day)
   values(item.user_id,item.report_type,coalesce(nullif(item.title,''),'自動報表'),
     jsonb_build_object('keyword',item.keyword,'agency',item.agency,'frequency',item.frequency),
     'completed',payload,now(),item.id,p_report_day)
   on conflict (schedule_id,report_day) where schedule_id is not null do nothing;
   if found then made:=made+1;end if;
   update public.ti_report_schedules set last_report_on=p_report_day,updated_at=now() where id=item.id;
 end loop;
 return jsonb_build_object('generated',made,'report_day',p_report_day);
end;
$$;
revoke all on function ti_private.generate_scheduled_reports(date) from public,anon,authenticated;
grant execute on function ti_private.generate_scheduled_reports(date) to service_role;
do $schedule$
begin
 if exists(select 1 from cron.job where jobname='ti-generate-user-reports') then perform cron.unschedule('ti-generate-user-reports');end if;
 perform cron.schedule('ti-generate-user-reports','20 0 * * *','select ti_private.generate_scheduled_reports();');
end;
$schedule$;
comment on table public.ti_report_schedules is 'RLS-protected user report subscriptions; snapshots are generated server-side by pg_cron and stored in ti_report_jobs';