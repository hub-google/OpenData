-- F02 full Boolean query with parentheses; v1/v2 preserved for existing clients.
-- Safe bounded Boolean expression executor: only values, no regex execution/dynamic SQL.
create or replace function public.ti_query_expression_matches(
 p_text text,p_expression jsonb,p_depth integer default 0
)
returns boolean language plpgsql stable security invoker set search_path='' as $$
declare op text; children jsonb; item jsonb; result boolean; raw text;
begin
 if p_expression is null or jsonb_typeof(p_expression)<>'object'
   or p_depth<0 or p_depth>6 or length(p_expression::text)>3000
 then raise exception 'invalid boolean search expression' using errcode='22023';end if;
 op:=p_expression->>'op';
 if op='term' then
  raw:=p_expression->>'value';
  if raw is null or length(trim(raw))=0 or length(raw)>60
   then raise exception 'invalid search term' using errcode='22023';end if;
  return position(lower(replace(trim(raw),'臺','台'))
   in lower(replace(coalesce(p_text,''),'臺','台')))>0;
 elsif op='not' then
  if jsonb_typeof(p_expression->'child')<>'object'
  then raise exception 'invalid NOT node' using errcode='22023';end if;
  return not public.ti_query_expression_matches(p_text,p_expression->'child',p_depth+1);
 elsif op in ('and','or') then
  children:=p_expression->'children';
  if jsonb_typeof(children)<>'array' or jsonb_array_length(children)<2
     or jsonb_array_length(children)>12
  then raise exception 'invalid logical children' using errcode='22023';end if;
  for item in select value from jsonb_array_elements(children) loop
   result:=public.ti_query_expression_matches(p_text,item,p_depth+1);
   if op='and' and not result then return false;end if;
   if op='or' and result then return true;end if;
  end loop;
  return op='and';
 end if;
 raise exception 'unsupported search operator' using errcode='22023';
end $$;
revoke all on function public.ti_query_expression_matches(text,jsonb,integer) from public;
grant execute on function public.ti_query_expression_matches(text,jsonb,integer) to anon,authenticated;

create or replace function public.ti_archive_search_v3(
  p_terms text[] default array[]::text[],
  p_exclude text[] default array[]::text[],
  p_any boolean default false,
  p_agency text default '',
  p_kind text default '',
  p_group text default '',
  p_location text default '',
  p_method text default '',
  p_min_budget numeric default null,
  p_max_budget numeric default null,
  p_date_from integer default null,
  p_date_to integer default null,
  p_deadline_only boolean default false,
  p_deadline_start date default null,
  p_deadline_end date default null,
  p_sort text default 'date',
  p_page integer default 1,
  p_limit integer default 30,
  p_expression jsonb default null
)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
  if coalesce(cardinality(p_terms),0)>12
     or coalesce(cardinality(p_exclude),0)>12
     or exists(select 1 from unnest(coalesce(p_terms,array[]::text[])||coalesce(p_exclude,array[]::text[])) t
          where length(t)>60 or length(trim(t))=0)
     or length(coalesce(p_agency,''))>100
     or length(coalesce(p_location,''))>80
     or length(coalesce(p_method,''))>80
     or p_limit not between 1 and 50 or p_page not between 1 and 1000
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
          coalesce((
             select string_agg(array_to_string(n.company_names,' ')||' '||
                               array_to_string(n.company_ids,' '),' ')
             from public.ti_notices n where n.case_id=c.id
          ),'') as searchable
   from public.ti_cases c
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
      (p_expression is not null and public.ti_query_expression_matches(m.searchable,p_expression))
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
end $$;
revoke all on function public.ti_archive_search_v3(text[],text[],boolean,text,text,text,text,text,numeric,numeric,integer,integer,boolean,date,date,text,integer,integer,jsonb) from public;
grant execute on function public.ti_archive_search_v3(text[],text[],boolean,text,text,text,text,text,numeric,numeric,integer,integer,boolean,date,date,text,integer,integer,jsonb) to anon,authenticated;




