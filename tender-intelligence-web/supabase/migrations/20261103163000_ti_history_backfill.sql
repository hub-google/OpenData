-- Controlled historical backfill: only genuine PCC API dates; never synthesize missing data.
create table if not exists public.ti_backfill_state(
  id text primary key,
  next_date date not null,
  oldest_date date not null,
  max_archive_bytes bigint not null default 314572800,
  enabled boolean not null default true,
  last_success_at timestamptz,
  last_attempt_at timestamptz,
  last_error text,
  days_completed integer not null default 0,
  constraint ti_backfill_date_range check(oldest_date<='2026-11-03'::date)
);
create table if not exists public.ti_backfill_days(
  source_date date primary key,
  fetched_count integer not null,
  inserted_count integer not null,
  finished_at timestamptz not null default now(),
  source text not null default 'openfun-pcc'
);
alter table public.ti_backfill_state enable row level security;
alter table public.ti_backfill_days enable row level security;
revoke all on public.ti_backfill_state,public.ti_backfill_days from anon,authenticated;
grant select on public.ti_backfill_state,public.ti_backfill_days to anon,authenticated;
create policy ti_backfill_public_read on public.ti_backfill_state for select to anon,authenticated using (true);
create policy ti_backfill_days_public_read on public.ti_backfill_days for select to anon,authenticated using (true);
insert into public.ti_backfill_state(id,next_date,oldest_date)
values('openfun-pcc','2026-11-02'::date,'2026-08-01'::date)
on conflict (id) do nothing;

-- Prevent duplicate ingestion attempts. pg_cron runs this function via pg_net while tokens stay in Vault.
create or replace function public.ti_backfill_ready()
returns boolean language sql security definer set search_path='' as $$
  select coalesce((
     select b.enabled and b.next_date>=b.oldest_date
       and (select pg_total_relation_size('public.ti_cases'::regclass)
                   +pg_total_relation_size('public.ti_notices'::regclass)) < b.max_archive_bytes
     from public.ti_backfill_state b where b.id='openfun-pcc'
  ),false);
$$;
revoke all on function public.ti_backfill_ready() from public,anon,authenticated;
grant execute on function public.ti_backfill_ready() to service_role;

-- Repeat every twenty minutes; backfill is bounded by the configured date range and storage cap.
select cron.schedule('ti_pcc_history_backfill','17,37,57 * * * *',$job$
 select net.http_post(
   url:='https://unapiwajmgqqtdkixaab.supabase.co/functions/v1/ti-ingest',
   headers:=jsonb_build_object(
      'Content-Type','application/json',
      'x-ti-cron',(select decrypted_secret from vault.decrypted_secrets where name='ti_pcc_ingest_token')
   ),
   body:='{"mode":"backfill"}'::jsonb,
   timeout_milliseconds:=120000
 );
$job$);
