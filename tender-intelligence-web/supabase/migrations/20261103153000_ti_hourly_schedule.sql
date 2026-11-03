-- GMT cron timezone verified in this project; every hour at xx:12 UTC = xx:12 Taiwan time.
-- This is a real database scheduler, not a browser timer or best-effort GitHub Actions delay.
select cron.schedule('ti_pcc_hourly_ingest','12 * * * *',$job$
 select net.http_post(
   url:='https://unapiwajmgqqtdkixaab.supabase.co/functions/v1/ti-ingest',
   headers:=jsonb_build_object(
      'Content-Type','application/json',
      'x-ti-cron',(select decrypted_secret from vault.decrypted_secrets where name='ti_pcc_ingest_token')
   ),
   body:='{"mode":"latest"}'::jsonb,
   timeout_milliseconds:=120000
 );
$job$);
-- At 18:32 GMT / 02:32 Taipei, recheck the previous publication date for late corrections.
select cron.schedule('ti_pcc_previous_day_backfill','32 18 * * *',$job$
 select net.http_post(
   url:='https://unapiwajmgqqtdkixaab.supabase.co/functions/v1/ti-ingest',
   headers:=jsonb_build_object(
      'Content-Type','application/json',
      'x-ti-cron',(select decrypted_secret from vault.decrypted_secrets where name='ti_pcc_ingest_token')
   ),
   body:='{"mode":"previous"}'::jsonb,
   timeout_milliseconds:=120000
 );
$job$);
