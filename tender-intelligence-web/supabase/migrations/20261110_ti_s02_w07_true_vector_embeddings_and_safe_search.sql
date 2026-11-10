
-- S02/W07 true vector storage; embeddings are never inferred from keyword overlap.
create extension if not exists vector with schema extensions;
create table if not exists public.ti_case_vectors (
 case_id text primary key references public.ti_cases(id) on delete cascade,
 embedding extensions.vector(1536) not null,
 model text not null default 'text-embedding-3-small',
 notice_date integer,
 source_sha256 text not null,
 indexed_at timestamptz not null default now()
);
alter table public.ti_case_vectors enable row level security;
drop policy if exists ti_case_vectors_read on public.ti_case_vectors;
create policy ti_case_vectors_read on public.ti_case_vectors
 for select to anon,authenticated using (true);
revoke all on public.ti_case_vectors from public,anon,authenticated;
grant select on public.ti_case_vectors to anon,authenticated;
create index if not exists ti_case_vectors_hnsw on public.ti_case_vectors
 using hnsw (embedding extensions.vector_cosine_ops);

create table if not exists public.ti_document_vectors (
 id uuid primary key default gen_random_uuid(),
 document_id uuid not null references public.ti_documents(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 case_id text,
 source_label text not null check(length(source_label)<=160),
 excerpt text not null check(length(excerpt) between 10 and 2200),
 source_sha256 text not null,
 embedding extensions.vector(1536) not null,
 model text not null default 'text-embedding-3-small',
 indexed_at timestamptz not null default now(),
 unique(document_id,source_sha256)
);
alter table public.ti_document_vectors enable row level security;
drop policy if exists ti_document_vectors_owner_read on public.ti_document_vectors;
create policy ti_document_vectors_owner_read on public.ti_document_vectors
 for select to authenticated
 using(user_id=(select auth.uid()) and
   ((select auth.jwt())->>'is_anonymous') is distinct from 'true');
revoke all on public.ti_document_vectors from public,anon,authenticated;
grant select on public.ti_document_vectors to authenticated;
create index if not exists ti_document_vectors_owner_case
 on public.ti_document_vectors(user_id,case_id);
create index if not exists ti_document_vectors_hnsw on public.ti_document_vectors
 using hnsw (embedding extensions.vector_cosine_ops);

create table if not exists public.ti_semantic_usage(
 user_id uuid not null references auth.users(id) on delete cascade,
 usage_date date not null,
 request_count integer not null default 0,
 updated_at timestamptz not null default now(),
 primary key(user_id,usage_date),
 check (request_count>=0)
);
alter table public.ti_semantic_usage enable row level security;
revoke all on public.ti_semantic_usage from public,anon,authenticated;

create or replace function public.ti_take_semantic_quota(p_user uuid,p_limit integer default 30)
returns boolean language plpgsql security definer set search_path=''
as $function$
declare n integer;
begin
 if p_user is null or p_limit not between 1 and 100 then return false;end if;
 insert into public.ti_semantic_usage(user_id,usage_date,request_count)
 values(p_user,(now() at time zone 'Asia/Taipei')::date,1)
 on conflict(user_id,usage_date)
 do update set request_count=public.ti_semantic_usage.request_count+1,
  updated_at=now()
 where public.ti_semantic_usage.request_count<p_limit
 returning request_count into n;
 return n is not null;
end $function$;
revoke all on function public.ti_take_semantic_quota(uuid,integer) from public,anon,authenticated;
grant execute on function public.ti_take_semantic_quota(uuid,integer) to service_role;

create or replace function public.ti_search_semantic_cases(
 p_embedding extensions.vector(1536),
 p_limit integer default 20,
 p_group text default '',
 p_only_open boolean default false)
returns table(case_id text,title text,agency text,notice_type text,
 budget numeric,deadline_at timestamptz,source_url text,
 source_fetched_at timestamptz,similarity double precision)
language plpgsql stable security invoker set search_path='pg_catalog','public','extensions'
as $function$
begin
 if p_limit not between 1 and 30 or
  p_group not in ('','工程','財物','勞務','未分類')
 then raise exception 'Invalid semantic search filters';end if;
 return query
 select c.id,c.title,c.agency,c.latest_notice_type,c.budget_amount,
        c.deadline_at,c.official_url,c.source_fetched_at,
        (1-(v.embedding <=> p_embedding))::double precision as similarity
 from public.ti_case_vectors v
 join public.ti_cases c on c.id=v.case_id
 where (p_group='' or c.group_name=p_group)
   and (not p_only_open or (public.ti_case_stage(c.latest_notice_type)='招標'
      and c.deadline_at>now()))
 order by v.embedding <=> p_embedding,c.id
 limit p_limit;
end $function$;
revoke all on function public.ti_search_semantic_cases(extensions.vector,integer,text,boolean) from public,anon,authenticated;
grant execute on function public.ti_search_semantic_cases(extensions.vector,integer,text,boolean) to anon,authenticated,service_role;

create or replace function public.ti_search_semantic_documents(
 p_embedding extensions.vector(1536),p_case_id text default null,p_limit integer default 10)
returns table(document_id uuid,filename text,source_label text,excerpt text,
 similarity double precision)
language plpgsql stable security invoker set search_path='pg_catalog','public','extensions'
as $function$
begin
 if (select auth.uid()) is null or p_limit not between 1 and 20
 then raise exception 'Authentication and valid limit required';end if;
 return query
 select d.document_id,f.filename,d.source_label,d.excerpt,
   (1-(d.embedding <=> p_embedding))::double precision
 from public.ti_document_vectors d
 join public.ti_documents f on f.id=d.document_id
 where d.user_id=(select auth.uid())
   and (p_case_id is null or d.case_id=p_case_id)
 order by d.embedding <=> p_embedding,d.id limit p_limit;
end $function$;
revoke all on function public.ti_search_semantic_documents(extensions.vector,text,integer) from public,anon,authenticated;
grant execute on function public.ti_search_semantic_documents(extensions.vector,text,integer) to authenticated,service_role;

create or replace function public.ti_semantic_case_index_candidates(p_limit integer default 24)
returns table(case_id text,title text,agency text,group_name text,
 latest_notice_type text,notice_date integer)
language sql stable security invoker set search_path='pg_catalog','public'
as $function$
 select c.id,c.title,c.agency,c.group_name,c.latest_notice_type,c.latest_notice_date
 from public.ti_cases c
 left join public.ti_case_vectors v on v.case_id=c.id
 where (v.case_id is null or v.notice_date is distinct from c.latest_notice_date)
   and c.latest_notice_date >= to_char((now() at time zone 'Asia/Taipei')::date-interval '45 days','YYYYMMDD')::integer
   and c.title is not null and length(c.title)>=4
 order by c.latest_notice_date desc,c.id
 limit least(greatest(coalesce(p_limit,24),1),40);
$function$;
revoke all on function public.ti_semantic_case_index_candidates(integer) from public,anon,authenticated;
grant execute on function public.ti_semantic_case_index_candidates(integer) to service_role;
