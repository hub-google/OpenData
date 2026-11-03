-- PRD U13/U14 and V6/V8: genuine opt-in, user-provided CRM records.
-- Never label a self-submitted vendor as government-certified.
create table if not exists public.ti_vendor_profiles(
 user_id uuid primary key references auth.users(id) on delete cascade,
 company_name text not null check(char_length(trim(company_name)) between 2 and 160),
 company_tax_id text check(company_tax_id is null or company_tax_id ~ '^[0-9]{8}$'),
 services text not null default '' check(char_length(services)<=1800),
 service_areas text not null default '' check(char_length(service_areas)<=350),
 website_url text check(website_url is null or
   (char_length(website_url)<=350 and website_url ~ '^https://[A-Za-z0-9.-]+(/[^[:space:]]*)?$')),
 contact_email text check(contact_email is null or
   (char_length(contact_email)<=180 and contact_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')),
 published boolean not null default false,
 disclosure_source text not null default 'vendor_self_submitted'
    check(disclosure_source='vendor_self_submitted'),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
alter table public.ti_vendor_profiles enable row level security;
revoke all on public.ti_vendor_profiles from anon,authenticated;
grant select on public.ti_vendor_profiles to anon,authenticated;
grant insert,update,delete on public.ti_vendor_profiles to authenticated;
create policy ti_vendor_public_or_owner on public.ti_vendor_profiles
 for select to anon,authenticated using(published or (select auth.uid())=user_id);
create policy ti_vendor_owner_insert on public.ti_vendor_profiles
 for insert to authenticated with check((select auth.uid())=user_id);
create policy ti_vendor_owner_update on public.ti_vendor_profiles
 for update to authenticated using((select auth.uid())=user_id)
 with check((select auth.uid())=user_id);
create policy ti_vendor_owner_delete on public.ti_vendor_profiles
 for delete to authenticated using((select auth.uid())=user_id);
create index if not exists ti_vendor_public_search
 on public.ti_vendor_profiles(published,company_name) where published=true;

create table if not exists public.ti_bid_decisions(
 user_id uuid not null references auth.users(id) on delete cascade,
 case_id text not null references public.ti_cases(id) on delete cascade,
 decision text not null default '評估中' check(decision in ('評估中','建議追蹤','準備投標','不投')),
 criteria jsonb not null default '{}'::jsonb check(jsonb_typeof(criteria)='object'),
 evidence_notes text not null default '' check(char_length(evidence_notes)<=5000),
 updated_at timestamptz not null default now(),
 primary key(user_id,case_id)
);
alter table public.ti_bid_decisions enable row level security;
revoke all on public.ti_bid_decisions from anon,authenticated;
grant select,insert,update,delete on public.ti_bid_decisions to authenticated;
create policy ti_bid_decisions_owner on public.ti_bid_decisions
 for all to authenticated using((select auth.uid())=user_id)
 with check((select auth.uid())=user_id);

create table if not exists public.ti_contract_obligations(
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 case_id text references public.ti_cases(id) on delete set null,
 subject text not null check(char_length(trim(subject)) between 2 and 250),
 obligation_type text not null check(obligation_type in (
   '押標金','履約保證金','保固保證金','履約里程碑','驗收','請款','合約到期')),
 amount numeric check(amount is null or amount>=0),
 due_date date not null,
 completed_at date,
 status text not null default '待處理' check(status in ('待處理','已完成','已返還','已取消')),
 notes text not null default '' check(char_length(notes)<=5000),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
alter table public.ti_contract_obligations enable row level security;
revoke all on public.ti_contract_obligations from anon,authenticated;
grant select,insert,update,delete on public.ti_contract_obligations to authenticated;
create policy ti_contract_own on public.ti_contract_obligations
 for all to authenticated using((select auth.uid())=user_id)
 with check((select auth.uid())=user_id);
create index if not exists ti_contract_user_due
 on public.ti_contract_obligations(user_id,due_date) where status='待處理';

create table if not exists public.ti_contract_alerts(
 id bigint generated always as identity primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 obligation_id uuid not null references public.ti_contract_obligations(id) on delete cascade,
 reminder_days integer not null check(reminder_days in (1,3,7)),
 due_date date not null,
 created_at timestamptz not null default now(),
 read_at timestamptz,
 unique(obligation_id,reminder_days,due_date)
);
alter table public.ti_contract_alerts enable row level security;
revoke all on public.ti_contract_alerts from anon,authenticated;
grant select,update,delete on public.ti_contract_alerts to authenticated;
create policy ti_contract_alerts_read on public.ti_contract_alerts
 for select to authenticated using((select auth.uid())=user_id);
create policy ti_contract_alerts_update on public.ti_contract_alerts
 for update to authenticated using((select auth.uid())=user_id)
 with check((select auth.uid())=user_id);
create policy ti_contract_alerts_delete on public.ti_contract_alerts
 for delete to authenticated using((select auth.uid())=user_id);

create or replace function public.ti_make_contract_alerts()
returns integer language plpgsql security definer set search_path='' as $$
declare c integer;
begin
 insert into public.ti_contract_alerts(user_id,obligation_id,reminder_days,due_date)
 select o.user_id,o.id,ds.days,o.due_date
 from public.ti_contract_obligations o
 cross join (values(7),(3),(1)) ds(days)
 where o.status='待處理' and o.due_date=(now() at time zone 'Asia/Taipei')::date+ds.days
 on conflict(obligation_id,reminder_days,due_date) do nothing;
 get diagnostics c=row_count;
 return c;
end $$;
revoke all on function public.ti_make_contract_alerts() from public,anon,authenticated;
grant execute on function public.ti_make_contract_alerts() to service_role;
select cron.schedule('ti_contract_due_alerts','46 23 * * *',
  $job$ select public.ti_make_contract_alerts(); $job$);
