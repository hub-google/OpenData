-- PRD V4: extend evidence-only price sample strata to decision method and budget scale.
-- Unknown decision method excluded only when user specifically requests one.
create or replace function public.ti_award_samples_v2(
 p_group text default '',p_agency text default '',p_year integer default null,
 p_method text default '',p_min_budget numeric default null,p_max_budget numeric default null,
 p_limit integer default 30
) returns jsonb language plpgsql stable security invoker set search_path='' as $$
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
end $$;
revoke all on function public.ti_award_samples_v2(text,text,integer,text,numeric,numeric,integer) from public;
grant execute on function public.ti_award_samples_v2(text,text,integer,text,numeric,numeric,integer) to anon,authenticated;
