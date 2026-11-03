-- F14: evidence-only failed bid / deadline / possible matching procurement search.
-- Current latest notice type is not a legal determination that a contract is reopened.
create or replace function public.ti_issue_search(
 p_mode text default 'failed', p_keyword text default '',
 p_page integer default 1, p_limit integer default 20
) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare output jsonb;
begin
 if p_mode not in ('failed','closing','undated') or p_page<1 or p_page>200
    or p_limit<1 or p_limit>30 or length(p_keyword)>80
 then raise exception 'invalid issue search parameters' using errcode='22023';end if;
 with matching as (
  select c.id,c.unit_id,c.job_number,c.title,c.agency,c.category,c.group_name,
         c.latest_notice_type,c.latest_notice_date,c.deadline_at,
         c.budget_amount,c.official_url,c.latest_filename
  from public.ti_cases c
  where (p_keyword='' or position(lower(replace(p_keyword,'臺','台'))
      in lower(replace(coalesce(c.title,'')||' '||coalesce(c.agency,'')||' '||c.job_number,'臺','台')))>0)
    and (
      (p_mode='failed' and c.latest_notice_type like '%無法決標%')
      or
      (p_mode='closing' and c.deadline_at>now()
       and c.deadline_at<=now()+interval '7 days'
       and (c.latest_notice_type like '%招標%' or c.latest_notice_type like '%取得報價%' or c.latest_notice_type like '%取得企劃書%')
       and c.latest_notice_type not like '%決標%')
      or
      (p_mode='undated' and c.deadline_at is null
       and (c.latest_notice_type like '%招標%' or c.latest_notice_type like '%取得報價%' or c.latest_notice_type like '%取得企劃書%')
       and c.latest_notice_type not like '%決標%')
    )
 ), counted as (select count(*) as n from matching),
 chosen as (
  select * from matching
  order by case when p_mode='closing' then deadline_at end asc nulls last,
           latest_notice_date desc,id asc
  limit p_limit offset (p_page-1)*p_limit
 )
 select jsonb_build_object('total',(select n from counted),'page',p_page,'limit',p_limit,
  'rows',coalesce((select jsonb_agg(to_jsonb(chosen)) from chosen),'[]'::jsonb))
 into output;
 return output;
end $$;
revoke all on function public.ti_issue_search(text,text,integer,integer) from public;
grant execute on function public.ti_issue_search(text,text,integer,integer) to anon,authenticated;

-- Candidate notice history for ONE exact case; never claim a rebid is confirmed.
create or replace function public.ti_possible_rebids(p_case_id text)
returns jsonb language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(x) order by x.latest_notice_date desc),'[]'::jsonb)
 from (
  select c.id,c.unit_id,c.job_number,c.title,c.agency,c.latest_notice_date,c.latest_notice_type
  from public.ti_cases base
  join public.ti_cases c on c.unit_id=base.unit_id and c.id<>base.id
  where base.id=p_case_id and length(p_case_id)<=190
    and length(trim(base.title))>=6
    and lower(replace(trim(c.title),'臺','台'))=lower(replace(trim(base.title),'臺','台'))
  order by c.latest_notice_date desc,c.id
  limit 10
 ) x
$$;
revoke all on function public.ti_possible_rebids(text) from public;
grant execute on function public.ti_possible_rebids(text) to anon,authenticated;
