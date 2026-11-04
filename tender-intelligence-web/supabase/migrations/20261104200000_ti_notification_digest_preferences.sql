-- PRD U04/U05/U07: user-selected digest hour, LINE frequency, urgent notices and stable daily batches.
alter table public.ti_delivery_settings
 add column if not exists email_hour smallint not null default 8 check (email_hour between 0 and 23),
 add column if not exists line_hour smallint not null default 8 check (line_hour between 0 and 23),
 add column if not exists line_frequency text not null default 'daily'
   check(line_frequency in ('daily','immediate')),
 add column if not exists line_urgent_immediate boolean not null default true;

create table if not exists public.ti_digest_batches(
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 channel text not null check(channel in ('email','line')),
 digest_date date not null,
 notification_ids bigint[] not null check(cardinality(notification_ids) between 1 and 20),
 status text not null default 'processing' check(status in ('processing','failed','sent','dead')),
 attempts integer not null default 1 check(attempts between 1 and 3),
 last_attempt_at timestamptz not null default now(),
 delivered_at timestamptz,
 provider_id text,
 error_summary text,
 unique(user_id,channel,digest_date)
);
create index if not exists ti_digest_retry_idx on public.ti_digest_batches(status,last_attempt_at);
alter table public.ti_digest_batches enable row level security;
revoke all on public.ti_digest_batches from public,anon,authenticated;
grant select on public.ti_digest_batches to authenticated;
grant all on public.ti_digest_batches to service_role;
create policy ti_digest_owner_read on public.ti_digest_batches for select to authenticated
 using((select auth.uid())=user_id);

-- Immediate deliveries only. Daily dispatch is separately batched and idempotent.
create or replace function public.ti_claim_deliveries(
 p_limit integer default 30,
 p_email_ready boolean default false,
 p_line_ready boolean default false,
 p_digest_hour boolean default false
) returns table (
 notification_id bigint,user_id uuid,channel text,recipient text,
 subject text,reason text,case_id text,agency text,job_number text
)
language sql security definer set search_path='' as $$
 with elig as (
  select n.id as notification_id,n.user_id,n.reason,n.case_id,
     c.title as subject,c.agency,c.job_number,
     opt.channel,
     case opt.channel when 'email' then a.email else ln.line_user_id end as recipient,
     row_number() over (partition by n.user_id,opt.channel order by
       case when n.reason like '截標提醒 T-1%' or n.reason like '截標時間異動%' then 0 else 1 end,
       n.created_at asc,n.id asc) as rn
  from public.ti_notifications n
  join public.ti_cases c on c.id=n.case_id
  join public.ti_delivery_settings pref on pref.user_id=n.user_id
  join auth.users a on a.id=n.user_id
  left join public.ti_line_links ln on ln.user_id=n.user_id
  cross join lateral (values('email'),('line')) opt(channel)
  left join public.ti_delivery_attempts at
    on at.notification_id=n.id and at.channel=opt.channel
  where n.created_at>now()-interval '7 days'
   and ((opt.channel='email' and p_email_ready and pref.email_enabled
      and not pref.daily_digest and a.email_confirmed_at is not null)
    or (opt.channel='line' and p_line_ready and pref.line_enabled
      and ln.line_user_id is not null
      and (pref.line_frequency='immediate'
        or (pref.line_urgent_immediate
         and (n.reason like '截標提醒 T-1%' or n.reason like '截標時間異動%')))))
   and (at.notification_id is null
      or (at.status='failed' and at.attempts<3 and at.last_attempt_at<now()-interval '15 minutes')
      or (at.status='processing' and at.attempts<3 and at.last_attempt_at<now()-interval '5 minutes'))
 ), chosen as (
  select * from elig where rn<=20 and recipient is not null
  order by rn,notification_id
  limit least(greatest(coalesce(p_limit,30),1),60)
 ), reserved as (
  insert into public.ti_delivery_attempts(notification_id,user_id,channel,status,attempts,last_attempt_at)
  select n.notification_id,n.user_id,n.channel,'processing',1,now() from chosen n
  on conflict(notification_id,channel) do update set
    status='processing',attempts=public.ti_delivery_attempts.attempts+1,last_attempt_at=now()
   where public.ti_delivery_attempts.attempts<3 and
    ((public.ti_delivery_attempts.status='failed' and public.ti_delivery_attempts.last_attempt_at<now()-interval '15 minutes')
     or (public.ti_delivery_attempts.status='processing' and public.ti_delivery_attempts.last_attempt_at<now()-interval '5 minutes'))
  returning notification_id,user_id,channel
 )
 select r.notification_id,r.user_id,r.channel,c.recipient,
  c.subject,c.reason,c.case_id,c.agency,c.job_number
 from reserved r join chosen c using(notification_id,user_id,channel)
 order by r.notification_id,r.channel
