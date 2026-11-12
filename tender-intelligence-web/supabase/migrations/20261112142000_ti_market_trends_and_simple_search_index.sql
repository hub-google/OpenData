-- Real UAT failures on 2026-11-12:
-- 1. Advanced single-term query timed out even though the canonical CJK bigram
--    index (ti_case_search_cjk_bigram_gin) is present.
-- 2. Market trend WHERE latest_notice_date / 100 prevented a normal range
--    lookup against existing ti_cases_date_idx.
-- Both replacements preserve source-backed results, null amounts, permissions,
-- date range and public response contracts. No rows or other apps are changed.

create or replace function public.ti_archive_search_simple(
 p_term text, p_page integer default 1, p_limit integer default 30
) returns jsonb language plpgsql stable security invoker
set search_path='' as $function$
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
  where public.ti_cjk_bigrams(si.searchable) @> public.ti_cjk_bigrams(needle)
    and si.searchable like '%'||needle||'%'
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
end $function$;

revoke all on function public.ti_archive_search_simple(text,integer,integer) from public;
grant execute on function public.ti_archive_search_simple(text,integer,integer) to anon,authenticated;

create or replace function public.ti_market_trends_v1(
 p_months integer default 12,p_agency text default '',p_group text default ''
) returns jsonb language plpgsql stable security invoker
set search_path='pg_catalog','public' as $function$
declare
 result jsonb;
 start_month integer;
 end_month integer;
 normalized_agency text;
 normalized_group text;
begin
 if p_months is null or p_months<1 or p_months>24 then
  raise exception 'months must be between 1 and 24';
 end if;
 normalized_agency:=left(coalesce(p_agency,''),100);
 normalized_group:=left(coalesce(p_group,''),60);
 start_month:=to_char(
  date_trunc('month',(now() at time zone 'Asia/Taipei')::date)
   - make_interval(months=>p_months-1),'YYYYMM')::integer;
 end_month:=to_char(now() at time zone 'Asia/Taipei','YYYYMM')::integer;
 with filtered as materialized(
  select latest_notice_date,group_name,agency,budget_amount,award_amount
  from public.ti_cases
  where latest_notice_date >= start_month*100+1
    and latest_notice_date < end_month*100+32
    and (normalized_agency='' or agency ilike '%'||normalized_agency||'%')
    and (normalized_group='' or group_name=normalized_group)
 ), months as (
  select (latest_notice_date / 100)::integer as month,
         count(*)::integer as case_count,
         count(budget_amount)::integer as known_budget_count,
         sum(budget_amount) as published_budget_sum,
         count(award_amount)::integer as known_award_count,
         sum(award_amount) as published_award_sum
  from filtered group by 1
 ), category as (
  select coalesce(nullif(group_name,''),'未分類') as category,
         count(*)::integer as case_count,
         count(budget_amount)::integer as known_budget_count
  from filtered group by 1
 )
 select jsonb_build_object(
  'months',coalesce((select jsonb_agg(to_jsonb(m) order by m.month) from months m),'[]'::jsonb),
  'categories',coalesce((select jsonb_agg(to_jsonb(c) order by c.case_count desc) from category c),'[]'::jsonb),
  'parameters',jsonb_build_object('months',p_months,'agency',normalized_agency,'group',normalized_group),
  'last_case_date',(select max(latest_notice_date) from filtered),
  'distinct_cases',(select count(*) from filtered),
  'note','按本站已成功入庫的每件案件最新公告日期統計。歷史尚未完整覆蓋；無公開金額不加入金額總和，部分月份可能仍有來源缺口。'
 ) into result;
 return result;
end $function$;

revoke all on function public.ti_market_trends_v1(integer,text,text) from public;
grant execute on function public.ti_market_trends_v1(integer,text,text) to anon,authenticated;
