-- PRD F02/F05 / non-functional p95: materialize source-derived search text once.
-- All values are derived from public ti_cases + ti_notices, never modelled.
create table if not exists public.ti_case_search_index(
 case_id text primary key references public.ti_cases(id) on delete cascade,
 searchable text not null,
 indexed_at timestamptz not null default now()
);
alter table public.ti_case_search_index enable row level security;
revoke all on public.ti_case_search_index from public,anon,authenticated;
grant select on public.ti_case_search_index to anon,authenticated;
grant all on public.ti_case_search_index to service_role;
create policy ti_search_index_public_read on public.ti_case_search_index
 for select to anon,authenticated using(true);

create or replace function public.ti_refresh_case_search(p_case_ids text[])
returns integer language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 if p_case_ids is null or cardinality(p_case_ids)<1 or cardinality(p_case_ids)>250
 then raise exception 'case ID batch must contain 1–250 items' using errcode='22023';end if;
 with keys as (select distinct unnest(p_case_ids) as id),
 vendors as (
   select n.case_id,string_agg(concat_ws(' ',
       array_to_string(n.company_names,' '),
       array_to_string(n.company_ids,' ')),' ') as companies
   from public.ti_notices n join keys k on k.id=n.case_id
   group by n.case_id
 )
 insert into public.ti_case_search_index(case_id,searchable,indexed_at)
 select c.id,lower(replace(concat_ws(' ',c.title,c.agency,c.job_number,c.category,
   coalesce(v.companies,'')),'臺','台')),now()
 from keys k join public.ti_cases c on c.id=k.id
 left join vendors v on v.case_id=c.id
 on conflict(case_id) do update set
   searchable=excluded.searchable,indexed_at=excluded.indexed_at;
 get diagnostics n=row_count;
 return n;
end $$;
revoke all on function public.ti_refresh_case_search(text[]) from public,anon,authenticated;
grant execute on function public.ti_refresh_case_search(text[]) to service_role;

-- Initial one-time indexing of the full existing real notice archive.
with vendors as (
 select n.case_id,string_agg(concat_ws(' ',
   array_to_string(n.company_names,' '),
   array_to_string(n.company_ids,' ')),' ') as companies
 from public.ti_notices n group by n.case_id
)
insert into public.ti_case_search_index(case_id,searchable,indexed_at)
select c.id,lower(replace(concat_ws(' ',c.title,c.agency,c.job_number,c.category,
   coalesce(v.companies,'')),'臺','台')),now()
from public.ti_cases c
left join vendors v on v.case_id=c.id
on conflict(case_id) do update set searchable=excluded.searchable,indexed_at=excluded.indexed_at;

-- Repair only missing rows after an unexpected ingestion interruption.
create or replace function public.ti_backfill_missing_case_search(p_limit integer default 100)
returns integer language plpgsql security definer set search_path='' as $$
declare count_new integer;
begin
 if p_limit<1 or p_limit>250 then raise exception 'limit must be 1–250';end if;
 select public.ti_refresh_case_search(array_agg(id)) into count_new
 from (
  select c.id from public.ti_cases c
  left join public.ti_case_search_index i on i.case_id=c.id
  where i.case_id is null
  order by c.latest_notice_date desc,c.id limit p_limit
 ) missing;
 return coalesce(count_new,0);
end $$;
revoke all on function public.ti_backfill_missing_case_search(integer) from public,anon,authenticated;
grant execute on function public.ti_backfill_missing_case_search(integer) to service_role;
select cron.schedule('ti_search_index_repair','11,41 * * * *',$job$
 select public.ti_backfill_missing_case_search(100);
$job$);
