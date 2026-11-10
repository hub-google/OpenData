-- Manual P0 readiness regression, requires privileged DB session.
-- Simulates outage and recovery in one transaction; never persists test incidents.
BEGIN;
UPDATE public.ti_sources SET last_success_at=now()-interval '4 hours'
 WHERE id='openfun-pcc';
SELECT ti_private.sync_tender_ops_incidents();
DO $open$
BEGIN
 IF (SELECT count(*) FROM ti_private.tender_ops_incidents
  WHERE code='feed_stale' AND resolved_at IS NULL)<>1
 THEN RAISE EXCEPTION 'Missing outage incident'; END IF;
END $open$;
UPDATE public.ti_sources SET last_success_at=now()
 WHERE id='openfun-pcc';
SELECT ti_private.sync_tender_ops_incidents();
DO $recovered$
BEGIN
 IF (SELECT count(*) FROM ti_private.tender_ops_incidents
  WHERE code='feed_stale' AND resolved_at IS NULL)<>0
 THEN RAISE EXCEPTION 'Incident failed to auto-resolve'; END IF;
END $recovered$;
ROLLBACK;
