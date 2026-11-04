-- PRD V2: agency monthly purchase evidence and repeated-name case history, not forecasts.
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
   count(*) filter(where rn=1 and notice_type like '%決標%') as case_award_notice_count,
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
revoke all on function public.ti_agency_monthly_report(text,integer) from public;
grant execute on function public.ti_agency_monthly_report(text,integer) to anon,authenticated;

create or replace function public.ti_agency_repeat_evidence(
 p_unit_id text,p_limit integer default 12
) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
 if length(p_unit_id)<1 or length(p_unit_id)>80 or p_limit<1 or p_limit>20
 then raise exception 'Invalid repeat evidence filter' using errcode='22023';end if;
 with entries as (
  select c.id,c.title,c.job_number,c.latest_notice_date,c.official_url,
   regexp_replace(lower(replace(trim(c.title),'臺','台')),
     '[[:space:]（）()《》「」【】–—-]+','','g') as norm,
   d.details->>'period' as reported_period
  from public.ti_cases c
  left join public.ti_case_details d on d.case_id=c.id
  where c.unit_id=p_unit_id and c.latest_notice_date between 19990101 and 21001231
 ), distinct_titles as (
  select e.norm,count(distinct e.id) as related_cases,
   min(e.latest_notice_date) as earliest_notice,max(e.latest_notice_date) as latest_notice,
   min(e.title) as display_title
  from entries e
  where char_length(e.norm)>=8 group by e.norm
  having count(distinct e.id)>=2
 ), chosen as (
  select * from distinct_titles
  order by latest_notice desc,related_cases desc,norm limit p_limit
 )
 select jsonb_build_object('unit_id',p_unit_id,
  'groups',coalesce((
   select jsonb_agg(jsonb_build_object(
     'title',c.display_title,'case_count',c.related_cases,'earliest_date',c.earliest_notice,
     'latest_date',c.latest_notice,'evidence',(
       select jsonb_agg(jsonb_build_object(
        'case_id',e.id,'job_number',e.job_number,'title',e.title,
        'date',e.latest_notice_date,'official_url',e.official_url,
        'contract_period_source_text',e.reported_period)
       order by e.latest_notice_date,e.id)
       from entries e where e.norm=c.norm
     )) order by c.latest_notice desc)
   from chosen c),'[]'::jsonb),
  'warning','Same agency and normalized title only: not proof of a recurring contract, a future purchase or legal renewal. Missing contract term/renewal options remain unknown.'
 ) into result;
 return result;
end $$;
revoke all on function public.ti_agency_repeat_evidence(text,integer) from public;
grant execute on function public.ti_agency_repeat_evidence(text,integer) to anon,authenticated;
