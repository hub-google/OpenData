-- PRD P0: private, durable tender data-health incidents.
-- Records feed silence, case/version mismatches, and unresolved workday source gaps.
-- A recovered condition is auto-resolved; no synthetic tender record is ever created.
CREATE TABLE IF NOT EXISTS ti_private.tender_ops_incidents(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 code text NOT NULL CHECK(code IN ('feed_stale','version_mismatch','workday_source_gap')),
 opened_at timestamptz NOT NULL DEFAULT now(),
 last_seen_at timestamptz NOT NULL DEFAULT now(),
 resolved_at timestamptz,
 details jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE UNIQUE INDEX IF NOT EXISTS tender_ops_one_open_code
 ON ti_private.tender_ops_incidents(code) WHERE resolved_at IS NULL;
ALTER TABLE ti_private.tender_ops_incidents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE ti_private.tender_ops_incidents FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION ti_private.sync_tender_ops_incidents()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
 v_last timestamptz;
 v_mismatches bigint := 0;
 v_workday_gaps bigint := 0;
 issue record;
BEGIN
 SELECT last_success_at INTO v_last FROM public.ti_sources
  WHERE id='openfun-pcc';
 SELECT coalesce(version_mismatch_count,0) INTO v_mismatches
  FROM public.ti_data_quality_checks ORDER BY checked_at DESC LIMIT 1;
 v_mismatches:=coalesce(v_mismatches,0);
 SELECT count(*) INTO v_workday_gaps
  FROM public.ti_backfill_gaps g
  WHERE g.resolved_at IS NULL
    AND extract(isodow FROM g.source_date) NOT IN (6,7)
    AND NOT EXISTS(
      SELECT 1 FROM public.ti_expected_nonpublication_dates h
      WHERE h.source_date=g.source_date
    );
 FOR issue IN
  SELECT * FROM (VALUES
    ('feed_stale'::text,(v_last IS NULL OR v_last<now()-interval '3 hours'),
      jsonb_build_object('last_success_at',v_last)),
    ('version_mismatch'::text,(v_mismatches>0),
      jsonb_build_object('version_mismatch_count',v_mismatches)),
    ('workday_source_gap'::text,(v_workday_gaps>0),
      jsonb_build_object('unverified_workday_count',v_workday_gaps))
  ) AS cases(code,is_active,details)
 LOOP
  IF issue.is_active THEN
    INSERT INTO ti_private.tender_ops_incidents(code,last_seen_at,details)
      VALUES(issue.code,now(),issue.details)
    ON CONFLICT (code) WHERE resolved_at IS NULL
      DO UPDATE SET last_seen_at=excluded.last_seen_at,
                    details=excluded.details;
  ELSE
    UPDATE ti_private.tender_ops_incidents
      SET resolved_at=now(),last_seen_at=now()
      WHERE code=issue.code AND resolved_at IS NULL;
  END IF;
 END LOOP;
 RETURN jsonb_build_object(
   'checked_at',now(),
   'open_incidents',(SELECT count(*) FROM ti_private.tender_ops_incidents WHERE resolved_at IS NULL),
   'last_success_at',v_last,
   'version_mismatch',v_mismatches,
   'unverified_workday_gaps',v_workday_gaps
 );
END;
$function$
;
REVOKE ALL ON FUNCTION ti_private.sync_tender_ops_incidents() FROM PUBLIC,anon,authenticated;
DO $job$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM cron.job WHERE jobname='ti_tender_ops_incidents_hourly') THEN
  PERFORM cron.schedule(
   'ti_tender_ops_incidents_hourly',
   '50 * * * *',
   'select ti_private.sync_tender_ops_incidents()'
  );
 END IF;
END;
$job$;
