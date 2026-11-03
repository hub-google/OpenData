-- Enforce the five-active-key limit without recursive RLS policy access.
drop policy if exists ti_api_keys_owner_insert on public.ti_api_keys;
create policy ti_api_keys_owner_insert on public.ti_api_keys
 for insert to authenticated with check(
  (select auth.uid())=user_id and revoked_at is null
  and expires_at>now() and expires_at<=now()+interval '95 days'
 );
create or replace function public.ti_limit_api_keys()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform 1 from auth.users where id=new.user_id for update;
 if (select count(*) from public.ti_api_keys k
     where k.user_id=new.user_id and k.revoked_at is null and k.expires_at>now()) >= 5
 then raise exception '最多保留 5 把有效 API 金鑰' using errcode='23514';end if;
 return new;
end $$;
revoke all on function public.ti_limit_api_keys() from public,anon,authenticated;
drop trigger if exists ti_api_keys_limit on public.ti_api_keys;
create trigger ti_api_keys_limit before insert on public.ti_api_keys
 for each row execute function public.ti_limit_api_keys();
