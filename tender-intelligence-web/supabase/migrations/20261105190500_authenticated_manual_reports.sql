-- Authenticated on-demand preview/report snapshot. Every row is filtered by auth.uid().
create or replace function public.ti_generate_report_now(p_schedule_id uuid)
returns uuid language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
 v_uid uuid := auth.uid();
 v_schedule public.ti_report_schedules%rowtype;
 v_id uuid;
 v_rows jsonb := '[]'::jsonb;
 v_columns jsonb;
 v_from date;
 v_to date := (now() at time zone 'Asia/Taipei')::date;
 v_from_int integer;
 v_to_int integer;
 v_frequency text;
begin
 if v_uid is null or p_schedule_id is null then raise exception '請先登入'; end if;
 select * into v_schedule from public.ti_report_schedules
  where id=p_schedule_id and user_id=v_uid and enabled is true;
 if not found then raise exception '找不到可使用的報表排程'; end if;
 if (select count(*) from public.ti_report_jobs
      where user_id=v_uid and created_at>now()-interval '24 hours') >= 12
 then raise exception '每日最多可立即產生 12 份報表'; end if;
 v_frequency:=v_schedule.frequency;
 v_from := case v_frequency
   when 'daily' then v_to
   when 'weekly' then v_to-6
   else date_trunc('month',v_to::timestamp)::date end;
 v_from_int := to_char(v_from,'YYYYMMDD')::integer;
 v_to_int := to_char(v_to,'YYYYMMDD')::integer;
 if v_schedule.report_type='my_pipeline' then
  v_columns:='["case_id","title","agency","stage","internal_deadline","added_at"]'::jsonb;
  select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into v_rows
  from (select case_id,title,agency,stage,internal_deadline,added_at
   from public.ti_saved_cases where user_id=v_uid
   order by added_at desc limit 500) r;
 elsif v_schedule.report_type='monthly_market' then
  v_columns:='["category","case_count","budget_known","budget_total","award_known","award_total"]'::jsonb;
  select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into v_rows
  from (
   select coalesce(nullif(group_name,''),'未分類') category,
     count(*)::integer case_count,
     count(budget_amount)::integer budget_known,
     sum(budget_amount) budget_total,
     count(award_amount)::integer award_known,
     sum(award_amount) award_total
   from public.ti_cases
   where latest_notice_date between v_from_int and v_to_int
     and (v_schedule.keyword='' or title ilike '%'||v_schedule.keyword||'%')
     and (v_schedule.agency='' or agency ilike '%'||v_schedule.agency||'%')
   group by 1 order by count(*) desc limit 30
  ) r;
 else
  v_columns:='["case_id","title","agency","status","notice_date","budget_amount","deadline_at","official_url"]'::jsonb;
  select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into v_rows
  from (
   select id as case_id,title,agency,latest_notice_type as status,
     latest_notice_date as notice_date,budget_amount,deadline_at,official_url
   from public.ti_cases
   where latest_notice_date between v_from_int and v_to_int
     and (v_schedule.keyword='' or title ilike '%'||v_schedule.keyword||'%')
     and (v_schedule.agency='' or agency ilike '%'||v_schedule.agency||'%')
   order by latest_notice_date desc,id limit 300
  ) r;
 end if;
 insert into public.ti_report_jobs(user_id,report_type,title,filters,status,result_data,finished_at)
 values(v_uid,v_schedule.report_type,coalesce(nullif(v_schedule.title,''),'手動報表'),
   jsonb_build_object('manual',true,'schedule_id',p_schedule_id,'agency',v_schedule.agency,'keyword',v_schedule.keyword),
   'completed',
   jsonb_build_object('columns',v_columns,'rows',v_rows,'period_start',v_from,
    'period_end',v_to,'description',
    '本平台實際已入庫案件／個人已儲存資料的即時快照；非全國完整採購資料。未知欄位保持空值。'),
   now()) returning id into v_id;
 return v_id;
end;
$$;
revoke all on function public.ti_generate_report_now(uuid) from public,anon;
grant execute on function public.ti_generate_report_now(uuid) to authenticated;
comment on function public.ti_generate_report_now(uuid)
is 'User-scoped manual report generation. Enforces auth.uid() ownership and daily rate limit. Independent of scheduled report cron.';