-- Upgrade the existing price drilldown, do NOT replace the public UI.
CREATE OR REPLACE FUNCTION public.ti_award_samples_v2(p_group text DEFAULT ''::text, p_agency text DEFAULT ''::text, p_year integer DEFAULT NULL::integer, p_method text DEFAULT ''::text, p_min_budget numeric DEFAULT NULL::numeric, p_max_budget numeric DEFAULT NULL::numeric, p_limit integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare out jsonb;
begin
 if (p_group<>'' and p_group not in ('工程','財物','勞務','未分類'))
 or length(p_agency)>80 or length(p_method)>80
 or (p_year is not null and (p_year<1999 or p_year>2100))
 or (p_min_budget is not null and p_min_budget<0)
 or (p_max_budget is not null and p_max_budget<0)
 or (p_min_budget is not null and p_max_budget is not null and p_min_budget>p_max_budget)
 or p_limit<1 or p_limit>50
 then raise exception 'Invalid price sample filter' using errcode='22023';end if;
 with valid as (
  select c.id,c.unit_id,c.job_number,c.title,c.agency,c.group_name,
   c.latest_notice_date,c.budget_amount,c.award_amount,
   (c.award_amount/c.budget_amount)::numeric as ratio,
   nullif(d.details->>'decision_method','') as decision_method,
   nullif(d.details->>'period','') as contract_period_source
  from public.ti_cases c
  left join public.ti_case_details d on d.case_id=c.id
  where c.budget_amount>0 and c.award_amount>0
    and public.ti_case_stage(c.latest_notice_type)='決標'
    and (p_group='' or c.group_name=p_group)
    and (p_year is null or c.latest_notice_date/10000=p_year)
    and (p_agency='' or position(lower(replace(p_agency,'臺','台'))
      in lower(replace(coalesce(c.agency,''),'臺','台')))>0)
    and (p_method='' or (nullif(d.details->>'decision_method','') is not null
      and position(lower(replace(p_method,'臺','台'))
        in lower(replace(d.details->>'decision_method','臺','台')))>0))
    and (p_min_budget is null or c.budget_amount>=p_min_budget)
    and (p_max_budget is null or c.budget_amount<=p_max_budget)
 ), stats as (
  select count(*) n,
   count(*) filter(where decision_method is null) method_unknown,
   count(*) filter(where contract_period_source is null) period_unknown,
   min(ratio) min_ratio,max(ratio) max_ratio,
   percentile_cont(.25) within group(order by ratio)::numeric q1,
   percentile_cont(.5) within group(order by ratio)::numeric median,
   percentile_cont(.75) within group(order by ratio)::numeric q3
  from valid
 ), chosen as (
  select * from valid order by latest_notice_date desc,id limit p_limit
 )
 select jsonb_build_object('count',s.n,
  'method_unknown_count',s.method_unknown,'contract_period_unknown_count',s.period_unknown,
  'median_ratio',s.median,'q1_ratio',s.q1,'q3_ratio',s.q3,
  'min_ratio',s.min_ratio,'max_ratio',s.max_ratio,
  'rows',coalesce((select jsonb_agg(to_jsonb(c)) from chosen c),'[]'::jsonb),
  'warning','Only cases with positive published budgets and award amounts. Not corrected for specifications, quantities, multi-award, single-price procurement or contract duration. Never a recommended price.'
 ) into out from stats s;
 return out;
end $function$
;

-- Add source-backed per-year price quantiles to the existing database summary.
CREATE OR REPLACE FUNCTION public.ti_award_market_summary(p_start_year integer DEFAULT 2024, p_end_year integer DEFAULT 2026, p_group text DEFAULT ''::text, p_agency text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
      'award_sum',sum(award_amount),
      'median_ratio',round(percentile_cont(0.5) within group(order by ratio)::numeric,4),
      'q1_ratio',round(percentile_cont(0.25) within group(order by ratio)::numeric,4),
      'q3_ratio',round(percentile_cont(0.75) within group(order by ratio)::numeric,4)) obj from valid group by yr)v),'[]'::jsonb),
  'samples',coalesce((select jsonb_agg(x.obj order by x.date desc,x.id)
    from (select id,latest_notice_date as date,
      jsonb_build_object('id',id,'unit_id',unit_id,'job_number',job_number,
       'title',title,'agency',agency,'group',group_name,'date',latest_notice_date,
       'budget',budget_amount,'award',award_amount,'ratio',round(ratio,4),'url',official_url) obj
       from valid order by latest_notice_date desc,id limit 30)x),'[]'::jsonb)
 ) into result;
 return result;
end $function$
;