-- Repair live search indexing for 60k+ source-backed procurement cases.
-- Public callers may SELECT but only the backend may maintain indexes.
-- Prefixless Chinese/English substring queries use pg_trgm GIN; no fake data.

create extension if not exists pg_trgm with schema extensions;
create index if not exists ti_case_search_index_trgm
 on public.ti_case_search_index using gin(searchable extensions.gin_trgm_ops);

CREATE OR REPLACE FUNCTION public.ti_keep_search_index_for_case()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
 insert into public.ti_case_search_index(case_id,searchable,indexed_at)
 select new.id,
   lower(replace(concat_ws(' ',new.title,new.agency,new.job_number,new.category,coalesce(v.vendor_text,'')),'臺','台')),
   now()
 from (select 1) s left join public.ti_case_vendor_search v on v.case_id=new.id
 on conflict(case_id) do update set searchable=excluded.searchable,indexed_at=excluded.indexed_at;
 return new;
end $function$;

drop trigger if exists ti_keep_search_index_case on public.ti_cases;
create trigger ti_keep_search_index_case
 after insert or update of title,agency,job_number,category,source_fetched_at
 on public.ti_cases for each row execute function public.ti_keep_search_index_for_case();

CREATE OR REPLACE FUNCTION public.ti_keep_search_index_for_vendor()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
 insert into public.ti_case_search_index(case_id,searchable,indexed_at)
 select c.id,
   lower(replace(concat_ws(' ',c.title,c.agency,c.job_number,c.category,coalesce(new.vendor_text,'')),'臺','台')),
   now()
 from public.ti_cases c where c.id=new.case_id
 on conflict(case_id) do update set searchable=excluded.searchable,indexed_at=excluded.indexed_at;
 return new;
end $function$;

drop trigger if exists ti_keep_search_index_vendor on public.ti_case_vendor_search;
create trigger ti_keep_search_index_vendor
 after insert or update of vendor_text on public.ti_case_vendor_search
 for each row execute function public.ti_keep_search_index_for_vendor();

revoke all on function public.ti_keep_search_index_for_case() from public,anon,authenticated;
revoke all on function public.ti_keep_search_index_for_vendor() from public,anon,authenticated;

-- Keep the index fully populated from actual case and notice vendor tokens.
insert into public.ti_case_search_index(case_id,searchable,indexed_at)
select c.id,
 lower(replace(concat_ws(' ',c.title,c.agency,c.job_number,c.category,
   coalesce(v.vendor_text,'')),'臺','台')),now()
from public.ti_cases c left join public.ti_case_vendor_search v on v.case_id=c.id
on conflict(case_id) do update
 set searchable=excluded.searchable,indexed_at=excluded.indexed_at;

-- Reconciliation if a trigger or source import was temporarily interrupted.
select cron.schedule('ti_search_index_repair','*/5 * * * *',
 'select public.ti_backfill_missing_case_search(250);');

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
 with matched as materialized (
  select c.id,c.unit_id,c.job_number,c.title,c.agency,c.category,c.group_name,
    c.latest_notice_type,c.latest_notice_date,c.latest_filename,
    c.budget_amount,c.award_amount,c.official_url,c.deadline_at,c.source_fetched_at,
    nullif(d.details->>'location','') as verified_location,
    nullif(d.details->>'tender_method','') as verified_tender_method,
    nullif(d.details->>'decision_method','') as verified_decision_method,
    1::integer as relevance
  from public.ti_case_search_index si
  join public.ti_cases c on c.id=si.case_id
  left join public.ti_case_details d on d.case_id=c.id
  where si.searchable like '%'||needle||'%'
 ),
 sliced as (
  select * from matched order by latest_notice_date desc,id asc
  limit p_limit offset ((p_page-1)*p_limit)
 )
 select jsonb_build_object(
   'total',(select count(*) from matched),
   'page',p_page,'limit',p_limit,
   'rows',coalesce((select jsonb_agg(to_jsonb(s) order by s.latest_notice_date desc,s.id asc) from sliced s),'[]'::jsonb),
   'disclaimer','Results include only successfully ingested dates. Unavailable fields are null, not zero.'
 ) into result;
 return result;
end $function$;

revoke all on function public.ti_archive_search_simple(text,integer,integer) from public;
grant execute on function public.ti_archive_search_simple(text,integer,integer) to anon,authenticated;
