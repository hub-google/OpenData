-- PRD V2: agency yearly/monthly procurement statistics by official category,
-- plus source-known award amount median/average without replacing null with zero.
create or replace function public.ti_agency_monthly_report_v2(
 p_unit_id text,p_year integer default null,p_group text default ''
) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;yr integer;
begin
 if length(trim(coalesce(p_unit_id,''))) not between 1 and 80
  or p_group not in ('','工程','財物','勞務','未分類')
 then raise exception 'Invalid agency filters' using errcode='22023';end if;
 yr:=coalesce(p_year,extract(year from now() at time zone 'Asia/Taipei')::integer);
 if yr<1999 or yr>2100 then raise exception 'Invalid year' using errcode='22023';end if;
 with b as (
   select n.id,n.case_id,n.source_date,n.filename,n.notice_type,
    coalesce(n.budget_amount,c.budget_amount) budget_amount,
    coalesce(n.award_amount,c.award_amount) award_amount,
    (n.source_date/100)%100 as month,
    row_number() over(partition by n.case_id,n.source_date/100
      order by n.source_date desc,n.filename desc,n.id desc) as rn
   from public.ti_notices n join public.ti_cases c on c.id=n.case_id
   where c.unit_id=p_unit_id and n.source_date/10000=yr
    and (p_group='' or c.group_name=p_group)
 ), g as (
  select month,count(*) notice_count,count(distinct case_id) case_count,
   count(*) filter(where rn=1 and notice_type like '%決標%' and notice_type not like '%無法決標%') award_notice_count,
   count(*) filter(where rn=1 and budget_amount>0) budget_sample_count,
   count(*) filter(where rn=1 and award_amount>0) award_sample_count,
   sum(budget_amount) filter(where rn=1 and budget_amount>0) known_budget_sum,
   sum(award_amount) filter(where rn=1 and award_amount>0) known_award_sum,
   avg(award_amount) filter(where rn=1 and award_amount>0) known_award_mean,
   percentile_cont(.5) within group(order by case when rn=1 and award_amount>0 then award_amount end) known_award_median
  from b group by month
 )
 select jsonb_build_object('unit_id',p_unit_id,'year',yr,'group',p_group,
  'notice_total',(select count(*) from b),
  'months',coalesce((select jsonb_agg(to_jsonb(x) order by x.month) from g x),'[]'::jsonb),
  'caveat','Only source-archived announcements. Award means, medians, totals and samples use positive known amounts, once per case per month. A case may appear in multiple months; do not add monthly totals as unique contracts. Unlisted months are unknown, not zero.')
 into result;
 return result;
end $$;
revoke all on function public.ti_agency_monthly_report_v2(text,integer,text) from public;
grant execute on function public.ti_agency_monthly_report_v2(text,integer,text) to anon,authenticated;
