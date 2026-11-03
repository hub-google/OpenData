-- U07: atomic delivery claims, leased work items and bounded retry/dead-letter.
-- The API dispatcher must call ti_claim_deliveries, never read the old non-locking queue.
alter table public.ti_delivery_attempts
 drop constraint if exists ti_delivery_attempts_status_check;
alter table public.ti_delivery_attempts
 add constraint ti_delivery_attempts_status_check
 check(status in ('pending','processing','sent','failed','dead'));

create or replace function public.ti_claim_deliveries(
 p_limit integer default 30,
 p_email_ready boolean default false,
 p_line_ready boolean default false,
 p_digest_hour boolean default false
)
returns table(
 notification_id bigint,user_id uuid,channel text,recipient text,
 subject text,reason text,case_id text,agency text,job_number text
)
language sql security definer set search_path='' as $$
with candidates as (
 select n.id as notification_id,n.user_id,n.reason,n.case_id,
        c.title as subject,c.agency,c.job_number,
        pref.email_enabled,pref.line_enabled,pref.daily_digest,
        a.email,a.email_confirmed_at,ln.line_user_id,
        row_number() over(partition by n.user_id order by n.created_at desc,n.id desc) as per_user
 from public.ti_notifications n
 join public.ti_delivery_settings pref on pref.user_id=n.user_id
 join public.ti_cases c on c.id=n.case_id
 join auth.users a on a.id=n.user_id
 left join public.ti_line_links ln on ln.user_id=n.user_id
 where n.created_at>now()-interval '7 days'
), expanded as (
 select e.notification_id,e.user_id,opt.channel,
        case when opt.channel='email' then e.email else e.line_user_id end as recipient,
        e.subject,e.reason,e.case_id,e.agency,e.job_number
 from candidates e
 cross join lateral (values ('email'),('line')) opt(channel)
 left join public.ti_delivery_attempts at
 on at.notification_id=e.notification_id and at.channel=opt.channel
 where e.per_user<=20
 and ((opt.channel='email' and p_email_ready and e.email_enabled
       and e.email_confirmed_at is not null
       and (e.daily_digest=false or p_digest_hour))
   or (opt.channel='line' and p_line_ready and e.line_enabled and e.line_user_id is not null))
 and ((at.notification_id is null)
    or (at.status='failed' and at.attempts<3 and at.last_attempt_at<=now()-interval '15 minutes')
    or (at.status='processing' and at.attempts<3 and at.last_attempt_at<=now()-interval '5 minutes'))
), chosen as (
 select * from expanded
 where recipient is not null
 order by notification_id asc,channel
 limit least(greatest(coalesce(p_limit,30),1),60)
), reserved as (
 insert into public.ti_delivery_attempts(notification_id,user_id,channel,status,attempts,last_attempt_at)
 select c.notification_id,c.user_id,c.channel,'processing',1,now() from chosen c
 on conflict(notification_id,channel) do update
 set status='processing',attempts=public.ti_delivery_attempts.attempts+1,last_attempt_at=now()
 where public.ti_delivery_attempts.attempts<3
   and ((public.ti_delivery_attempts.status='failed'
         and public.ti_delivery_attempts.last_attempt_at<=now()-interval '15 minutes')
     or (public.ti_delivery_attempts.status='processing'
         and public.ti_delivery_attempts.last_attempt_at<=now()-interval '5 minutes'))
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

-- Only a claimed in-flight delivery can be finalized.
create or replace function public.ti_record_delivery(
 p_notification bigint,p_user uuid,p_channel text,p_status text,p_provider_id text,p_error text
) returns void language plpgsql security definer set search_path='' as $$
begin
 if p_status not in ('sent','failed') then
  raise exception 'invalid delivery result' using errcode='22023';end if;
 update public.ti_delivery_attempts
 set status=case when p_status='failed' and attempts>=3 then 'dead' else p_status end,
     last_attempt_at=now(),
     delivered_at=case when p_status='sent' then now() else null end,
     provider_id=nullif(left(p_provider_id,200),''),
     error_summary=nullif(left(p_error,350),'')
 where notification_id=p_notification and user_id=p_user
   and channel=p_channel and status='processing';
 if not found then raise exception 'delivery not in processing state' using errcode='22023';end if;
end $$;
revoke all on function public.ti_record_delivery(bigint,uuid,text,text,text,text)
 from public,anon,authenticated;
grant execute on function public.ti_record_delivery(bigint,uuid,text,text,text,text) to service_role;
