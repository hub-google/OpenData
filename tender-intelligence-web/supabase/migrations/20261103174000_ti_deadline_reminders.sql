-- PRD U06: server-side deadline reminders based ONLY on verified notice deadlines.
-- Uses explicit user watch rules; no invented deadlines, no estimated bid probability.
alter table public.ti_delivery_settings
  add column if not exists reminder_days integer[] not null default array[7,3,1];

create or replace function public.ti_valid_reminder_days(days integer[])
returns boolean
language sql immutable set search_path='' as $$
 select coalesce(
   cardinality(days) between 0 and 6
   and not exists(select 1 from unnest(days) as d(value) where value is null or value<1 or value>30),
   false
 );
$$;
alter table public.ti_delivery_settings drop constraint if exists ti_delivery_reminder_days_valid;
alter table public.ti_delivery_settings
 add constraint ti_delivery_reminder_days_valid
 check (public.ti_valid_reminder_days(reminder_days));

-- Allow an announcement to generate distinct updates and deadline reminders
-- while retaining idempotency per reason.
alter table public.ti_notifications drop constraint if exists ti_notifications_user_id_rule_id_notice_id_key;
alter table public.ti_notifications add constraint ti_notifications_user_rule_notice_reason_key
unique (user_id,rule_id,notice_id,reason);

create or replace function public.ti_note_matches_new_notice() returns trigger
language plpgsql security definer set search_path='' as $$
declare
  r record;
  c record;
  words text[];
  excluded text[];
  kind text;
begin
  select * into c from public.ti_cases where id=new.case_id;
  if not found then return new; end if;
  for r in select * from public.ti_watch_rules
           where enabled=true
             and created_at<=new.fetched_at
             and to_char(created_at at time zone 'Asia/Taipei','YYYYMMDD')::integer<=new.source_date
  loop
    if nullif(r.agency_id,'') is not null and r.agency_id<>c.unit_id then continue;end if;
    if nullif(r.group_name,'') is not null and r.group_name<>c.group_name then continue;end if;
    if (r.min_budget is not null or r.max_budget is not null) and new.budget_amount is null then continue;end if;
    if r.min_budget is not null and new.budget_amount<r.min_budget then continue;end if;
    if r.max_budget is not null and new.budget_amount>r.max_budget then continue;end if;
    words:=regexp_split_to_array(lower(r.keywords),'[,，、[:space:]]+');
    if not exists(select 1 from unnest(words) term where length(term)>0 and strpos(lower(coalesce(new.title,'')),term)>0) then continue;end if;
    excluded:=regexp_split_to_array(lower(r.excludes),'[,，、[:space:]]+');
    if exists(select 1 from unnest(excluded) term where length(term)>0 and strpos(lower(coalesce(new.title,'')),term)>0) then continue;end if;
    kind:=case when new.notice_type like '%更正%' then '更正公告'
       when new.notice_type like '%無法決標%' then '無法決標公告'
       when new.notice_type like '%決標%' then '決標公告'
       else '新公告' end;
    insert into public.ti_notifications(user_id,rule_id,case_id,notice_id,reason)
    values(r.user_id,r.id,new.case_id,new.id,kind)
    on conflict (user_id,rule_id,notice_id,reason) do nothing;
  end loop;
  return new;
end $$;
revoke all on function public.ti_note_matches_new_notice() from public,anon,authenticated;

create or replace function public.ti_generate_deadline_reminders()
returns integer
language plpgsql security definer set search_path='' as $$
declare affected integer:=0;
begin
  with matches as (
    select c.id as case_id,c.title,c.unit_id,c.group_name,c.budget_amount,c.deadline_at,
      r.id as rule_id,r.user_id,r.keywords,r.excludes,r.agency_id,r.group_name as rule_group,
      r.min_budget,r.max_budget,p.reminder_days,
      ((c.deadline_at at time zone 'Asia/Taipei')::date
       -(now() at time zone 'Asia/Taipei')::date) as days_left,
      n.id as notice_id
    from public.ti_cases c
    join public.ti_watch_rules r on r.enabled
    left join public.ti_delivery_settings p on p.user_id=r.user_id
    join lateral (
      select id from public.ti_notices
      where case_id=c.id
      order by source_date desc,filename desc limit 1
    ) n on true
    where c.deadline_at is not null
      and c.deadline_at>now()
      and (coalesce(c.latest_notice_type,'') like '%招標%'
           or coalesce(c.latest_notice_type,'') like '%更正%'
           or coalesce(c.latest_notice_type,'') like '%徵求%')
      and (c.deadline_at at time zone 'Asia/Taipei')::date
       <=(now() at time zone 'Asia/Taipei')::date+30
  )
  insert into public.ti_notifications(user_id,rule_id,case_id,notice_id,reason)
  select m.user_id,m.rule_id,m.case_id,m.notice_id,
    '截標提醒 T-'||m.days_left::text||'（'||to_char(m.deadline_at at time zone 'Asia/Taipei','YYYY-MM-DD HH24:MI')||'）'
  from matches m
  where m.days_left=any(coalesce(m.reminder_days,array[7,3,1]))
    and (m.agency_id is null or m.agency_id='' or m.agency_id=m.unit_id)
    and (m.rule_group is null or m.rule_group='' or m.rule_group=m.group_name)
    and (m.min_budget is null or (m.budget_amount is not null and m.budget_amount>=m.min_budget))
    and (m.max_budget is null or (m.budget_amount is not null and m.budget_amount<=m.max_budget))
    and exists (
      select 1 from unnest(regexp_split_to_array(lower(m.keywords),'[,，、[:space:]]+')) term
      where length(term)>0 and strpos(lower(coalesce(m.title,'')),term)>0
    )
    and not exists(
      select 1 from unnest(regexp_split_to_array(lower(m.excludes),'[,，、[:space:]]+')) term
      where length(term)>0 and strpos(lower(coalesce(m.title,'')),term)>0
    )
  on conflict (user_id,rule_id,notice_id,reason) do nothing;
  get diagnostics affected=row_count;
  return affected;
end $$;
revoke all on function public.ti_generate_deadline_reminders() from public,anon,authenticated;
grant execute on function public.ti_generate_deadline_reminders() to service_role;

select cron.schedule('ti_deadline_reminders','50 23 * * *',$job$
 select public.ti_generate_deadline_reminders();
$job$);
