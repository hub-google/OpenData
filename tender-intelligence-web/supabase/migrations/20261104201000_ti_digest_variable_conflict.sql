-- Fix PL/pgSQL output-column variable collisions in digest claim logic.
create or replace function public.ti_claim_digest_batches(
 p_email_ready boolean default false,p_line_ready boolean default false,p_limit integer default 12
) returns table(batch_id uuid,user_id uuid,channel text,recipient text,
 notifications jsonb,attempts integer)
language plpgsql security definer set search_path='' as $
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
