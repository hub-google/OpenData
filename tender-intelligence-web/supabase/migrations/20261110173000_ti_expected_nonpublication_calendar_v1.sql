-- Annotate (not resolve) holidays/weekends where the OpenFun date API returns 500.
-- 2026 dates from the Executive Yuan DGPA official 115-year calendar.
-- Official gazette publication generally excludes weekends and national holidays.
-- Calendar expectations do not prove zero announcements. Retain original gap records.
CREATE TABLE IF NOT EXISTS public.ti_expected_nonpublication_dates (
  source_date date PRIMARY KEY,
  description text NOT NULL,
  evidence_url text NOT NULL,
  reviewed_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.ti_expected_nonpublication_dates IS
  'Official gazette calendar exceptions used to annotate source gaps. These are NOT verified zero-announcement dates.';
ALTER TABLE public.ti_expected_nonpublication_dates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ti_expected_nonpublication_dates FROM anon, authenticated;
GRANT SELECT ON TABLE public.ti_expected_nonpublication_dates TO anon, authenticated;
CREATE POLICY ti_expected_nonpublication_public_read
  ON public.ti_expected_nonpublication_dates FOR SELECT
  TO anon, authenticated USING (true);
INSERT INTO public.ti_expected_nonpublication_dates(source_date,description,evidence_url)
VALUES
 ('2026-09-25','中秋節','https://www.dgpa.gov.tw/information?pid=12574&uid=41'),
 ('2026-09-28','孔子誕辰紀念日／教師節','https://www.dgpa.gov.tw/information?pid=12574&uid=41'),
 ('2026-10-09','國慶日補假','https://www.dgpa.gov.tw/information?pid=12574&uid=41'),
 ('2026-10-26','臺灣光復暨金門古寧頭大捷紀念日補假','https://www.dgpa.gov.tw/information?pid=12574&uid=41')
ON CONFLICT(source_date) DO NOTHING;

-- Preserve all existing KPI keys and append separate unverified calendar-gap counts.
CREATE OR REPLACE FUNCTION public.ti_home_kpis()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
WITH last_day AS (SELECT max(source_date) AS d FROM public.ti_notices),
counts AS (
  SELECT count(*) AS all_cases,
    count(*) FILTER(WHERE deadline_at IS NOT NULL) AS deadline_known,
    count(*) FILTER(WHERE deadline_at>now()
      AND coalesce(latest_notice_type,'') ~ '(招標|取得報價|取得企劃書)'
      AND coalesce(latest_notice_type,'') !~ '(決標|無法決標)') AS verified_open,
    count(*) FILTER(WHERE deadline_at>now() AND deadline_at<=now()+interval '3 days'
      AND coalesce(latest_notice_type,'') ~ '(招標|取得報價|取得企劃書)'
      AND coalesce(latest_notice_type,'') !~ '(決標|無法決標)') AS due_soon,
    count(*) FILTER(WHERE latest_notice_type LIKE '%無法決標%') AS failed,
    count(*) FILTER(WHERE deadline_at IS NULL
      AND coalesce(latest_notice_type,'') ~ '(招標|取得報價|取得企劃書)'
      AND coalesce(latest_notice_type,'') !~ '(決標|無法決標)') AS active_unknown,
    count(*) FILTER(WHERE budget_amount IS NOT NULL) AS budget_known
  FROM public.ti_cases
),
gaps AS (
  SELECT count(*) AS unresolved,
    count(*) FILTER (
      WHERE extract(isodow FROM g.source_date) IN (6,7)
         OR EXISTS (
           SELECT 1 FROM public.ti_expected_nonpublication_dates h
            WHERE h.source_date = g.source_date
         )
    ) AS calendar_unverified
  FROM public.ti_backfill_gaps g
  WHERE g.resolved_at IS NULL
)
SELECT jsonb_build_object(
  'latest_publication_day',(SELECT d FROM last_day),
  'latest_notice_count',(SELECT count(*) FROM public.ti_notices n WHERE n.source_date=(SELECT d FROM last_day)),
  'total_cases',c.all_cases,
  'verified_open',c.verified_open,'due_soon',c.due_soon,
  'failed',c.failed,'deadline_known',c.deadline_known,
  'active_unknown_deadline',c.active_unknown,'budget_known',c.budget_known,
  'last_success_at',(SELECT last_success_at FROM public.ti_sources WHERE id='openfun-pcc'),
  'unresolved_source_dates',g.unresolved,
  'calendar_unverified_source_dates',g.calendar_unverified,
  'workday_unverified_source_dates',g.unresolved-g.calendar_unverified
)
FROM counts c CROSS JOIN gaps g
$function$
;
