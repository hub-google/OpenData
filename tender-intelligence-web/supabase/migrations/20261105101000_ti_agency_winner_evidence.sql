-- PRD V2: agency awardee concentration from explicitly named WINNERS in actual notices.
-- Distinct case/company, no inferred bidder win-rate or allocated multi-winner money.
create or replace function public.ti_agency_winner_evidence(
 p_unit_id text,p_year integer default null,p_limit integer default 12
) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;yr integer;
begin
 if length(trim(coalesce(p_unit_id,''))) not between 1 and 80
   or (p_year is not null and p_year not between 1999 and 2100)
   or p_limit not between 1 and 30
 then raise exception 'Invalid agency winner evidence parameters' using errcode='22023';end if;
 yr:=p_year;
 with candidates as(
  select n.id as notice_id,n.case_id,n.source_date,n.notice_type,
   n.company_role_keys,n.company_ids,n.company_names
  from public.ti_notices n join public.ti_cases c on c.id=n.case_id
  where c.unit_id=p_unit_id
    and (yr is null or n.source_date/10000=yr)
    and n.notice_type like '%決標%' and n.notice_type not like '%無法決標%'
 ), named as(
  select n.*,coalesce(nullif(trim(v.company_name),''),'') as company_name,
   nullif(trim(n.company_ids[v.idx::integer]),'') as company_id
  from candidates n
  cross join lateral unnest(n.company_names) with ordinality v(company_name,idx)
 ), verified as(
  select n.case_id,n.source_date,n.company_name,n.company_id,n.notice_id,
   row_number() over(partition by n.case_id,n.company_name,coalesce(n.company_id,'')
     order by n.source_date desc,n.notice_id desc) as duplicate_index
  from named n where n.company_name<>''
    and exists(
     select 1 from jsonb_array_elements_text(
      case when jsonb_typeof(n.company_role_keys->n.company_name)='array'
       then n.company_role_keys->n.company_name else '[]'::jsonb end
     ) role
     where role like '%:得標廠商%' and role not like '%:未得標廠商%'
    )
 ), counted as(
  select company_name,company_id,count(*) as awarded_case_count,
   min(source_date) first_announcement,max(source_date) last_announcement
  from verified where duplicate_index=1
  group by company_name,company_id
 ), ranked as(
  select *,row_number() over(order by awarded_case_count desc,last_announcement desc,company_name) rank
  from counted
 ), summary as(
  select count(distinct case_id) awarded_cases_with_named_winner,
   count(*) winner_case_evidence_count
  from verified where duplicate_index=1
 )
 select jsonb_build_object('unit_id',p_unit_id,'year',yr,
  'unique_awarded_cases',(select awarded_cases_with_named_winner from summary),
  'winner_case_appearances',(select winner_case_evidence_count from summary),
  'top5_evidence_share',(
   select case when s.winner_case_evidence_count=0 then null
     else round((select coalesce(sum(r.awarded_case_count),0) from ranked r where r.rank<=5)::numeric/
       s.winner_case_evidence_count,4) end from summary s),
  'winners',coalesce((
   select jsonb_agg(jsonb_build_object('rank',r.rank,'company_name',r.company_name,
     'company_id',r.company_id,'awarded_case_count',r.awarded_case_count,
     'first_date',r.first_announcement,'last_date',r.last_announcement)
      order by r.rank)
   from ranked r where r.rank<=p_limit),'[]'::jsonb),
  'warning','Verified winner-name evidence in archived official award notices only; deduplicated by case and named winner. Counts are not total bids, exact number of contracts, amounts or market share. Multi-winner cases add multiple appearances.'
 ) into result;
 return result;
end $$;
revoke all on function public.ti_agency_winner_evidence(text,integer,integer) from public;
grant execute on function public.ti_agency_winner_evidence(text,integer,integer) to anon,authenticated;
