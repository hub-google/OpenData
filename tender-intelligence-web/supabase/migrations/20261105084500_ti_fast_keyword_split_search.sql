-- Speed fix: avoid scanning the long, per-case concatenated vendor
-- index under Supabase's 3-second anonymous statement timeout.
-- Separate short case fields from the indexed notice vendor text, union exact
-- case IDs, and join detailed fields only for the 30-row current page.
-- All records are actual imported public announcements; no synthesized data.
CREATE OR REPLACE FUNCTION public.ti_archive_search_simple(p_term text, p_page integer DEFAULT 1, p_limit integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare result jsonb; needle text;
begin
 if length(trim(coalesce(p_term,''))) not between 2 and 60
 or position('%' in p_term)>0 or position('_' in p_term)>0
 or position(chr(92) in p_term)>0
 or p_page not between 1 and 10000 or p_limit not between 1 and 50
 then raise exception 'invalid fast search keyword' using errcode='22023';end if;
 needle:=lower(replace(trim(p_term),'臺','台'));
 with ids as materialized (
   select c.id from public.ti_cases c
    where lower(replace(concat_ws(' ',c.title,c.agency,c.job_number,c.category),'臺','台')) like '%'||needle||'%'
   union
   select v.case_id from public.ti_case_vendor_search v
    where lower(replace(v.vendor_text,'臺','台')) like '%'||needle||'%'
 ),
 sliced as (
   select c.id,c.unit_id,c.job_number,c.title,c.agency,c.category,c.group_name,
     c.latest_notice_type,c.latest_notice_date,c.latest_filename,
     c.budget_amount,c.award_amount,c.official_url,c.deadline_at,c.source_fetched_at
   from ids i join public.ti_cases c on c.id=i.id
   order by c.latest_notice_date desc,c.id asc
   limit p_limit offset ((p_page-1)*p_limit)
 ),
 enriched as (
   select s.*,nullif(d.details->>'location','') as verified_location,
     nullif(d.details->>'tender_method','') as verified_tender_method,
     nullif(d.details->>'decision_method','') as verified_decision_method,
     1::integer as relevance
   from sliced s left join public.ti_case_details d on d.case_id=s.id
 )
 select jsonb_build_object(
   'total',(select count(*) from ids),
   'page',p_page,'limit',p_limit,
   'rows',coalesce((select jsonb_agg(to_jsonb(s) order by s.latest_notice_date desc,s.id asc) from enriched s),'[]'::jsonb),
   'disclaimer','Results include only successfully ingested dates. Unavailable fields are null, not zero.'
 ) into result;
 return result;
end $function$;
revoke all on function public.ti_archive_search_simple(text,integer,integer) from public;
grant execute on function public.ti_archive_search_simple(text,integer,integer) to anon,authenticated;
