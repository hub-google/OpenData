-- Archive fallback for OpenFun unitstat CORS; counts are based on
-- each case's latest successfully ingested notice year (NOT national totals).
CREATE OR REPLACE FUNCTION public.ti_agency_archived_annual(p_unit_id text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select jsonb_build_object(
  'unit_id',p_unit_id,
  'agency',max(agency),
  'total_cases',coalesce(sum(case_count),0),
  'years',coalesce(jsonb_agg(
    jsonb_build_object('year',yr,'case_count',case_count,
     'award_case_count',award_case_count,'award_amount_count',award_amount_count,
     'award_amount_sum',award_amount_sum,'budget_amount_count',budget_amount_count,
     'budget_amount_sum',budget_amount_sum
    ) order by yr desc),'[]'::jsonb)
 )
 from (
  select max(agency) as agency, (latest_notice_date/10000)::integer yr,
  count(*) case_count,
  count(*) filter (where latest_notice_type like '%決標%'
     and latest_notice_type not like '%無法決標%') award_case_count,
  count(award_amount) award_amount_count,coalesce(sum(award_amount),0) award_amount_sum,
  count(budget_amount) budget_amount_count,coalesce(sum(budget_amount),0) budget_amount_sum
  from public.ti_cases
  where unit_id=p_unit_id and length(p_unit_id) between 1 and 80
  group by latest_notice_date/10000
 ) annual;
$function$;
revoke all on function public.ti_agency_archived_annual(text) from public;
grant execute on function public.ti_agency_archived_annual(text) to anon,authenticated;
