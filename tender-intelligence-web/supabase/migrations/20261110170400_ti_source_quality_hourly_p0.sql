-- P0 operational readiness: an overnight check is too late to detect a broken tender feed.
-- This modifies only the existing ti_daily_quality_check schedule. The current
-- ti_run_data_quality_check() still retains source errors, version mismatches
-- and all unresolved calendar dates. It never fabricates zero notices.
DO $$
DECLARE v_job_id bigint;
BEGIN
  SELECT jobid INTO v_job_id FROM cron.job
    WHERE jobname = 'ti_daily_quality_check';
  IF v_job_id IS NULL THEN
    RAISE EXCEPTION 'Required tender data-quality job ti_daily_quality_check does not exist';
  END IF;
  PERFORM cron.alter_job(job_id := v_job_id, schedule := '45 * * * *');
END
$$;
