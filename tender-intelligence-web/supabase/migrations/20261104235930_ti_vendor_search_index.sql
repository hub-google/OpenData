-- Indexed public vendor tokens for live keyword-search latency under the
-- existing anonymous 3-second statement timeout. Source: ti_notices only.
-- Keep RLS enabled; anonymous callers can read source-public names, not write.
create table if not exists public.ti_case_vendor_search(
 case_id text primary key references public.ti_cases(id) on delete cascade,
 vendor_text text not null default '',
 updated_at timestamptz not null default now()
);
alter table public.ti_case_vendor_search enable row level security;
revoke all on public.ti_case_vendor_search from public;
grant select on public.ti_case_vendor_search to anon,authenticated;
do $$ begin
 if not exists(select 1 from pg_policies where schemaname='public'
   and tablename='ti_case_vendor_search' and policyname='ti_vendor_text_public_read')
 then
   create policy ti_vendor_text_public_read
    on public.ti_case_vendor_search for select to anon,authenticated using(true);
 end if;
end $$;

CREATE OR REPLACE FUNCTION public.ti_sync_case_vendor_text()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare target text;
begin
 if TG_OP='UPDATE' and old.case_id is not distinct from new.case_id
   and old.company_names is not distinct from new.company_names
   and old.company_ids is not distinct from new.company_ids
 then return new; end if;
 if TG_OP='DELETE' then target:=old.case_id;else target:=new.case_id;end if;
 if target is not null then
  insert into public.ti_case_vendor_search(case_id,vendor_text,updated_at)
  select target,coalesce(string_agg(
    array_to_string(n.company_names,' ')||' '||array_to_string(n.company_ids,' '),' '),''),
    now()
  from public.ti_notices n where n.case_id=target
  on conflict(case_id) do update
    set vendor_text=excluded.vendor_text,updated_at=excluded.updated_at;
 end if;
 if TG_OP='UPDATE' and old.case_id is distinct from new.case_id then
  insert into public.ti_case_vendor_search(case_id,vendor_text,updated_at)
  select old.case_id,coalesce(string_agg(
    array_to_string(n.company_names,' ')||' '||array_to_string(n.company_ids,' '),' '),''),
    now()
  from public.ti_notices n where n.case_id=old.case_id
  on conflict(case_id) do update
    set vendor_text=excluded.vendor_text,updated_at=excluded.updated_at;
 end if;
 if TG_OP='DELETE' then return old;end if;
 return new;
end $function$;

drop trigger if exists ti_update_case_vendor_search on public.ti_notices;
create trigger ti_update_case_vendor_search
 after insert or update or delete on public.ti_notices
 for each row execute function public.ti_sync_case_vendor_text();

-- Backfill actual published company names / company IDs, preserving all cases
-- with missing companies as genuinely unknown rather than fake zero values.
insert into public.ti_case_vendor_search(case_id,vendor_text)
select n.case_id,string_agg(
  array_to_string(n.company_names,' ')||' '||array_to_string(n.company_ids,' '),' ')
from public.ti_notices n
where coalesce(cardinality(n.company_names),0)>0
   or coalesce(cardinality(n.company_ids),0)>0
group by n.case_id
on conflict(case_id) do update
 set vendor_text=excluded.vendor_text,updated_at=now();

CREATE OR REPLACE FUNCTION public.ti_boolean_requires_positive(expr jsonb, depth integer DEFAULT 0)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare op text; sub jsonb;
begin
 if expr is null or depth>8 then return false;end if;
 op:=expr->>'op';
 if op='term' then return true;end if;
 if op='not' then return false;end if;
 if op='and' then
  for sub in select value from jsonb_array_elements(coalesce(expr->'children','[]'::jsonb)) loop
   if public.ti_boolean_requires_positive(sub,depth+1) then return true;end if;
  end loop;
  return false;
 end if;
 if op='or' then
  for sub in select value from jsonb_array_elements(coalesce(expr->'children','[]'::jsonb)) loop
   if not public.ti_boolean_requires_positive(sub,depth+1) then return false;end if;
  end loop;
  return jsonb_array_length(coalesce(expr->'children','[]'::jsonb))>0;
 end if;
 return false;
end $function$;
revoke all on function public.ti_boolean_requires_positive(jsonb,integer) from public;
grant execute on function public.ti_boolean_requires_positive(jsonb,integer) to anon,authenticated;

