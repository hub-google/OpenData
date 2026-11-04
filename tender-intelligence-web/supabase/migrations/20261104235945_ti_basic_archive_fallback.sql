-- Exact-field source-cache fallback for basic public procurement queries.
-- Only records already ingested from official notices; no fabricated data.
-- Preserve the four distinct search semantics and public read-only RLS.
CREATE OR REPLACE FUNCTION public.ti_basic_archive_search(p_mode text, p_query text, p_page integer DEFAULT 1, p_limit integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare result jsonb;
begin
 if p_mode not in ('title','agency','vendor','companyId')
  or length(trim(coalesce(p_query,'')))=0 or length(p_query)>120
  or p_page not between 1 and 10000 or p_limit not between 1 and 100
  or (p_mode='companyId' and p_query !~ '^[0-9]{8}$')
 then raise exception 'invalid basic search parameters' using errcode='22023';end if;
 with matched as (
   select c.id,c.unit_id,c.job_number,c.title,c.agency,c.category,
    c.latest_notice_type,c.latest_notice_date,c.latest_filename,
    c.budget_amount,c.award_amount
   from public.ti_cases c
   left join public.ti_case_vendor_search v on v.case_id=c.id
   where case
    when p_mode='title' then position(lower(replace(trim(p_query),'臺','台'))
      in lower(replace(coalesce(c.title,''),'臺','台')))>0
    when p_mode='agency' then position(lower(replace(trim(p_query),'臺','台'))
      in lower(replace(coalesce(c.agency,'')||' '||c.unit_id,'臺','台')))>0
    when p_mode='vendor' then position(lower(replace(trim(p_query),'臺','台'))
      in lower(replace(coalesce(v.vendor_text,''),'臺','台')))>0
    when p_mode='companyId' then position(trim(p_query) in coalesce(v.vendor_text,''))>0
    else false end
 ),
 sliced as (
   select * from matched order by latest_notice_date desc,id asc
   limit p_limit offset ((p_page-1)*p_limit)
 )
 select jsonb_build_object(
  'records',coalesce((select jsonb_agg(jsonb_build_object(
   'unit_id',s.unit_id,'job_number',s.job_number,'unit_name',s.agency,
   'date',s.latest_notice_date,'filename',coalesce(s.latest_filename,'db-cached'),
   'budget_amount',s.budget_amount,'award_amount',s.award_amount,
   'brief',jsonb_build_object('title',s.title,'type',s.latest_notice_type,
     'category',s.category)
  )) from sliced s),'[]'::jsonb),
  'total_records',(select count(*) from matched),
  'total_pages',greatest(1,ceil((select count(*) from matched)::numeric/p_limit)::integer),
  'source','database'
 ) into result;
 return result;
end $function$;
revoke all on function public.ti_basic_archive_search(text,text,integer,integer) from public;
grant execute on function public.ti_basic_archive_search(text,text,integer,integer) to anon,authenticated;
