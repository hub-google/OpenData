-- PRD F02/F05: real-time searchable index for 70k+ archived cases.
-- Keeps real official-source vendor/agency/case terms and fixes 5-second timeout.
create extension if not exists pg_trgm with schema extensions;
create index if not exists ti_case_search_trgm_gin
 on public.ti_case_search_index using gin (searchable extensions.gin_trgm_ops);

create or replace function public.ti_archive_search_simple(
 p_term text,p_page integer default 1,p_limit integer default 30
) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb; needle text;
begin
 if length(trim(coalesce(p_term,''))) not between 2 and 60
 or position('%' in p_term)>0 or position('_' in p_term)>0
 or position(chr(92) in p_term)>0
 or p_page not between 1 and 10000 or p_limit not between 1 and 50
 then raise exception 'invalid fast search keyword' using errcode='22023';end if;
 needle:=lower(replace(trim(p_term),'臺','台'));
 with ids as materialized(
  select si.case_id as id
  from public.ti_case_search_index si
  where si.searchable like '%'||needle||'%'
 ), sliced as (
  select c.id,c.unit_id,c.job_number,c.title,c.agency,c.category,c.group_name,
   c.latest_notice_type,c.latest_notice_date,c.latest_filename,
   c.budget_amount,c.award_amount,c.official_url,c.deadline_at,c.source_fetched_at
  from ids i join public.ti_cases c on c.id=i.id
  order by c.latest_notice_date desc,c.id asc
  limit p_limit offset((p_page-1)*p_limit)
 ), enriched as (
  select s.*,nullif(d.details->>'location','') as verified_location,
   nullif(d.details->>'tender_method','') as verified_tender_method,
   nullif(d.details->>'decision_method','') as verified_decision_method,
   1::integer as relevance
  from sliced s left join public.ti_case_details d on d.case_id=s.id
 )
 select jsonb_build_object('total',(select count(*) from ids),
  'page',p_page,'limit',p_limit,
  'rows',coalesce((select jsonb_agg(to_jsonb(s) order by s.latest_notice_date desc,s.id asc) from enriched s),'[]'::jsonb),
  'disclaimer','Results include only successfully ingested dates. Unavailable fields are null, not zero.')
 into result;
 return result;
end $$;
revoke all on function public.ti_archive_search_simple(text,integer,integer) from public;
grant execute on function public.ti_archive_search_simple(text,integer,integer) to anon,authenticated;
