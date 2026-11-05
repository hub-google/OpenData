-- Fast source-backed full-database homepage search with real global filters.
-- Uses the same ti_case_search_index as the advanced search single-term fast path.
create or replace function public.ti_fast_archive_filtered(
 p_term text,p_kind text default '',p_group text default '',
 p_min_budget numeric default null,p_sort text default 'date',
 p_page integer default 1,p_limit integer default 30
) returns jsonb language plpgsql stable security invoker
set search_path=pg_catalog,public
as $$
declare result jsonb;needle text;
begin
 if length(trim(coalesce(p_term,''))) not between 2 and 60
    or position('%' in p_term)>0 or position('_' in p_term)>0
    or position(chr(92) in p_term)>0
    or p_page not between 1 and 10000 or p_limit not between 1 and 50
    or p_sort not in ('date','budget','title')
    or coalesce(p_group,'') not in ('','工程','財物','勞務','未分類')
    or coalesce(p_kind,'') not in ('','招標','決標','更正','無法決標','公開閱覽','公開徵求','財物變賣')
    or (p_min_budget is not null and p_min_budget<0)
 then raise exception 'invalid fast filtered search' using errcode='22023';end if;
 needle:=lower(replace(trim(p_term),'臺','台'));
 with matched as materialized (
  select c.id,c.unit_id,c.job_number,c.title,c.agency,c.category,c.group_name,
   c.latest_notice_type,c.latest_notice_date,c.latest_filename,
   c.budget_amount,c.award_amount,c.official_url,c.deadline_at,c.source_fetched_at
  from public.ti_case_search_index si
  join public.ti_cases c on c.id=si.case_id
  where si.searchable like '%'||needle||'%'
    and (coalesce(p_group,'')='' or c.group_name=p_group)
    and (p_min_budget is null or c.budget_amount>=p_min_budget)
    and (
      coalesce(p_kind,'')=''
      or (p_kind='招標' and c.latest_notice_type ~ '(招標|取得報價單)' and c.latest_notice_type !~ '決標')
      or (p_kind='決標' and c.latest_notice_type like '%決標%' and c.latest_notice_type not like '%無法決標%')
      or (p_kind='更正' and c.latest_notice_type like '%更正%')
      or (p_kind='無法決標' and c.latest_notice_type like '%無法決標%')
      or (p_kind='公開閱覽' and c.latest_notice_type like '%公開閱覽%')
      or (p_kind='公開徵求' and c.latest_notice_type like '%公開徵求%')
      or (p_kind='財物變賣' and c.latest_notice_type like '%財物變賣%')
    )
 ), selected as (
  select *
  from matched
  order by
    case when p_sort='budget' then budget_amount end desc nulls last,
    case when p_sort='title' then title end asc nulls last,
    case when p_sort='date' then latest_notice_date end desc nulls last,
    latest_notice_date desc,id asc
  limit p_limit offset((p_page-1)*p_limit)
 ), enriched as (
  select s.*,nullif(d.details->>'location','') as verified_location,
    nullif(d.details->>'tender_method','') as verified_tender_method,
    nullif(d.details->>'decision_method','') as verified_decision_method,
    1::integer as relevance
  from selected s left join public.ti_case_details d on d.case_id=s.id
 )
 select jsonb_build_object(
  'total',(select count(*) from matched),
  'page',p_page,'limit',p_limit,
  'rows',coalesce((select jsonb_agg(to_jsonb(t)) from enriched t),'[]'::jsonb),
  'disclaimer','Only already-ingested official source dates; unknown values are null.'
 ) into result;
 return result;
end;
$$;
revoke all on function public.ti_fast_archive_filtered(text,text,text,numeric,text,integer,integer) from public;
grant execute on function public.ti_fast_archive_filtered(text,text,text,numeric,text,integer,integer) to anon,authenticated;