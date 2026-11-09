
-- PRD v0.2: canonical case-level search across all public search modes.
-- SECURITY INVOKER: caller can only see public ti_cases / public search indexes.
create or replace function public.ti_case_stage(p_notice_type text)
returns text language sql immutable security invoker set search_path = ''
as $body$
 select case
  when coalesce(p_notice_type,'') ~ '(無法決標|流標|廢標)' then '無法決標'
  when p_notice_type ~ '決標' then '決標'
  when p_notice_type ~ '(公開閱覽)' then '公開閱覽'
  when p_notice_type ~ '公開徵求廠商提供參考資料' then '公開徵求'
  when p_notice_type ~ '(更正)' then '更正'
  when p_notice_type ~ '(財物變賣|標售|標租|財物出租)' then '財物標售'
  when p_notice_type ~ '(招標|取得報價單|取得企劃書)' then '招標'
  when p_notice_type ~ '徵求' then '公開徵求'
  else '其他' end;
$body$;
revoke all on function public.ti_case_stage(text) from public, anon, authenticated;
grant execute on function public.ti_case_stage(text) to anon, authenticated, service_role;

create or replace function public.ti_case_search_v2(
 p_mode text default 'latest', p_term text default '', p_kind text default '',
 p_group text default '', p_min_budget numeric default null,
 p_sort text default 'date', p_scenario text default 'all',
 p_page integer default 1, p_limit integer default 30
) returns jsonb language plpgsql stable security invoker
set search_path = 'pg_catalog','public'
as $body$
declare needle text; answer jsonb;
begin
 if p_mode not in ('latest','title','archive','agency','vendor','companyId')
  or p_kind not in ('','全部','招標','決標','更正','無法決標','公開閱覽','公開徵求','財物標售')
  or p_group not in ('','全部','工程','財物','勞務','未分類')
  or p_scenario not in ('all','open','soon','failed','amended','awarded')
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
$body$;
revoke all on function public.ti_case_search_v2(text,text,text,text,numeric,text,text,integer,integer) from public, anon, authenticated;
grant execute on function public.ti_case_search_v2(text,text,text,text,numeric,text,text,integer,integer) to anon, authenticated, service_role;

-- Priority: explicitly requested > saved/being tracked > still-open deadline
-- > new active solicitations > historic awarded; never remove rate limit / retry.
create index if not exists ti_saved_cases_case_priority_idx on public.ti_saved_cases(case_id);
create or replace function public.ti_pick_details_enrichment(p_limit integer default 8)
returns table(case_id text,unit_id text,job_number text,latest_notice_date integer,latest_notice_type text,latest_filename text)
language sql stable security invoker set search_path='pg_catalog','public'
as $body$
 select c.id,c.unit_id,c.job_number,c.latest_notice_date,c.latest_notice_type,c.latest_filename
 from public.ti_cases c
 left join public.ti_case_details d on d.case_id=c.id
 left join public.ti_detail_enrichment_attempts a on a.case_id=c.id
 left join (select case_id,min(requested_at) first_requested from public.ti_detail_requests
    where status='queued' group by case_id) r on r.case_id=c.id
 where (r.first_requested is not null or d.case_id is null
       or d.latest_notice_id is distinct from c.id||'::'||c.latest_notice_date::text||'::'||coalesce(c.latest_filename,''))
    and (a.next_retry_at is null or a.next_retry_at<=now())
    and length(c.unit_id) between 1 and 80 and length(c.job_number) between 1 and 100
 order by
    case when r.first_requested is not null then 0
         when exists(select 1 from public.ti_saved_cases s where s.case_id=c.id) then 1
         when public.ti_case_stage(c.latest_notice_type)='招標' and c.deadline_at>now() then 2
         when public.ti_case_stage(c.latest_notice_type) in ('招標','更正') then 3
         when public.ti_case_stage(c.latest_notice_type) in ('公開徵求','公開閱覽') then 4
         else 5 end,
    r.first_requested nulls last,c.latest_notice_date desc,c.id asc
 limit least(greatest(coalesce(p_limit,8),1),12);
$body$;
revoke all on function public.ti_pick_details_enrichment(integer) from public, anon, authenticated;
grant execute on function public.ti_pick_details_enrichment(integer) to service_role;
