-- Full, unfiltered public case archive. Reuses the existing chronological
-- B-tree index instead of scanning all historical notice payloads on first visit.
create or replace function public.ti_archive_search_recent(
 p_page integer default 1,p_limit integer default 30
) returns jsonb language plpgsql stable security invoker
set search_path=pg_catalog,public as $$
declare answer jsonb;
begin
 if coalesce(p_page,0) not between 1 and 10000 or coalesce(p_limit,0) not between 1 and 50
 then raise exception 'invalid archive page or size' using errcode='22023';end if;
 with current_page as materialized (
  select c.id,c.unit_id,c.job_number,c.title,c.agency,c.category,
    c.group_name,c.latest_notice_type,c.latest_notice_date,c.latest_filename,
    c.budget_amount,c.award_amount,c.official_url,c.deadline_at,c.source_fetched_at
  from public.ti_cases c
  order by c.latest_notice_date desc,c.id asc
  limit p_limit offset (p_page-1)*p_limit
 ), enriched as (
  select s.*,nullif(d.details->>'location','') as verified_location,
    nullif(d.details->>'tender_method','') as verified_tender_method,
    nullif(d.details->>'decision_method','') as verified_decision_method,
    1::integer as relevance
  from current_page s left join public.ti_case_details d on d.case_id=s.id
 )
 select jsonb_build_object(
  'total',(select count(*) from public.ti_cases),
  'page',p_page,'limit',p_limit,
  'rows',coalesce((select jsonb_agg(to_jsonb(x) order by x.latest_notice_date desc,x.id asc) from enriched x),'[]'::jsonb),
  'disclaimer','Real stored public cases only. Unknown fields are null and missing source dates are not counted.'
 ) into answer;
 return answer;
end;
$$;
revoke all on function public.ti_archive_search_recent(integer,integer) from public;
grant execute on function public.ti_archive_search_recent(integer,integer) to anon,authenticated;