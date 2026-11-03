-- PRD F02/F03/F04/F05: archive query against REAL stored announcements.
-- All public data read through existing RLS. No guessed location, amounts or deadlines.

create or replace function public.ti_preserve_newer_case()
returns trigger language plpgsql set search_path='' as $$
begin
  -- Importing an older API date must not roll back the latest notice of an existing case.
  if new.latest_notice_date < old.latest_notice_date
     or (new.latest_notice_date=old.latest_notice_date
         and coalesce(new.latest_filename,'')<coalesce(old.latest_filename,'')) then
    new.latest_notice_date:=old.latest_notice_date;
    new.latest_filename:=old.latest_filename;
    new.latest_notice_type:=old.latest_notice_type;
    new.title:=old.title;
    new.agency:=old.agency;
    new.category:=old.category;
    new.group_name:=old.group_name;
  end if;
  new.budget_amount:=coalesce(new.budget_amount,old.budget_amount);
  new.award_amount:=coalesce(new.award_amount,old.award_amount);
  new.official_url:=coalesce(new.official_url,old.official_url);
  new.deadline_at:=coalesce(new.deadline_at,old.deadline_at);
  new.first_seen_at:=least(new.first_seen_at,old.first_seen_at);
  return new;
end $$;
drop trigger if exists ti_preserve_latest_on_backfill on public.ti_cases;
create trigger ti_preserve_latest_on_backfill
before update on public.ti_cases for each row
execute function public.ti_preserve_newer_case();

-- Fully server-side filtering and pagination. SQL identifiers and sort modes are
-- fixed, all user terms are values (no dynamic SQL or regex evaluation).
create or replace function public.ti_archive_search(
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
  p_sort text default 'date',
  p_page integer default 1,
  p_limit integer default 30
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
     or p_sort not in ('date','deadline','budget','award','title')
     or (p_min_budget is not null and p_min_budget<0)
     or (p_max_budget is not null and p_max_budget<0)
     or (p_min_budget is not null and p_max_budget is not null and p_min_budget>p_max_budget)
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
           when p_kind='決標' then coalesce(c.latest_notice_type,'') like '%決標%'
             and coalesce(c.latest_notice_type,'') not like '%無法決標%'
           when p_kind='招標' then coalesce(c.latest_notice_type,'') like '%招標%'
             or coalesce(c.latest_notice_type,'') like '%徵求%'
           else c.latest_notice_type=p_kind
         end)
      and (p_group='' or c.group_name=p_group)
      and (p_agency='' or position(lower(trim(p_agency)) in lower(coalesce(c.agency,'')||' '||c.unit_id))>0)
      and (p_min_budget is null or (c.budget_amount is not null and c.budget_amount>=p_min_budget))
      and (p_max_budget is null or (c.budget_amount is not null and c.budget_amount<=p_max_budget))
      and (p_date_from is null or c.latest_notice_date>=p_date_from)
      and (p_date_to is null or c.latest_notice_date<=p_date_to)
      and (p_location='' or
           (d.details->>'location' is not null and
             position(lower(trim(p_location)) in lower(d.details->>'location'))>0))
      and (p_method='' or
           (d.details->>'tender_method' is not null and
             position(lower(trim(p_method)) in lower(d.details->>'tender_method'))>0))
      and (not p_deadline_only or
        (c.deadline_at is not null and c.deadline_at>now()
         and (c.latest_notice_type like '%招標%'
           or c.latest_notice_type like '%更正%'
           or c.latest_notice_type like '%徵求%')))
   ),
   filtered as (
    select * from matched m
    where (
       coalesce(cardinality(p_terms),0)=0
       or (p_any and exists(
         select 1 from unnest(p_terms) term
         where position(lower(trim(term)) in lower(m.searchable))>0))
       or (not p_any and not exists(
         select 1 from unnest(p_terms) term
         where position(lower(trim(term)) in lower(m.searchable))=0))
    )
    and not exists(
      select 1 from unnest(coalesce(p_exclude,array[]::text[])) term
      where position(lower(trim(term)) in lower(m.searchable))>0
    )
   ),
   sliced as (
     select id,unit_id,job_number,title,agency,category,group_name,
      latest_notice_type,latest_notice_date,latest_filename,budget_amount,
      award_amount,official_url,deadline_at,source_fetched_at,
      verified_location,verified_tender_method
     from filtered
     order by
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
revoke all on function public.ti_archive_search(text[],text[],boolean,text,text,text,text,text,numeric,numeric,integer,integer,boolean,text,integer,integer) from public;
grant execute on function public.ti_archive_search(text[],text[],boolean,text,text,text,text,text,numeric,numeric,integer,integer,boolean,text,integer,integer) to anon,authenticated;

create index if not exists ti_cases_latest_date_search on public.ti_cases(latest_notice_date desc,id);
create index if not exists ti_notices_by_case_date on public.ti_notices(case_id,source_date desc);
comment on function public.ti_archive_search(text[],text[],boolean,text,text,text,text,text,numeric,numeric,integer,integer,boolean,text,integer,integer)
 is 'F02/F03: real collected tender search only. Uses security invoker, fixed predicates, server pagination.';

