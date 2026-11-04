-- PRD U06 / acceptance 14.1: corrections supersede pending reminders but retain history.
alter table public.ti_notifications
 add column if not exists stale_at timestamptz,
 add column if not exists stale_reason text;
create index if not exists ti_notify_active_queue
 on public.ti_notifications(user_id,created_at desc) where stale_at is null;

create or replace function public.ti_record_deadline_change()
returns trigger language plpgsql security definer set search_path='' as $$
declare latest record;rule record;reason_text text;
begin
 if old.deadline_at is not distinct from new.deadline_at then return new;end if;
 update public.ti_notifications
 set stale_at=now(),stale_reason='來源已更新截止時間'
 where case_id=new.id and stale_at is null and reason like '截標提醒 T-%';

 -- Historical/newly enriched records do not create alerts for expired or old cases.
 if new.deadline_at is null or new.deadline_at<=now() then return new;end if;
 select n.id,n.source_date,n.fetched_at into latest
 from public.ti_notices n where n.case_id=new.id
 order by n.source_date desc,n.filename desc limit 1;
 if latest.id is null or latest.source_date<
    to_char((now() at time zone 'Asia/Taipei')::date-30,'YYYYMMDD')::integer
 then return new;end if;
 reason_text:=case when old.deadline_at is null then
  '取得官方截止時間：'||to_char(new.deadline_at at time zone 'Asia/Taipei','YYYY-MM-DD HH24:MI')
 else
  '截標時間異動：'||to_char(old.deadline_at at time zone 'Asia/Taipei','YYYY-MM-DD HH24:MI')||
  ' → '||to_char(new.deadline_at at time zone 'Asia/Taipei','YYYY-MM-DD HH24:MI') end;
 for rule in
  select r.* from public.ti_watch_rules r where r.enabled=true
   and r.created_at<=latest.fetched_at
   and to_char(r.created_at at time zone 'Asia/Taipei','YYYYMMDD')::integer<=latest.source_date
 loop
  if rule.agency_id is not null and rule.agency_id<>'' and rule.agency_id<>new.unit_id then continue;end if;
  if rule.group_name is not null and rule.group_name<>'' and rule.group_name<>new.group_name then continue;end if;
  if (rule.min_budget is not null and (new.budget_amount is null or new.budget_amount<rule.min_budget))
    or (rule.max_budget is not null and (new.budget_amount is null or new.budget_amount>rule.max_budget))
  then continue;end if;
  if not exists(select 1 from unnest(regexp_split_to_array(lower(rule.keywords),'[,，、[:space:]]+')) term
      where length(term)>0 and strpos(lower(replace(new.title,'臺','台')),replace(term,'臺','台'))>0)
  then continue;end if;
  if exists(select 1 from unnest(regexp_split_to_array(lower(rule.excludes),'[,，、[:space:]]+')) term
      where length(term)>0 and strpos(lower(replace(new.title,'臺','台')),replace(term,'臺','台'))>0)
  then continue;end if;
  insert into public.ti_notifications(user_id,rule_id,case_id,notice_id,reason,match_rule_ids)
  values(rule.user_id,rule.id,new.id,latest.id,reason_text,array[rule.id])
  on conflict(user_id,notice_id,reason) do update
  set match_rule_ids=(select array_agg(distinct x)
    from unnest(public.ti_notifications.match_rule_ids||excluded.match_rule_ids) x)
  where not public.ti_notifications.match_rule_ids @> excluded.match_rule_ids;
 end loop;
 return new;
end $$;
revoke all on function public.ti_record_deadline_change() from public,anon,authenticated;
drop trigger if exists ti_deadline_change_notice on public.ti_cases;
create trigger ti_deadline_change_notice
 after update of deadline_at on public.ti_cases
 for each row when(old.deadline_at is distinct from new.deadline_at)
 execute function public.ti_record_deadline_change();

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
  where n.stale_at is null and n.created_at>now()-interval '7 days'
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

create or replace function public.ti_claim_digest_batches(
 p_email_ready boolean default false,p_line_ready boolean default false,p_limit integer default 12
) returns table(batch_id uuid,user_id uuid,channel text,recipient text,
 notifications jsonb,attempts integer)
language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
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
  where n.stale_at is null and n.created_at>now()-interval '7 days'
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
     where n.id=any(b.notification_ids) and n.stale_at is null) as notifications,
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
 select n.id,b.user_id,b.channel,
  case when n.stale_at is not null then 'dead' else final_status end,
  b.attempts,now(),
  case when n.stale_at is null and p_status='sent' then now() end,
  case when n.stale_at is not null then '' else left(p_provider,200) end,
  case when n.stale_at is not null then 'Official deadline changed; alert superseded'
   else left(p_error,350) end
 from public.ti_notifications n where n.id=any(b.notification_ids)
 on conflict(notification_id,channel) do update
 set status=excluded.status,attempts=excluded.attempts,last_attempt_at=now(),
     delivered_at=excluded.delivered_at,provider_id=excluded.provider_id,error_summary=excluded.error_summary
 where public.ti_delivery_attempts.status<>'sent';
end $$;
