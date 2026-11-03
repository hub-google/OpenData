-- Keep unavailable source dates explicit, not silently counted as successfully ingested.
create table if not exists public.ti_backfill_gaps(
 source_date date primary key,
 error_summary text not null,
 attempts integer not null default 1,
 last_attempt_at timestamptz not null default now(),
 next_retry_at timestamptz not null default now()+interval '4 hours',
 resolved_at timestamptz
);
alter table public.ti_backfill_gaps enable row level security;
revoke all on public.ti_backfill_gaps from anon,authenticated;
grant select on public.ti_backfill_gaps to anon,authenticated;
create policy ti_gaps_public_read on public.ti_backfill_gaps
for select to anon,authenticated using(true);

select cron.schedule('ti_pcc_retry_source_gaps','42 */4 * * *',$job$
 select net.http_post(
  url:='https://unapiwajmgqqtdkixaab.supabase.co/functions/v1/ti-ingest',
  headers:=jsonb_build_object(
   'Content-Type','application/json',
   'x-ti-cron',(select decrypted_secret from vault.decrypted_secrets where name='ti_pcc_ingest_token')
  ),
  body:='{"mode":"retry"}'::jsonb,
  timeout_milliseconds:=120000
 );
$job$);
