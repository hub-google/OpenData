-- U09: AI jobs are idempotent per user/task/source fingerprint.
-- Only a successfully completed job consumes the daily success quota.
alter table public.ti_ai_jobs add column if not exists request_hash text;
alter table public.ti_ai_jobs add column if not exists claimed_at timestamptz;
alter table public.ti_ai_jobs add column if not exists retry_count integer not null default 0 check(retry_count between 0 and 3);
create unique index if not exists ti_ai_unique_request
 on public.ti_ai_jobs(user_id,task_type,request_hash)
 where request_hash is not null;
create index if not exists ti_ai_success_quota
 on public.ti_ai_jobs(user_id,finished_at desc) where state='success';

create or replace function public.ti_reserve_ai_job(
 p_user uuid,p_task_type text,p_case_id text,p_document_name text,p_request_hash text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare existing public.ti_ai_jobs%rowtype; valid_count int; new_id uuid;
begin
 if p_user is null or not exists(select 1 from auth.users where id=p_user)
  or p_task_type not in ('qualification_check','proposal_check')
  or p_request_hash !~ '^[0-9a-f]{64}$'
  or char_length(coalesce(p_document_name,'')) not between 1 and 250
  or length(coalesce(p_case_id,''))>190
 then raise exception 'invalid AI reservation input' using errcode='22023'; end if;
 -- Serializes quota checks for all model types belonging to the same account.
 perform 1 from auth.users where id=p_user for update;
 select * into existing from public.ti_ai_jobs
 where user_id=p_user and task_type=p_task_type and request_hash=p_request_hash
 for update;
 if found then
  if existing.state='success' then
   return jsonb_build_object('state','cached','job_id',existing.id,
     'model',existing.provider_model,'output',existing.output);
  elsif existing.state='pending' and
     existing.claimed_at>now()-interval '6 minutes' then
   return jsonb_build_object('state','processing','job_id',existing.id);
  elsif existing.retry_count>=3 then
   return jsonb_build_object('state','retry_limit','job_id',existing.id);
  end if;
 end if;
 select count(*) into valid_count from public.ti_ai_jobs
 where user_id=p_user and state='success'
 and finished_at>now()-interval '24 hours';
 if valid_count>=20 then
  return jsonb_build_object('state','quota_exhausted','successes_24h',valid_count);
 end if;
 if existing.id is not null then
  update public.ti_ai_jobs set state='pending',claimed_at=now(),
   retry_count=retry_count+1,created_at=now(),finished_at=null,
   provider_model=null,error_summary=null,output=null
  where id=existing.id returning id into new_id;
 else
  insert into public.ti_ai_jobs(user_id,case_id,document_name,task_type,
    request_hash,state,claimed_at,retry_count)
  values(p_user,nullif(p_case_id,''),p_document_name,p_task_type,
    p_request_hash,'pending',now(),0)
  returning id into new_id;
 end if;
 return jsonb_build_object('state','claimed','job_id',new_id,
    'successes_24h',valid_count);
end $$;
revoke all on function public.ti_reserve_ai_job(uuid,text,text,text,text)
 from public,anon,authenticated;
grant execute on function public.ti_reserve_ai_job(uuid,text,text,text,text)
 to service_role;