-- Preserve full existing F02/F03 query contracts, filters, and sort order.
-- Replace expensive per-request notice aggregation with maintained vendor index.
CREATE OR REPLACE FUNCTION public.ti_archive_search_v3(p_terms text[] DEFAULT ARRAY[]::text[], p_exclude text[] DEFAULT ARRAY[]::text[], p_any boolean DEFAULT false, p_agency text DEFAULT ''::text, p_kind text DEFAULT ''::text, p_group text DEFAULT ''::text, p_location text DEFAULT ''::text, p_method text DEFAULT ''::text, p_min_budget numeric DEFAULT NULL::numeric, p_max_budget numeric DEFAULT NULL::numeric, p_date_from integer DEFAULT NULL::integer, p_date_to integer DEFAULT NULL::integer, p_deadline_only boolean DEFAULT false, p_deadline_start date DEFAULT NULL::date, p_deadline_end date DEFAULT NULL::date, p_sort text DEFAULT 'date'::text, p_page integer DEFAULT 1, p_limit integer DEFAULT 30, p_expression jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare result jsonb;
begin
  if coalesce(cardinality(p_terms),0)>12
     or coalesce(cardinality(p_exclude),0)>12
     or exists(select 1 from unnest(coalesce(p_terms,array[]::text[])||coalesce(p_exclude,array[]::text[])) t
          where length(t)>60 or length(trim(t))=0)
     or length(coalesce(p_agency,''))>100
     or length(coalesce(p_location,''))>80
     or length(coalesce(p_method,''))>80
     or p_limit not between 1 and 50 or p_page not between 1 and 10000
     or p_sort not in ('date','relevance','deadline','budget','award','title')
     or (p_min_budget is not null and p_min_budget<0)
     or (p_max_budget is not null and p_max_budget<0)
     or (p_min_budget is not null and p_max_budget is not null and p_min_budget>p_max_budget)
     or (p_deadline_start is not null and p_deadline_end is not null and p_deadline_start>p_deadline_end)
  then
    raise exception 'invalid search parameters' using errcode='22023';
  end if;

  with matched as (
   select c.id,c.unit_id,c.job_number,c.title,c.agency,c.category,c.group_name,
          c.latest_notice_type,c.latest_notice_date,c.latest_filename,
          c.budget_amount,c.award_amount,c.official_url,c.deadline_at,
          c.source_fetched_at,
          nullif(d.details->>'location','') as verified_location,
          nullif(d.details->>'tender_method','') as verified_tender_method,
          coalesce(c.title,'')||' '||coalesce(c.agency,'')||' '||coalesce(c.job_number,'')||
          ' '||coalesce(c.category,'')||' '||
          coalesce(vt.vendor_text,'') as searchable
   from public.ti_cases c
   left join public.ti_case_vendor_search vt on vt.case_id=c.id
   left join public.ti_case_details d on d.case_id=c.id
   where (p_kind='' or case
           when p_kind='無法決標' then coalesce(c.latest_notice_type,'') like '%無法決標%'
           when p_kind='更正' then coalesce(c.latest_notice_type,'') like '%更正%'
           when p_kind='公開閱覽' then coalesce(c.latest_notice_type,'') like '%公開閱覽%'
           when p_kind='公開徵求' then coalesce(c.latest_notice_type,'') like '%公開徵求%'
           when p_kind='財物變賣' then coalesce(c.latest_notice_type,'') like '%財物變賣%'
           when p_kind='決標' then coalesce(c.latest_notice_type,'') like '%決標%'
             and coalesce(c.latest_notice_type,'') not like '%無法決標%'
           when p_kind='招標' then
             (coalesce(c.latest_notice_type,'') like '%招標%'
               or coalesce(c.latest_notice_type,'') like '%取得報價%'
               or coalesce(c.latest_notice_type,'') like '%取得企劃書%')
             and coalesce(c.latest_notice_type,'') not like '%更正%'
             and coalesce(c.latest_notice_type,'') not like '%決標%'
             and coalesce(c.latest_notice_type,'') not like '%公開閱覽%'
           else c.latest_notice_type=p_kind
         end)
      and (p_group='' or c.group_name=p_group)
      and (p_agency='' or position(lower(replace(trim(p_agency),'臺','台')) in lower(replace(coalesce(c.agency,'')||' '||c.unit_id,'臺','台')))>0)
      and (p_min_budget is null or (c.budget_amount is not null and c.budget_amount>=p_min_budget))
      and (p_max_budget is null or (c.budget_amount is not null and c.budget_amount<=p_max_budget))
      and (p_date_from is null or c.latest_notice_date>=p_date_from)
      and (p_date_to is null or c.latest_notice_date<=p_date_to)
      and (p_location='' or
           (d.details->>'location' is not null and
             position(lower(replace(trim(p_location),'臺','台')) in lower(replace(d.details->>'location','臺','台')))>0))
      and (p_method='' or
           (d.details->>'tender_method' is not null and
             position(lower(replace(trim(p_method),'臺','台')) in lower(replace(d.details->>'tender_method','臺','台')))>0))
      and (p_deadline_start is null or
           (c.deadline_at is not null and (c.deadline_at at time zone 'Asia/Taipei')::date>=p_deadline_start))
      and (p_deadline_end is null or
           (c.deadline_at is not null and (c.deadline_at at time zone 'Asia/Taipei')::date<=p_deadline_end))
      and (not p_deadline_only or
        (c.deadline_at is not null and c.deadline_at>now()
         and (c.latest_notice_type like '%招標%'
           or c.latest_notice_type like '%取得報價%'
           or c.latest_notice_type like '%取得企劃書%')
         and c.latest_notice_type not like '%決標%'
         and c.latest_notice_type not like '%公開閱覽%'))
   ),
   filtered as (
    select m.*,
      (select count(*) from unnest(coalesce(p_terms,array[]::text[])) rel
        where position(lower(replace(trim(rel),'臺','台')) in lower(replace(m.searchable,'臺','台')))>0) as relevance
    from matched m
    where (
      (p_expression is not null and (case when public.ti_boolean_requires_positive(p_expression)
        and coalesce(cardinality(p_terms),0)>0
        and not exists(select 1 from unnest(p_terms) possible_term
          where position(lower(replace(trim(possible_term),'臺','台'))
            in lower(replace(m.searchable,'臺','台')))>0)
      then false
      when p_expression->>'op'='term'
      then position(lower(replace(trim(p_expression->>'value'),'臺','台'))
        in lower(replace(m.searchable,'臺','台')))>0
      else public.ti_query_expression_matches(m.searchable,p_expression) end))
      or (p_expression is null and (
       coalesce(cardinality(p_terms),0)=0
       or (p_any and exists(
         select 1 from unnest(p_terms) term
         where position(lower(replace(trim(term),'臺','台')) in lower(replace(m.searchable,'臺','台')))>0))
       or (not p_any and not exists(
         select 1 from unnest(p_terms) term
         where position(lower(replace(trim(term),'臺','台')) in lower(replace(m.searchable,'臺','台')))=0))
    )))
    and not exists(
      select 1 from unnest(coalesce(p_exclude,array[]::text[])) term
      where position(lower(replace(trim(term),'臺','台')) in lower(replace(m.searchable,'臺','台')))>0
    )
   ),
   sliced as (
     select id,unit_id,job_number,title,agency,category,group_name,
      latest_notice_type,latest_notice_date,latest_filename,budget_amount,
      award_amount,official_url,deadline_at,source_fetched_at,
      verified_location,verified_tender_method,relevance
     from filtered
     order by
       case when p_sort='relevance' then relevance end desc nulls last,
       case when p_sort='deadline' then deadline_at end asc nulls last,
       case when p_sort='budget' then budget_amount end desc nulls last,
       case when p_sort='award' then award_amount end desc nulls last,
       case when p_sort='title' then title end asc nulls last,
       latest_notice_date desc,id asc
     limit p_limit offset ((p_page-1)*p_limit)
   )
   select jsonb_build_object(
      'total',(select count(*) from filtered),
      'page',p_page,'limit',p_limit,
      'rows',coalesce((select jsonb_agg(to_jsonb(s)) from sliced s),'[]'::jsonb),
      'disclaimer','Results include only successfully ingested dates. Unavailable fields are null, not zero.'
   ) into result;
  return result;
end $function$;

CREATE OR REPLACE FUNCTION public.ti_archive_search_v4(p_terms text[] DEFAULT ARRAY[]::text[], p_exclude text[] DEFAULT ARRAY[]::text[], p_any boolean DEFAULT false, p_agency text DEFAULT ''::text, p_kind text DEFAULT ''::text, p_group text DEFAULT ''::text, p_location text DEFAULT ''::text, p_method text DEFAULT ''::text, p_min_budget numeric DEFAULT NULL::numeric, p_max_budget numeric DEFAULT NULL::numeric, p_date_from integer DEFAULT NULL::integer, p_date_to integer DEFAULT NULL::integer, p_deadline_only boolean DEFAULT false, p_deadline_start date DEFAULT NULL::date, p_deadline_end date DEFAULT NULL::date, p_sort text DEFAULT 'date'::text, p_page integer DEFAULT 1, p_limit integer DEFAULT 30, p_expression jsonb DEFAULT NULL::jsonb, p_decision_method text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare result jsonb;
begin
  if coalesce(cardinality(p_terms),0)>12
     or coalesce(cardinality(p_exclude),0)>12
     or exists(select 1 from unnest(coalesce(p_terms,array[]::text[])||coalesce(p_exclude,array[]::text[])) t
          where length(t)>60 or length(trim(t))=0)
     or length(coalesce(p_agency,''))>100
     or length(coalesce(p_location,''))>80
     or length(coalesce(p_method,''))>80
     or length(coalesce(p_decision_method,''))>80
     or p_limit not between 1 and 50 or p_page not between 1 and 10000
     or p_sort not in ('date','relevance','deadline','budget','award','title')
     or (p_min_budget is not null and p_min_budget<0)
     or (p_max_budget is not null and p_max_budget<0)
     or (p_min_budget is not null and p_max_budget is not null and p_min_budget>p_max_budget)
     or (p_deadline_start is not null and p_deadline_end is not null and p_deadline_start>p_deadline_end)
  then
    raise exception 'invalid search parameters' using errcode='22023';
  end if;

  with matched as (
   select c.id,c.unit_id,c.job_number,c.title,c.agency,c.category,c.group_name,
          c.latest_notice_type,c.latest_notice_date,c.latest_filename,
          c.budget_amount,c.award_amount,c.official_url,c.deadline_at,
          c.source_fetched_at,
          nullif(d.details->>'location','') as verified_location,
          nullif(d.details->>'tender_method','') as verified_tender_method,
          nullif(d.details->>'decision_method','') as verified_decision_method,
          coalesce(c.title,'')||' '||coalesce(c.agency,'')||' '||coalesce(c.job_number,'')||
          ' '||coalesce(c.category,'')||' '||
          coalesce(vt.vendor_text,'') as searchable
   from public.ti_cases c
   left join public.ti_case_vendor_search vt on vt.case_id=c.id
   left join public.ti_case_details d on d.case_id=c.id
   where (p_kind='' or case
           when p_kind='無法決標' then coalesce(c.latest_notice_type,'') like '%無法決標%'
           when p_kind='更正' then coalesce(c.latest_notice_type,'') like '%更正%'
           when p_kind='公開閱覽' then coalesce(c.latest_notice_type,'') like '%公開閱覽%'
           when p_kind='公開徵求' then coalesce(c.latest_notice_type,'') like '%公開徵求%'
           when p_kind='財物變賣' then coalesce(c.latest_notice_type,'') like '%財物變賣%'
           when p_kind='決標' then coalesce(c.latest_notice_type,'') like '%決標%'
             and coalesce(c.latest_notice_type,'') not like '%無法決標%'
           when p_kind='招標' then
             (coalesce(c.latest_notice_type,'') like '%招標%'
               or coalesce(c.latest_notice_type,'') like '%取得報價%'
               or coalesce(c.latest_notice_type,'') like '%取得企劃書%')
             and coalesce(c.latest_notice_type,'') not like '%更正%'
             and coalesce(c.latest_notice_type,'') not like '%決標%'
             and coalesce(c.latest_notice_type,'') not like '%公開閱覽%'
           else c.latest_notice_type=p_kind
         end)
      and (p_group='' or c.group_name=p_group)
      and (p_agency='' or position(lower(replace(trim(p_agency),'臺','台')) in lower(replace(coalesce(c.agency,'')||' '||c.unit_id,'臺','台')))>0)
      and (p_min_budget is null or (c.budget_amount is not null and c.budget_amount>=p_min_budget))
      and (p_max_budget is null or (c.budget_amount is not null and c.budget_amount<=p_max_budget))
      and (p_date_from is null or c.latest_notice_date>=p_date_from)
      and (p_date_to is null or c.latest_notice_date<=p_date_to)
      and (p_location='' or
           (d.details->>'location' is not null and
             position(lower(replace(trim(p_location),'臺','台')) in lower(replace(d.details->>'location','臺','台')))>0))
      and (p_method='' or
           (d.details->>'tender_method' is not null and
             position(lower(replace(trim(p_method),'臺','台')) in lower(replace(d.details->>'tender_method','臺','台')))>0))
      and (p_decision_method='' or
           (d.details->>'decision_method' is not null and
             position(lower(replace(trim(p_decision_method),'臺','台')) in
               lower(replace(d.details->>'decision_method','臺','台')))>0))
      and (p_deadline_start is null or
           (c.deadline_at is not null and (c.deadline_at at time zone 'Asia/Taipei')::date>=p_deadline_start))
      and (p_deadline_end is null or
           (c.deadline_at is not null and (c.deadline_at at time zone 'Asia/Taipei')::date<=p_deadline_end))
      and (not p_deadline_only or
        (c.deadline_at is not null and c.deadline_at>now()
         and (c.latest_notice_type like '%招標%'
           or c.latest_notice_type like '%取得報價%'
           or c.latest_notice_type like '%取得企劃書%')
         and c.latest_notice_type not like '%決標%'
         and c.latest_notice_type not like '%公開閱覽%'))
   ),
   filtered as (
    select m.*,
      (select count(*) from unnest(coalesce(p_terms,array[]::text[])) rel
        where position(lower(replace(trim(rel),'臺','台')) in lower(replace(m.searchable,'臺','台')))>0) as relevance
    from matched m
    where (
      (p_expression is not null and (case when public.ti_boolean_requires_positive(p_expression)
        and coalesce(cardinality(p_terms),0)>0
        and not exists(select 1 from unnest(p_terms) possible_term
          where position(lower(replace(trim(possible_term),'臺','台'))
            in lower(replace(m.searchable,'臺','台')))>0)
      then false
      when p_expression->>'op'='term'
      then position(lower(replace(trim(p_expression->>'value'),'臺','台'))
        in lower(replace(m.searchable,'臺','台')))>0
      else public.ti_query_expression_matches(m.searchable,p_expression) end))
      or (p_expression is null and (
       coalesce(cardinality(p_terms),0)=0
       or (p_any and exists(
         select 1 from unnest(p_terms) term
         where position(lower(replace(trim(term),'臺','台')) in lower(replace(m.searchable,'臺','台')))>0))
       or (not p_any and not exists(
         select 1 from unnest(p_terms) term
         where position(lower(replace(trim(term),'臺','台')) in lower(replace(m.searchable,'臺','台')))=0))
    )))
    and not exists(
      select 1 from unnest(coalesce(p_exclude,array[]::text[])) term
      where position(lower(replace(trim(term),'臺','台')) in lower(replace(m.searchable,'臺','台')))>0
    )
   ),
   sliced as (
     select id,unit_id,job_number,title,agency,category,group_name,
      latest_notice_type,latest_notice_date,latest_filename,budget_amount,
      award_amount,official_url,deadline_at,source_fetched_at,
      verified_location,verified_tender_method,verified_decision_method,relevance
     from filtered
     order by
       case when p_sort='relevance' then relevance end desc nulls last,
       case when p_sort='deadline' then deadline_at end asc nulls last,
       case when p_sort='budget' then budget_amount end desc nulls last,
       case when p_sort='award' then award_amount end desc nulls last,
       case when p_sort='title' then title end asc nulls last,
       latest_notice_date desc,id asc
     limit p_limit offset ((p_page-1)*p_limit)
   )
   select jsonb_build_object(
      'total',(select count(*) from filtered),
      'page',p_page,'limit',p_limit,
      'rows',coalesce((select jsonb_agg(to_jsonb(s)) from sliced s),'[]'::jsonb),
      'disclaimer','Results include only successfully ingested dates. Unavailable fields are null, not zero.'
   ) into result;
  return result;
end $function$;
