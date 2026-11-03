-- Transport layer only; no billing gates.
-- Explicit user consent before external Email or LINE notifications.
create table if not exists public.ti_delivery_settings(
  user_id uuid primary key references auth.users(id) on delete cascade,
  email_enabled boolean not null default false,
  line_enabled boolean not null default false,
  daily_digest boolean not null default true,
  updated_at timestamptz not null default now()
);
create table if not exists public.ti_line_links(
  user_id uuid primary key references auth.users(id) on delete cascade,
  line_user_id text not null unique,
  linked_at timestamptz not null default now()
);
create table if not exists public.ti_line_oauth_state(
  state_hash text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null default now()+interval '10 minutes',
  redeemed_at timestamptz
);
create table if not exists public.ti_delivery_attempts(
  notification_id bigint not null references public.ti_notifications(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  channel text not null check(channel in ('email','line')),
  status text not null default 'pending' check(status in ('pending','sent','failed')),
  attempts integer not null default 0,
  last_attempt_at timestamptz,
  delivered_at timestamptz,
  provider_id text,
  error_summary text,
  primary key(notification_id,channel)
);
create index if not exists ti_delivery_retries on public.ti_delivery_attempts(status,last_attempt_at);
alter table public.ti_delivery_settings enable row level security;
alter table public.ti_line_links enable row level security;
alter table public.ti_line_oauth_state enable row level security;
alter table public.ti_delivery_attempts enable row level security;

revoke all on public.ti_delivery_settings,public.ti_line_links,
 public.ti_line_oauth_state,public.ti_delivery_attempts from anon,authenticated;
grant select,insert,update,delete on public.ti_delivery_settings to authenticated;
grant select,delete on public.ti_line_links to authenticated;
grant select on public.ti_delivery_attempts to authenticated;

create policy ti_delivery_settings_owner on public.ti_delivery_settings for all to authenticated
using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create policy ti_line_links_owner_read on public.ti_line_links for select to authenticated
using ((select auth.uid())=user_id);
create policy ti_line_links_owner_delete on public.ti_line_links for delete to authenticated
using ((select auth.uid())=user_id);
create policy ti_delivery_attempts_owner_read on public.ti_delivery_attempts for select to authenticated
using ((select auth.uid())=user_id);

-- Server-only retrieval: joins verified Auth emails with one real notification and user opt-in.
-- Strongly bound to service_role; no auth.users emails exposed through REST.
create or replace function public.ti_pending_deliveries(max_items integer default 30)
returns table(
  notification_id bigint,user_id uuid,channel text,
  recipient text,subject text,reason text,case_id text,
  agency text,job_number text
)
language sql security definer set search_path='' as $$
  with candidates as (
   select n.id as notification_id,n.user_id,pref.email_enabled,pref.line_enabled,
          a.email, a.email_confirmed_at,link.line_user_id,
          n.reason,n.case_id,c.title,c.agency,c.job_number,
          row_number() over(partition by n.user_id order by n.created_at desc) as per_user
   from public.ti_notifications n
   join public.ti_delivery_settings pref on pref.user_id=n.user_id
   join public.ti_cases c on c.id=n.case_id
   join auth.users a on a.id=n.user_id
   left join public.ti_line_links link on link.user_id=n.user_id
   where n.created_at>now()-interval '7 days'
  ), expanded as (
   select e.notification_id,e.user_id,e.reason,e.case_id,e.title,e.agency,e.job_number,
       opt.channel,
       case opt.channel when 'email' then e.email else e.line_user_id end as recipient
   from candidates e cross join lateral (values('email'),('line')) opt(channel)
   where e.per_user<=20
     and ((opt.channel='email' and e.email_enabled and e.email_confirmed_at is not null)
       or (opt.channel='line' and e.line_enabled and e.line_user_id is not null))
  )
  select e.notification_id,e.user_id,e.channel,e.recipient,e.title,e.reason,e.case_id,e.agency,e.job_number
  from expanded e
  left join public.ti_delivery_attempts a
    on a.notification_id=e.notification_id and a.channel=e.channel
  where e.recipient is not null
    and (a.status is null or (a.status='failed' and a.attempts<3
      and a.last_attempt_at<now()-interval '15 minutes'))
  order by e.notification_id asc
  limit least(greatest(max_items,1),100);
$$;
revoke all on function public.ti_pending_deliveries(integer) from public,anon,authenticated;
grant execute on function public.ti_pending_deliveries(integer) to service_role;

create or replace function public.ti_record_delivery(
  p_notification bigint,p_user uuid,p_channel text,p_status text,p_provider_id text,p_error text
) returns void language plpgsql security definer set search_path='' as $$
begin
 insert into public.ti_delivery_attempts(notification_id,user_id,channel,status,attempts,last_attempt_at,delivered_at,provider_id,error_summary)
 values(p_notification,p_user,p_channel,p_status,1,now(),
        case when p_status='sent' then now() else null end,p_provider_id,left(p_error,350))
 on conflict(notification_id,channel) do update set
   attempts=ti_delivery_attempts.attempts+1,
   last_attempt_at=now(),
   status=excluded.status,
   delivered_at=case when excluded.status='sent' then now() else null end,
   provider_id=excluded.provider_id,error_summary=excluded.error_summary;
end $$;
revoke all on function public.ti_record_delivery(bigint,uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.ti_record_delivery(bigint,uuid,text,text,text,text) to service_role;

-- Cleanup old, unusable one-time OAuth state automatically.
select cron.schedule('ti_line_state_cleanup','27 3 * * *',$job$
 delete from public.ti_line_oauth_state where expires_at < now()-interval '1 day';
$job$);

select cron.schedule('ti_dispatch_notifications','*/15 * * * *',$job$
 select net.http_post(
  url:='https://unapiwajmgqqtdkixaab.supabase.co/functions/v1/ti-notify',
  headers:=jsonb_build_object('Content-Type','application/json','x-ti-cron',
    (select decrypted_secret from vault.decrypted_secrets where name='ti_pcc_ingest_token')),
  body:='{}'::jsonb,
  timeout_milliseconds:=120000
 );
$job$);
