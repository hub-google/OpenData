-- F02: unify 台/臺 in the archived AND / OR / NOT search and agency / location filters.
-- Preserve original stored spelling and all existing result columns.
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
         where position(lower(replace(trim(term),'臺','台')) in lower(replace(m.searchable,'臺','台')))>0))
       or (not p_any and not exists(
         select 1 from unnest(p_terms) term
         where position(lower(replace(trim(term),'臺','台')) in lower(replace(m.searchable,'臺','台')))=0))
    )
    and not exists(
      select 1 from unnest(coalesce(p_exclude,array[]::text[])) term
      where position(lower(replace(trim(term),'臺','台')) in lower(replace(m.searchable,'臺','台')))>0
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


-- Enrich source-verifiable details separately from daily and historical notice ingestion.
-- No visitor can read or manipulate the internal retry queue.
create table if not exists public.ti_detail_enrichment_attempts(
 case_id text primary key references public.ti_cases(id) on delete cascade,
 attempts integer not null default 0 check(attempts between 0 and 1000),
 last_attempt_at timestamptz,
 next_retry_at timestamptz not null default now(),
 last_error text,
 success_at timestamptz
);
alter table public.ti_detail_enrichment_attempts enable row level security;
revoke all on public.ti_detail_enrichment_attempts from public, anon, authenticated;
grant select, insert, update, delete on public.ti_detail_enrichment_attempts to service_role;
create index if not exists ti_detail_attempts_due on public.ti_detail_enrichment_attempts(next_retry_at);

create or replace function public.ti_pick_details_enrichment(p_limit integer default 6)
returns table(case_id text, unit_id text, job_number text, latest_notice_date integer, latest_notice_type text, latest_filename text)
language sql stable security invoker set search_path='' as $$
 select c.id,c.unit_id,c.job_number,c.latest_notice_date,c.latest_notice_type,c.latest_filename
 from public.ti_cases c
 left join public.ti_case_details d on d.case_id=c.id
 left join public.ti_detail_enrichment_attempts a on a.case_id=c.id
 where (d.case_id is null or d.latest_notice_id is distinct from
           (c.id||'::'||c.latest_notice_date::text||'::'||coalesce(c.latest_filename,'')))
   and (a.next_retry_at is null or a.next_retry_at<=now())
   and length(c.unit_id) between 1 and 80 and length(c.job_number) between 1 and 100
 order by
  case when coalesce(c.latest_notice_type,'') ~ '(招標|徵求|更正|取得報價)' then 0 else 1 end,
  c.latest_notice_date desc,c.id asc
 limit least(greatest(coalesce(p_limit,6),1),12)
$$;
revoke all on function public.ti_pick_details_enrichment(integer) from public,anon,authenticated;
grant execute on function public.ti_pick_details_enrichment(integer) to service_role;

-- Homepage KPIs: exact definitions, do not equate an unknown deadline with "closed".
create or replace function public.ti_home_kpis()
returns jsonb language sql stable security invoker set search_path='' as $$
 with last_day as (select max(source_date) as d from public.ti_notices),
 counts as (
  select count(*) as all_cases,
   count(*) filter(where deadline_at is not null) as deadline_known,
   count(*) filter(where deadline_at>now()
     and coalesce(latest_notice_type,'') ~ '(招標|徵求|取得報價)'
     and coalesce(latest_notice_type,'') !~ '(決標|無法決標)') as verified_open,
   count(*) filter(where deadline_at>now() and deadline_at<=now()+interval '3 days'
     and coalesce(latest_notice_type,'') ~ '(招標|徵求|取得報價)'
     and coalesce(latest_notice_type,'') !~ '(決標|無法決標)') as due_soon,
   count(*) filter(where latest_notice_type like '%無法決標%') as failed,
   count(*) filter(where deadline_at is null and
     coalesce(latest_notice_type,'') ~ '(招標|徵求|取得報價)'
     and coalesce(latest_notice_type,'') !~ '(決標|無法決標)') as active_unknown,
   count(*) filter(where budget_amount is not null) as budget_known
  from public.ti_cases
 )
 select jsonb_build_object(
  'latest_publication_day',(select d from last_day),
  'latest_notice_count',(select count(*) from public.ti_notices n where n.source_date=(select d from last_day)),
  'total_cases',c.all_cases,
  'verified_open',c.verified_open,'due_soon',c.due_soon,
  'failed',c.failed,'deadline_known',c.deadline_known,
  'active_unknown_deadline',c.active_unknown,'budget_known',c.budget_known,
  'last_success_at',(select last_success_at from public.ti_sources where id='openfun-pcc'),
  'unresolved_source_dates',(select count(*) from public.ti_backfill_gaps where resolved_at is null)
 ) from counts c
$$;
revoke all on function public.ti_home_kpis() from public;
grant execute on function public.ti_home_kpis() to anon,authenticated;

-- F11: related cases have the SAME original agency ID and procurement group.
-- This is a factual list, not a model-generated claim that contracts are linked.
create or replace function public.ti_related_cases(p_case_id text)
returns jsonb language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(r) order by r.latest_notice_date desc,r.id),'[]'::jsonb)
 from (
  select c.id,c.unit_id,c.job_number,c.title,c.agency,c.group_name,
         c.latest_notice_date,c.latest_notice_type,c.budget_amount,c.award_amount
  from public.ti_cases c
  join public.ti_cases selected on selected.id=p_case_id
  where c.unit_id=selected.unit_id and c.group_name=selected.group_name
    and c.id<>selected.id and length(p_case_id)<=180
  order by c.latest_notice_date desc,c.id
  limit 8
 ) r
$$;
revoke all on function public.ti_related_cases(text) from public;
grant execute on function public.ti_related_cases(text) to anon,authenticated;

-- Every 10 minutes: at most six original source detail requests per run.
-- Uses the existing Vault cron credential; never publishes it to GitHub or the browser.
select cron.schedule('ti_pcc_detail_enrichment','7,17,27,37,47,57 * * * *',$job$
 select net.http_post(
  url:='https://unapiwajmgqqtdkixaab.supabase.co/functions/v1/ti-ingest',
  headers:=jsonb_build_object('Content-Type','application/json',
    'x-ti-cron',(select decrypted_secret from vault.decrypted_secrets where name='ti_pcc_ingest_token')),
  body:='{"mode":"details"}'::jsonb,
  timeout_milliseconds:=120000
 );
$job$);
