-- F12/F13: verifiable procurement vendor IDs and small sample price ratios.
-- An alias is only displayed when the SAME notice contains exactly one company name and one company ID.
create or replace function public.ti_vendor_evidence(p_tax_id text)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare out jsonb;
begin
 if p_tax_id !~ '^[0-9]{8}$' then raise exception '8-digit company ID required' using errcode='22023';end if;
 with matching as (
  select n.case_id,n.source_date,n.notice_type,n.company_names,n.company_ids
  from public.ti_notices n where p_tax_id=any(n.company_ids)
 ), aliases as (
  select trim(company_names[1]) as name,count(*) as notices,
         min(source_date) as first_date,max(source_date) as last_date
  from matching
  where array_length(company_ids,1)=1 and company_ids[1]=p_tax_id
    and array_length(company_names,1)=1 and length(trim(company_names[1]))>0
  group by trim(company_names[1])
  order by notices desc,name
  limit 20
 ), samples as (
  select m.case_id,c.title,c.unit_id,c.job_number,c.agency,
         m.source_date,m.notice_type
  from matching m join public.ti_cases c on c.id=m.case_id
  order by m.source_date desc,m.case_id
  limit 20
 )
 select jsonb_build_object(
  'company_id',p_tax_id,'notice_count',(select count(*) from matching),
  'case_count',(select count(distinct case_id) from matching),
  'single_company_evidence_names',coalesce((select jsonb_agg(to_jsonb(a)) from aliases a),'[]'::jsonb),
  'sample_notices',coalesce((select jsonb_agg(to_jsonb(s)) from samples s),'[]'::jsonb),
  'warning','Company names are associated only when a notice has exactly one name and one ID; other notices are not sufficient to certify aliases or legal company status.'
 ) into out;
 return out;
end $$;
revoke all on function public.ti_vendor_evidence(text) from public;
grant execute on function public.ti_vendor_evidence(text) to anon,authenticated;

create or replace function public.ti_award_samples(
 p_group text default '',p_agency text default '',p_year integer default null,
 p_limit integer default 30
) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare out jsonb;
begin
 if (p_group<>'' and p_group not in ('工程','財物','勞務','未分類'))
 or length(p_agency)>80 or (p_year is not null and (p_year<1999 or p_year>2100))
 or p_limit<1 or p_limit>50
 then raise exception 'invalid price sample filters' using errcode='22023';end if;
 with valid as (
  select c.id,c.unit_id,c.job_number,c.title,c.agency,c.group_name,
       c.latest_notice_date,c.budget_amount,c.award_amount,
       (c.award_amount/c.budget_amount)::numeric as ratio,
       coalesce(d.details->>'decision_method','') as decision_method
  from public.ti_cases c
  left join public.ti_case_details d on d.case_id=c.id
  where c.budget_amount>0 and c.award_amount>0
    and (p_group='' or c.group_name=p_group)
    and (p_year is null or c.latest_notice_date/10000=p_year)
    and (p_agency='' or position(lower(replace(p_agency,'臺','台')) in lower(replace(coalesce(c.agency,''),'臺','台')))>0)
 ), stats as (
  select count(*) n,min(ratio) min_ratio,max(ratio) max_ratio,
   percentile_cont(0.25) within group(order by ratio)::numeric q1,
   percentile_cont(0.5) within group(order by ratio)::numeric median,
   percentile_cont(0.75) within group(order by ratio)::numeric q3
  from valid
 ), chosen as (
  select * from valid order by latest_notice_date desc,id limit p_limit
 )
 select jsonb_build_object(
  'count',s.n,'median_ratio',s.median,'q1_ratio',s.q1,'q3_ratio',s.q3,
  'min_ratio',s.min_ratio,'max_ratio',s.max_ratio,
  'rows',coalesce((select jsonb_agg(to_jsonb(c)) from chosen c),'[]'::jsonb),
  'warning','Only notices with two positive amounts, no adjustment for item specifications, quantities, multi-award or contract term; no price recommendations.'
 ) into out from stats s;
 return out;
end $$;
revoke all on function public.ti_award_samples(text,text,integer,integer) from public;
grant execute on function public.ti_award_samples(text,text,integer,integer) to anon,authenticated;
