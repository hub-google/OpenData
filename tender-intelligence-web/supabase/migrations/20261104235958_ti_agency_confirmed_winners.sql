-- Source-evidenced winning suppliers, preserving the former agency winners UI
-- without depending on browser cross-origin access to OpenFun unitstat.
-- Only confirmed award roles count; duplicate notice versions are not multiple
-- distinct cases, and amounts cannot be attributed to a co-winner safely.

CREATE OR REPLACE FUNCTION public.ti_agency_confirmed_winners(p_unit_id text, p_limit integer DEFAULT 20)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
with confirmed as (
 select kv.key as company_name,n.case_id,n.source_date,n.filename
 from public.ti_cases c
 join public.ti_notices n on n.case_id=c.id
 cross join lateral jsonb_each(coalesce(n.company_role_keys,'{}'::jsonb)) kv
 where c.unit_id=p_unit_id and length(coalesce(p_unit_id,'')) between 1 and 80
 and n.notice_type like '%決標%' and n.notice_type not like '%無法決標%'
 and jsonb_typeof(kv.value)='array'
 and exists(
   select 1 from jsonb_array_elements_text(kv.value) rolepath
   where rolepath like '%:得標廠商%'
 )
),
summary as (
 select company_name,count(distinct case_id)::integer as award_cases,
 count(distinct case_id||'::'||source_date||'::'||filename)::integer as award_notice_versions
 from confirmed group by company_name
),
ranking as (
 select company_name,award_cases,award_notice_versions
 from summary order by award_cases desc,company_name limit least(greatest(p_limit,1),30)
)
select jsonb_build_object(
 'source','ti_notices.company_role_keys',
 'unit_id',p_unit_id,
 'winners',coalesce(jsonb_agg(
    jsonb_build_object('company_name',company_name,'award_cases',award_cases,'award_notice_versions',award_notice_versions)
    order by award_cases desc,company_name
 ),'[]'::jsonb)
) from ranking
$function$;
revoke all on function public.ti_agency_confirmed_winners(text,integer) from public;
grant execute on function public.ti_agency_confirmed_winners(text,integer) to anon,authenticated;