$$;
revoke all on function public.ti_claim_deliveries(integer,boolean,boolean,boolean)
 from public,anon,authenticated;
grant execute on function public.ti_claim_deliveries(integer,boolean,boolean,boolean) to service_role;

-- Stable per-user/day daily digest snapshots; a failed provider request reuses the same batch ID.
create or replace function public.ti_claim_digest_batches(
 p_email_ready boolean default false,p_line_ready boolean default false,p_limit integer default 12
) returns table(batch_id uuid,user_id uuid,channel text,recipient text,
 notifications jsonb,attempts integer)
language plpgsql security definer set search_path='' as $$
declare ids uuid[];
begin
 if p_limit<1 or p_limit>30 then raise exception 'invalid batch limit'; end if;

 -- Attempt-limited stale leases are final failures, never resent indefinitely.
 with dead as (
  update public.ti_digest_batches b set status='dead',error_summary='Delivery lease expired after three attempts'
  where status='processing' and attempts>=3 and last_attempt_at<now()-interval '5 minutes'
  returning b.*
 )
 insert into public.ti_delivery_attempts(
  notification_id,user_id,channel,status,attempts,last_attempt_at,error_summary)
 select n.id,d.user_id,d.channel,'dead',d.attempts,now(),d.error_summary
 from dead d join public.ti_notifications n on n.id=any(d.notification_ids)
 on conflict(notification_id,channel) do update
 set status='dead',attempts=greatest(public.ti_delivery_attempts.attempts,excluded.attempts),
   last_attempt_at=now(),error_summary=excluded.error_summary
 where public.ti_delivery_attempts.status<>'sent';

 -- Retry the already-fixed notification cohort.
 with retry_ids as (
   select id from public.ti_digest_batches
   where status in ('failed','processing')
    and attempts<3
    and last_attempt_at<
      now()-case when status='failed' then interval '15 minutes' else interval '5 minutes' end
   order by last_attempt_at,id
   for update skip locked
   limit p_limit
 ), reclaimed as (
   update public.ti_digest_batches b
   set status='processing',attempts=attempts+1,last_attempt_at=now()
   from retry_ids r where b.id=r.id returning b.id
 )
 select array_agg(id) into ids from reclaimed;

 -- Create at most one daily digest for each user/channel/date, with up to 20 events.
 with due as (
  select p.user_id,'email'::text as channel from public.ti_delivery_settings p
  join auth.users a on a.id=p.user_id
  where p.email_enabled and p.daily_digest and p_email_ready and a.email_confirmed_at is not null
   and p.email_hour=extract(hour from now() at time zone 'Asia/Taipei')::integer
  union all
  select p.user_id,'line'::text as channel from public.ti_delivery_settings p
  join public.ti_line_links l on l.user_id=p.user_id
  where p.line_enabled and p.line_frequency='daily' and p_line_ready
   and p.line_hour=extract(hour from now() at time zone 'Asia/Taipei')::integer
 ), available as (
  select d.user_id,d.channel,n.id,
   row_number() over(partition by d.user_id,d.channel order by n.created_at,n.id) rn
  from due d join public.ti_notifications n on n.user_id=d.user_id
  left join public.ti_delivery_attempts at on at.notification_id=n.id and at.channel=d.channel
  where n.created_at>now()-interval '7 days'
    and at.notification_id is null
    and not exists(
      select 1 from public.ti_digest_batches b where b.user_id=d.user_id and b.channel=d.channel
      and n.id=any(b.notification_ids)
    )
 ), cohorts as (
  select user_id,channel,array_agg(id order by rn) as notification_ids
  from available where rn<=20 group by user_id,channel
  order by user_id,channel
  limit p_limit
 ), created as (
  insert into public.ti_digest_batches(user_id,channel,digest_date,notification_ids)
  select user_id,channel,(now() at time zone 'Asia/Taipei')::date,notification_ids from cohorts
  on conflict(user_id,channel,digest_date) do nothing
  returning id
 )
 select coalesce(ids,'{}'::uuid[])||coalesce(array_agg(id),'{}'::uuid[])
 into ids from created;

 return query
 select b.id,b.user_id,b.channel,
    case b.channel when 'email' then a.email else ln.line_user_id end as recipient,
    (select coalesce(jsonb_agg(jsonb_build_object(
      'notification_id',n.id,'user_id',n.user_id,'reason',n.reason,'case_id',n.case_id,
      'subject',c.title,'agency',c.agency,'job_number',c.job_number) order by n.created_at,n.id),'[]'::jsonb)
     from public.ti_notifications n join public.ti_cases c on c.id=n.case_id
     where n.id=any(b.notification_ids)) as notifications,
    b.attempts
 from public.ti_digest_batches b
 join public.ti_delivery_settings p on p.user_id=b.user_id
 join auth.users a on a.id=b.user_id
 left join public.ti_line_links ln on ln.user_id=b.user_id
 where b.id=any(coalesce(ids,'{}'::uuid[]))
  and ((b.channel='email' and p.email_enabled and a.email_confirmed_at is not null and p_email_ready)
    or (b.channel='line' and p.line_enabled and ln.line_user_id is not null and p_line_ready))
 order by b.last_attempt_at,b.id;
