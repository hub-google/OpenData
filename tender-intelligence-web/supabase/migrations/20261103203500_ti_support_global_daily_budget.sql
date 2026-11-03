-- Supabase project-wide support usage guard; backend service-role only.
create table if not exists public.ti_support_daily_quota (
  usage_date date not null,
  kind text not null check (kind in ('ai','form')),
  hits integer not null default 0 check (hits >= 0),
  primary key (usage_date,kind)
);
alter table public.ti_support_daily_quota enable row level security;
revoke all on public.ti_support_daily_quota from anon,authenticated;
grant select,insert,update on public.ti_support_daily_quota to service_role;

create or replace function public.ti_support_claim_daily(p_kind text,p_cap integer)
returns boolean language plpgsql security invoker set search_path=''
as $f$
declare v_hits integer;
begin
 if p_kind not in ('ai','form') or p_cap < 1 or p_cap > 100000 then
  raise exception 'Invalid support quota parameters';
 end if;
 insert into public.ti_support_daily_quota(usage_date,kind,hits)
 values ((now() at time zone 'Asia/Taipei')::date,p_kind,1)
 on conflict (usage_date,kind) do update set hits=public.ti_support_daily_quota.hits+1
 where public.ti_support_daily_quota.hits < p_cap
 returning hits into v_hits;
 return v_hits is not null;
end;$f$;
revoke all on function public.ti_support_claim_daily(text,integer) from public,anon,authenticated;
grant execute on function public.ti_support_claim_daily(text,integer) to service_role;
comment on function public.ti_support_claim_daily(text,integer) is 'Atomically guard daily support workload, backend-only.';
