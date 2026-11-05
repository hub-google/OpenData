-- PRD F02/F05: avoid 5-second timeout on vendor/company/basic searches.
-- Separate mode-specific indexable branches instead of LEFT JOIN + CASE for 80k cases.
create index if not exists ti_vendor_text_trgm on public.ti_case_vendor_search
 using gin ((lower(replace(vendor_text,'臺','台'))) extensions.gin_trgm_ops);
create index if not exists ti_case_title_trgm on public.ti_cases
 using gin ((lower(replace(title,'臺','台'))) extensions.gin_trgm_ops);
create index if not exists ti_case_agency_trgm on public.ti_cases
 using gin ((lower(replace(coalesce(agency,'')||' '||unit_id,'臺','台'))) extensions.gin_trgm_ops);

create or replace function public.ti_basic_archive_search(
 p_mode text,p_query text,p_page integer default 1,p_limit integer default 100
) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;needle text;
begin
 if p_mode not in ('title','agency','vendor','companyId')
  or length(trim(coalesce(p_query,'')))=0 or length(p_query)>120
  or p_page not between 1 and 10000 or p_limit not between 1 and 100
  or (p_mode='companyId' and p_query !~ '^[0-9]{8}$')
 then raise exception 'invalid basic search parameters' using errcode='22023';end if;
 needle:=lower(replace(trim(p_query),'臺','台'));
 -- Escaped LIKE is intentional: user keywords are literal, never wildcards.
 needle:=replace(replace(replace(needle,'!','!!'),'%','!%'),'_','!_');
 with ids as materialized(
  select c.id from public.ti_cases c
   where p_mode='title' and lower(replace(c.title,'臺','台')) like '%'||needle||'%' escape '!'
  union all
  select c.id from public.ti_cases c
   where p_mode='agency' and lower(replace(coalesce(c.agency,'')||' '||c.unit_id,'臺','台'))
    like '%'||needle||'%' escape '!'
  union all
  select v.case_id from public.ti_case_vendor_search v
   where p_mode='vendor' and lower(replace(v.vendor_text,'臺','台'))
    like '%'||needle||'%' escape '!'
  union all
  select v.case_id from public.ti_case_vendor_search v
   where p_mode='companyId' and v.vendor_text like '%'||needle||'%' escape '!'
 ), sliced as(
  select c.id,c.unit_id,c.job_number,c.title,c.agency,c.category,
   c.latest_notice_type,c.latest_notice_date,c.latest_filename,
   c.budget_amount,c.award_amount
  from ids i join public.ti_cases c on c.id=i.id
  order by c.latest_notice_date desc,c.id asc
  limit p_limit offset ((p_page-1)*p_limit)
 )
 select jsonb_build_object(
  'records',coalesce((select jsonb_agg(jsonb_build_object(
    'unit_id',s.unit_id,'job_number',s.job_number,'unit_name',s.agency,
    'date',s.latest_notice_date,'filename',coalesce(s.latest_filename,'db-cached'),
    'budget_amount',s.budget_amount,'award_amount',s.award_amount,
    'brief',jsonb_build_object('title',s.title,'type',s.latest_notice_type,
      'category',s.category)) order by s.latest_notice_date desc,s.id asc)
    from sliced s),'[]'::jsonb),
  'total_records',(select count(*) from ids),
  'total_pages',greatest(1,ceil((select count(*) from ids)::numeric/p_limit)::integer),
  'source','database')
 into result;
 return result;
end $$;
revoke all on function public.ti_basic_archive_search(text,text,integer,integer) from public;
grant execute on function public.ti_basic_archive_search(text,text,integer,integer) to anon,authenticated;
