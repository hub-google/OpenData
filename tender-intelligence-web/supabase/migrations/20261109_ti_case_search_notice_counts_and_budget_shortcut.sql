-- Add explicit bounded-budget live cases and true source-notice counts.
CREATE OR REPLACE FUNCTION public.ti_case_search_v2(p_mode text DEFAULT 'latest'::text, p_term text DEFAULT ''::text, p_kind text DEFAULT ''::text, p_group text DEFAULT ''::text, p_min_budget numeric DEFAULT NULL::numeric, p_sort text DEFAULT 'date'::text, p_scenario text DEFAULT 'all'::text, p_page integer DEFAULT 1, p_limit integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare needle text; answer jsonb;
begin
 if p_mode not in ('latest','title','archive','agency','vendor','companyId')
  or p_kind not in ('','全部','招標','決標','更正','無法決標','公開閱覽','公開徵求','財物標售')
  or p_group not in ('','全部','工程','財物','勞務','未分類')
  or p_scenario not in ('all','open','soon','small','failed','amended','awarded')
  or p_sort not in ('date','budget','title')
  or p_page not between 1 and 10000 or p_limit not between 1 and 50
  or (p_min_budget is not null and p_min_budget<0)
  or length(trim(coalesce(p_term,'')))>120
  or (p_mode<>'latest' and length(trim(coalesce(p_term,'')))<1)
  or (p_mode='title' and length(trim(p_term))<2)
  or (p_mode='companyId' and p_term !~ '^[0-9]{8}$')
 then raise exception 'invalid case search parameters' using errcode='22023'; end if;
 needle:=lower(replace(trim(coalesce(p_term,'')),'臺','台'));
 needle:=replace(replace(replace(needle,'!','!!'),'%','!%'),'_','!_');
 with matching as materialized(
   select c.id
   from public.ti_cases c
   where (
     p_mode='latest'
     or (p_mode='title' and exists (
       select 1 from public.ti_case_search_index si
       where si.case_id=c.id
         and public.ti_cjk_bigrams(si.searchable) @> public.ti_cjk_bigrams(lower(replace(trim(p_term),'臺','台')))
         and si.searchable like '%'||needle||'%' escape '!'
     ))
     or (p_mode='archive' and lower(replace(c.title,'臺','台')) like '%'||needle||'%' escape '!')
     or (p_mode='agency' and lower(replace(coalesce(c.agency,'')||' '||c.unit_id,'臺','台')) like '%'||needle||'%' escape '!')
     or (p_mode='vendor' and exists (
       select 1 from public.ti_case_vendor_search v where v.case_id=c.id
       and lower(replace(v.vendor_text,'臺','台')) like '%'||needle||'%' escape '!'
     ))
     or (p_mode='companyId' and exists (
       select 1 from public.ti_case_vendor_search v where v.case_id=c.id and v.vendor_text like '%'||needle||'%' escape '!'
     ))
   )
   and (p_kind in ('','全部') or public.ti_case_stage(c.latest_notice_type)=p_kind)
   and (p_group in ('','全部') or c.group_name=p_group)
   and (p_min_budget is null or c.budget_amount>=p_min_budget)
   and (
     p_scenario='all'
     or (p_scenario in ('open','soon') and public.ti_case_stage(c.latest_notice_type)='招標'
       and c.deadline_at>now()
       and (p_scenario='open' or c.deadline_at<=now()+interval '3 days'))
     or (p_scenario='small' and public.ti_case_stage(c.latest_notice_type)='招標'
        and c.deadline_at>now() and c.budget_amount between 0 and 1000000)
     or (p_scenario='failed' and public.ti_case_stage(c.latest_notice_type)='無法決標')
     or (p_scenario='awarded' and public.ti_case_stage(c.latest_notice_type)='決標')
     or (p_scenario='amended' and c.latest_notice_type like '%更正%'
        and c.latest_notice_date>=to_char((now() at time zone 'Asia/Taipei')::date - interval '30 days','YYYYMMDD')::integer)
   )
 ), page as materialized(
   select c.id,c.unit_id,c.job_number,c.title,c.agency,c.category,c.group_name,c.latest_notice_type,
     c.latest_notice_date,c.latest_filename,c.budget_amount,c.award_amount,c.deadline_at,
     c.official_url,c.source_fetched_at,
     row_number() over (order by
        case when p_sort='budget' then c.budget_amount end desc nulls last,
        case when p_sort='title' then c.title end asc nulls last,
        case when p_sort='date' then c.latest_notice_date end desc nulls last,
        c.latest_notice_date desc,c.id asc) as display_order
   from matching m join public.ti_cases c on c.id=m.id
   order by
        case when p_sort='budget' then c.budget_amount end desc nulls last,
        case when p_sort='title' then c.title end asc nulls last,
        case when p_sort='date' then c.latest_notice_date end desc nulls last,
        c.latest_notice_date desc,c.id asc
   limit p_limit offset ((p_page-1)*p_limit)
 )
 select jsonb_build_object(
   'total_records',(select count(*) from matching),
   'total_pages',greatest(1,ceil((select count(*) from matching)::numeric/p_limit)::integer),
   'source','case_index',
   'records',coalesce((select jsonb_agg(jsonb_build_object(
     'unit_id',s.unit_id,'job_number',s.job_number,'unit_name',s.agency,
     'date',s.latest_notice_date,'filename',coalesce(s.latest_filename,'db-cached'),
     'budget_amount',s.budget_amount,'award_amount',s.award_amount,'deadline_at',s.deadline_at,
     'source_fetched_at',s.source_fetched_at,
     'notice_count',(select count(*)::integer from public.ti_notices n where n.case_id=s.id),
     'brief',jsonb_build_object('title',s.title,'type',s.latest_notice_type,'category',coalesce(s.category,s.group_name)),
     'detail',case when s.official_url is not null then jsonb_build_object('url',s.official_url) else '{}'::jsonb end,
     'match_field',case
       when p_mode='title' and lower(replace(s.title,'臺','台')) like '%'||needle||'%' escape '!' then '標案名稱'
       when p_mode='title' then '公告其他索引欄位'
       else null end
   ) order by s.display_order) from page s),'[]'::jsonb)
 ) into answer;
 return answer;
end;
$function$
;
