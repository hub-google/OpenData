-- D05 public award history: calculate statistics across ALL matching cases before
-- applying a display limit. This is descriptive, not a reserve-price estimate.
create or replace function public.ti_award_market_summary(
 p_start_year integer default 2024,
 p_end_year integer default 2026,
 p_group text default '',
 p_agency text default ''
) returns jsonb
language plpgsql stable security invoker
set search_path='pg_catalog','public'
as $fn$
declare result jsonb;
begin
 if p_start_year not between 2000 and 2100
   or p_end_year not between p_start_year and 2100
   or p_end_year-p_start_year>15
   or p_group not in ('','工程','財物','勞務','未分類')
   or char_length(coalesce(p_agency,''))>100
 then raise exception 'invalid price statistics filters' using errcode='22023';end if;
 with scoped as materialized(
  select c.id,c.unit_id,c.job_number,c.title,c.agency,c.group_name,
    c.latest_notice_type,c.latest_notice_date,c.budget_amount,c.award_amount,
    c.official_url,c.source_fetched_at,
    (c.latest_notice_date/10000)::int as yr
  from public.ti_cases c
  where public.ti_case_stage(c.latest_notice_type)='決標'
    and c.latest_notice_date between p_start_year*10000 and p_end_year*10000+1231
    and (p_group='' or c.group_name=p_group)
    and (trim(coalesce(p_agency,''))='' or lower(replace(c.agency,'臺','台')) ilike
      '%'||replace(replace(replace(lower(replace(trim(p_agency),'臺','台')),'!','!!'),'%','!%'),'_','!_')||'%' escape '!')
 ), valid as materialized(
   select *, award_amount/budget_amount as ratio
   from scoped
   where budget_amount>0 and award_amount>0
 ), metrics as (
  select count(*)::integer as n,
    round(percentile_cont(0.25) within group(order by ratio)::numeric,4) as q1,
    round(percentile_cont(0.5) within group(order by ratio)::numeric,4) as median,
    round(percentile_cont(0.75) within group(order by ratio)::numeric,4) as q3
  from valid
 )
 select jsonb_build_object(
  'scope','已入庫案件的最新公告為決標，且金額有實際記錄；不代表全國完整資料',
  'total_awarded',(select count(*) from scoped),
  'sample_n',(select n from metrics),
  'median',case when (select n from metrics)>=5 then (select median from metrics) end,
  'q1',case when (select n from metrics)>=5 then (select q1 from metrics) end,
  'q3',case when (select n from metrics)>=5 then (select q3 from metrics) end,
  'last_source_at',(select max(source_fetched_at) from scoped),
  'years',coalesce((select jsonb_agg(v.obj order by v.yr)
    from (select yr,jsonb_build_object('year',yr,'n',count(*),'budget_sum',sum(budget_amount),
      'award_sum',sum(award_amount)) obj from valid group by yr)v),'[]'::jsonb),
  'samples',coalesce((select jsonb_agg(x.obj order by x.date desc,x.id)
    from (select id,latest_notice_date as date,
      jsonb_build_object('id',id,'unit_id',unit_id,'job_number',job_number,
       'title',title,'agency',agency,'group',group_name,'date',latest_notice_date,
       'budget',budget_amount,'award',award_amount,'ratio',round(ratio,4),'url',official_url) obj
       from valid order by latest_notice_date desc,id limit 30)x),'[]'::jsonb)
 ) into result;
 return result;
end $fn$;
revoke all on function public.ti_award_market_summary(integer,integer,text,text) from public,anon,authenticated;
grant execute on function public.ti_award_market_summary(integer,integer,text,text) to anon,authenticated,service_role;
create index if not exists ti_cases_award_amounts_recent_idx
 on public.ti_cases(latest_notice_date desc,group_name,agency)
 where budget_amount>0 and award_amount>0;
