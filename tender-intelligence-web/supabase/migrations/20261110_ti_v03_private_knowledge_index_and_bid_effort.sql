
-- W08: private, attributable preparation time and costs; no inferred bids or wages.
create table if not exists public.ti_bid_effort_entries(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  case_id text not null references public.ti_cases(id) on delete cascade,
  work_day date not null default (now() at time zone 'Asia/Taipei')::date,
  category text not null check (category in ('資格審查','技術規劃','標書撰寫','詢價與報價','內部會議','送件與行政','其他')),
  hours numeric(7,2) not null default 0 check (hours>=0 and hours<=24),
  cash_cost numeric(14,2) not null default 0 check(cash_cost>=0 and cash_cost<=1000000000),
  hourly_rate numeric(12,2) check (hourly_rate is null or (hourly_rate>=0 and hourly_rate<=1000000)),
  note text not null default '' check(char_length(note)<=1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ti_bid_effort_nonzero check (hours>0 or cash_cost>0)
);
alter table public.ti_bid_effort_entries enable row level security;
drop policy if exists ti_bid_effort_self on public.ti_bid_effort_entries;
create policy ti_bid_effort_self on public.ti_bid_effort_entries
 for all to authenticated
 using (user_id=(select auth.uid()))
 with check (user_id=(select auth.uid()));
revoke all on public.ti_bid_effort_entries from anon;
grant select,insert,update,delete on public.ti_bid_effort_entries to authenticated;
create index if not exists ti_bid_effort_user_case_day
 on public.ti_bid_effort_entries(user_id,case_id,work_day desc);

-- W07: local page extraction preserved privately, with a reusable server index.
alter table public.ti_documents
 add column if not exists search_text text,
 add column if not exists indexed_at timestamptz;
alter table public.ti_documents
 drop constraint if exists ti_documents_search_text_cap;
alter table public.ti_documents
 add constraint ti_documents_search_text_cap
 check(search_text is null or char_length(search_text)<=150000);
create index if not exists ti_documents_owner_case_idx
 on public.ti_documents(user_id,case_id,created_at desc);
create index if not exists ti_documents_private_text_trgm
 on public.ti_documents using gin(search_text extensions.gin_trgm_ops)
 where search_text is not null;

create or replace function public.ti_private_knowledge_search(
 p_query text,p_case_id text default null,p_limit int default 40
)
returns table(document_id uuid,filename text,case_id text,source_label text,excerpt text)
language sql stable security invoker set search_path='pg_catalog','public'
as $function$
 with validated as (
   select lower(replace(trim(coalesce(p_query,'')),'臺','台')) as needle,
          replace(replace(replace(lower(replace(trim(coalesce(p_query,'')),'臺','台')),'!','!!'),'%','!%'),'_','!_') as escaped
   where char_length(trim(coalesce(p_query,''))) between 2 and 80
     and p_limit between 1 and 100
 ), pages as (
   select d.id,d.filename,d.case_id,d.created_at,
          e.value->>'source' as source_label,
          e.value->>'text' as page_text,
          v.needle
   from validated v
   join public.ti_documents d on d.user_id=(select auth.uid())
     and (p_case_id is null or d.case_id=p_case_id)
     and d.search_text ilike '%'||v.escaped||'%' escape '!'
   cross join lateral jsonb_array_elements(
     case when jsonb_typeof(d.extracted->'pages')='array'
       then d.extracted->'pages' else '[]'::jsonb end
   ) e
   where e.value ? 'text'
     and strpos(lower(replace(e.value->>'text','臺','台')),v.needle)>0
 )
 select p.id,p.filename,p.case_id,coalesce(p.source_label,'原文段落'),
        substring(p.page_text from greatest(1,
          strpos(lower(replace(p.page_text,'臺','台')),p.needle)-75) for 240)
 from pages p
 order by p.created_at desc,p.id,p.source_label
 limit least(greatest(coalesce(p_limit,40),1),100);
$function$;
revoke all on function public.ti_private_knowledge_search(text,text,integer) from public,anon,authenticated;
grant execute on function public.ti_private_knowledge_search(text,text,integer) to authenticated,service_role;
