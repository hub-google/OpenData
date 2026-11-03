-- PRD U11: true one-click RFC 8058 email unsubscribe.
-- Opaque random 256-bit token. This is not an auth token and cannot be used for login.
-- Only service_role can create/read tokens. No anonymous access to token storage.
create table if not exists public.ti_email_unsubscribe_tokens(
 user_id uuid primary key references auth.users(id) on delete cascade,
 unsubscribe_token text not null unique
   check(unsubscribe_token ~ '^[0-9a-f]{64}$'),
 created_at timestamptz not null default now(),
 used_at timestamptz
);
alter table public.ti_email_unsubscribe_tokens enable row level security;
revoke all on public.ti_email_unsubscribe_tokens from anon,authenticated;
grant select,insert,update,delete on public.ti_email_unsubscribe_tokens to service_role;

create or replace function public.ti_issue_unsubscribe_token(target_user uuid)
returns text
language plpgsql security definer set search_path='' as $$
declare token text;
begin
 if target_user is null or not exists(select 1 from public.ti_delivery_settings where user_id=target_user)
 then raise exception 'Invalid recipient'; end if;
 insert into public.ti_email_unsubscribe_tokens(user_id,unsubscribe_token)
 values(target_user,encode(extensions.gen_random_bytes(32),'hex'))
 on conflict(user_id) do nothing;
 select unsubscribe_token into token from public.ti_email_unsubscribe_tokens where user_id=target_user;
 return token;
end $$;
revoke all on function public.ti_issue_unsubscribe_token(uuid) from public,anon,authenticated;
grant execute on function public.ti_issue_unsubscribe_token(uuid) to service_role;

create or replace function public.ti_unsubscribe_email(token text)
returns boolean
language plpgsql security definer set search_path='' as $$
declare target_user uuid;
begin
 if token is null or token !~ '^[0-9a-f]{64}$' then return false; end if;
 select user_id into target_user
 from public.ti_email_unsubscribe_tokens where unsubscribe_token=token for update;
 if target_user is null then return false; end if;
 update public.ti_delivery_settings set email_enabled=false,updated_at=now()
   where user_id=target_user;
 update public.ti_email_unsubscribe_tokens set used_at=now()
   where user_id=target_user;
 return true;
end $$;
revoke all on function public.ti_unsubscribe_email(text) from public,anon,authenticated;
grant execute on function public.ti_unsubscribe_email(text) to service_role;
