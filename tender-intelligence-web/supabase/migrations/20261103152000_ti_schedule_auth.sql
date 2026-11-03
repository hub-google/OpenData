-- Cron authentication token lives only in Supabase Vault, never in GitHub or browser code.
-- Edge Function verifies the submitted token through this service-role-only RPC.
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;
do $$
begin
  if not exists (select 1 from vault.secrets where name='ti_pcc_ingest_token') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'ti_pcc_ingest_token');
  end if;
end $$;

create or replace function public.ti_verify_ingest_token(candidate text)
returns boolean language sql security definer
set search_path='' as $$
  select coalesce(length(candidate)>=32,false)
    and exists (
      select 1 from vault.decrypted_secrets
      where name='ti_pcc_ingest_token' and decrypted_secret=candidate
    );
$$;
revoke all on function public.ti_verify_ingest_token(text) from public,anon,authenticated;
grant execute on function public.ti_verify_ingest_token(text) to service_role;

-- Cannot set an arbitrary schedule from the public Data API.
-- These jobs will be activated after Edge Function deployment is verified.
