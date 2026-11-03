-- F19/V9: strictly personal read-only API credentials; no licensed bulk tender redistribution.
create table if not exists public.ti_api_keys(
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 name text not null check(char_length(trim(name)) between 2 and 80),
 token_hash text not null unique check(token_hash ~ '^[0-9a-f]{64}$'),
 token_prefix text not null check(length(token_prefix) between 8 and 20),
 created_at timestamptz not null default now(),
 expires_at timestamptz not null default now()+interval '90 days',
 last_used_at timestamptz,
 quota_day date,
 daily_requests integer not null default 0 check(daily_requests>=0),
 total_requests bigint not null default 0 check(total_requests>=0),
 revoked_at timestamptz,
 check(expires_at<=created_at+interval '95 days')
);
create index if not exists ti_api_keys_owner on public.ti_api_keys(user_id,created_at desc);
alter table public.ti_api_keys enable row level security;
revoke all on public.ti_api_keys from public,anon,authenticated;
grant select,insert,delete on public.ti_api_keys to authenticated;
grant all on public.ti_api_keys to service_role;
create policy ti_api_keys_owner_select on public.ti_api_keys
 for select to authenticated using((select auth.uid())=user_id);
create policy ti_api_keys_owner_insert on public.ti_api_keys
 for insert to authenticated with check(
 (select auth.uid())=user_id
 and expires_at>now() and expires_at<=now()+interval '95 days'
 and (select count(*) from public.ti_api_keys k
  where k.user_id=(select auth.uid()) and k.revoked_at is null and k.expires_at>now())<5
 );
create policy ti_api_keys_owner_delete on public.ti_api_keys
 for delete to authenticated using((select auth.uid())=user_id);

-- Hash-only lookup, no plaintext key ever touches DB; atomic per-key daily quota.
-- Only the server service_role may call this privileged function.
create or replace function public.ti_api_claim_key(p_hash text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid;v_user uuid;today date;
begin
 if p_hash !~ '^[0-9a-f]{64}$' then return null;end if;
 today:=(now() at time zone 'Asia/Taipei')::date;
 select k.id,k.user_id into v_id,v_user
 from public.ti_api_keys k
 where k.token_hash=p_hash and k.revoked_at is null and k.expires_at>now()
 for update;
 if v_id is null then return null;end if;
 update public.ti_api_keys
 set daily_requests=case when quota_day=today then daily_requests+1 else 1 end,
     quota_day=today,last_used_at=now(),total_requests=total_requests+1
 where id=v_id and (quota_day is distinct from today or daily_requests<300)
 returning user_id into v_user;
 return v_user;
end $$;
revoke all on function public.ti_api_claim_key(text) from public,anon,authenticated;
grant execute on function public.ti_api_claim_key(text) to service_role;
