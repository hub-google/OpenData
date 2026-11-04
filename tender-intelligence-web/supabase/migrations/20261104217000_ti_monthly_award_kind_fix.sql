-- Prevent a 無法決標 (no award) announcement from counting as an award.
create or replace function public.ti_agency_monthly_report(
 p_unit_id text,p_year integer default null
) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;yr integer;
begin
 if length(p_unit_id)<1 or length(p_unit_id)>80 then
  raise exception 'Invalid agency unit ID' using errcode='22023';end if;
 yr:=coalesce(p_year,extract(year from now() at time zone 'Asia/Taipei')::integer);
 if yr<1999 or yr>2100 then raise exception 'Invalid calendar year' using errcode='22023';end if;
 with base as (
  select n.id,n.case_id,n.source_date,n.filename,n.notice_type,
   n.budget_amount,n.award_amount,
   ((n.source_date/100)%100)::integer as month,
   row_number() over(partition by n.case_id,n.source_date/100
     order by n.source_date desc,n.filename desc,n.id desc) rn
  from public.ti_notices n join public.ti_cases c on c.id=n.case_id
  where c.unit_id=p_unit_id and n.source_date/10000=yr
 ), grouped as (
  select month,count(*) as notice_count,count(distinct case_id) as case_count,
   count(*) filter(where rn=1 and notice_type like '%決標%' and notice_type not like '%無法決標%') as case_award_notice_count,
   count(*) filter(where rn=1 and budget_amount>0) as budget_sample_count,
   count(*) filter(where rn=1 and award_amount>0) as award_sample_count,
   coalesce(sum(budget_amount) filter(where rn=1 and budget_amount>0),0) as known_budget_sum,
   coalesce(sum(award_amount) filter(where rn=1 and award_amount>0),0) as known_award_sum
  from base group by month
 )
 select jsonb_build_object('unit_id',p_unit_id,'year',yr,
   'months',coalesce((select jsonb_agg(to_jsonb(x) order by x.month) from grouped x),'[]'::jsonb),
   'notice_total',(select count(*) from base),
   'caveat','Only archived OpenFun source notices. Each case is counted once per month for money totals; missing amounts excluded. An unlisted month does NOT prove zero official procurement.'
 ) into result;
 return result;
end $$;
