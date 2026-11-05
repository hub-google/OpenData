-- Public market trends from real, already ingested case records only.
-- One case id per ti_cases row; never treat missing price as 0 and never imply full historical coverage.
create or replace function public.ti_market_trends_v1(
 p_months integer default 12,
 p_agency text default '',
 p_group text default ''
) returns jsonb
language plpgsql stable security definer
set search_path=pg_catalog,public
as $$
declare
 result jsonb;
 start_month integer;
 normalized_agency text;
 normalized_group text;
begin
 if p_months is null or p_months<1 or p_months>24 then
   raise exception 'months must be between 1 and 24';
 end if;
 normalized_agency:=left(coalesce(p_agency,''),100);
 normalized_group:=left(coalesce(p_group,''),60);
 start_month:=(to_char(date_trunc('month',((now() at time zone 'Asia/Taipei')::date - ((p_months-1)||' months')::interval))::date,'YYYYMM'))::integer;
 with filtered as (
  select id, latest_notice_date, group_name, agency, budget_amount, award_amount
  from public.ti_cases
  where latest_notice_date / 100 >= start_month
    and latest_notice_date / 100 <= to_char(now() at time zone 'Asia/Taipei','YYYYMM')::integer
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
end;
$$;
revoke all on function public.ti_market_trends_v1(integer,text,text) from public;
grant execute on function public.ti_market_trends_v1(integer,text,text) to anon,authenticated;
comment on function public.ti_market_trends_v1(integer,text,text) is 'Real source-backed timeline of ingested procurement cases; monthly number and known-price sample counts. Never assert nationwide coverage.';