end $$;
revoke all on function public.ti_claim_digest_batches(boolean,boolean,integer) from public,anon,authenticated;
grant execute on function public.ti_claim_digest_batches(boolean,boolean,integer) to service_role;

create or replace function public.ti_finish_digest_batch(
 p_batch uuid,p_status text,p_provider text default '',p_error text default ''
) returns void language plpgsql security definer set search_path='' as $$
declare b public.ti_digest_batches%rowtype; final_status text;
begin
 if p_status not in ('sent','failed') then raise exception 'Invalid provider status';end if;
 select * into b from public.ti_digest_batches where id=p_batch for update;
 if b.id is null or b.status<>'processing' then raise exception 'Digest not in processing state';end if;
 final_status:=case when p_status='sent' then 'sent'
   when b.attempts>=3 then 'dead' else 'failed' end;
 update public.ti_digest_batches
 set status=final_status,delivered_at=case when p_status='sent' then now() end,
     provider_id=left(p_provider,200),error_summary=left(p_error,350),
     last_attempt_at=now() where id=p_batch;
 insert into public.ti_delivery_attempts(notification_id,user_id,channel,status,attempts,
    last_attempt_at,delivered_at,provider_id,error_summary)
 select n.id,b.user_id,b.channel,final_status,b.attempts,now(),
  case when p_status='sent' then now() end,left(p_provider,200),left(p_error,350)
 from public.ti_notifications n where n.id=any(b.notification_ids)
 on conflict(notification_id,channel) do update
 set status=excluded.status,attempts=excluded.attempts,last_attempt_at=now(),
     delivered_at=excluded.delivered_at,provider_id=excluded.provider_id,error_summary=excluded.error_summary
 where public.ti_delivery_attempts.status<>'sent';
end $$;
revoke all on function public.ti_finish_digest_batch(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.ti_finish_digest_batch(uuid,text,text,text) to service_role;
