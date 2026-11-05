-- Source-backed competitor event generation; uses official notice company_role_keys.
create schema if not exists ti_private;
revoke all on schema ti_private from public, anon, authenticated;
create or replace function ti_private.generate_competitor_alerts(p_days integer default 3)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, ti_private
as $$
declare
 v_added integer := 0;
begin
 if p_days < 1 or p_days > 14 then raise exception 'lookback must be between 1 and 14 days';end if;
 with watch_matches as (
   select distinct
     w.user_id,
     n.id as notice_id,
     n.case_id,
     w.company_name,
     exists(
       select 1
       from jsonb_array_elements_text(coalesce(n.company_role_keys -> w.company_name,'[]'::jsonb)) r(role)
       where r.role like '%得標廠商%'
     ) as winner
   from public.ti_competitor_watches w
   join public.ti_notices n on
     n.source_date >= to_char(((now() at time zone 'Asia/Taipei')::date - p_days),'YYYYMMDD')::integer
     and n.source_date >= to_char((w.created_at at time zone 'Asia/Taipei')::date,'YYYYMMDD')::integer
     and w.company_name = any(n.company_names)
     and n.company_role_keys ? w.company_name
   where w.active = true
 )
 insert into public.ti_notifications(user_id,rule_id,case_id,notice_id,reason)
 select user_id,null,case_id,notice_id,
   case when winner then '指定廠商新得標：' else '指定廠商公告異動：' end || left(company_name,180)
 from watch_matches
 on conflict (user_id,notice_id,reason) do nothing;
 get diagnostics v_added = row_count;
 return jsonb_build_object('inserted',v_added,'lookback_days',p_days);
end;
$$;
revoke all on function ti_private.generate_competitor_alerts(integer) from public, anon, authenticated;
grant usage on schema ti_private to service_role;
grant execute on function ti_private.generate_competitor_alerts(integer) to service_role;
create index if not exists ti_notices_source_date_competitor on public.ti_notices(source_date desc);
do $schedule$
begin
 if exists(select 1 from cron.job where jobname = 'ti-competitor-watch-hourly') then
  perform cron.unschedule('ti-competitor-watch-hourly');
 end if;
 perform cron.schedule('ti-competitor-watch-hourly','25 * * * *','select ti_private.generate_competitor_alerts(3);');
end;
$schedule$;
comment on function ti_private.generate_competitor_alerts(integer)
is 'Adds source-backed notices for exact company-name watch matches; winning status only when official source key identifies 得標廠商. No undocumented relationships inferred.';