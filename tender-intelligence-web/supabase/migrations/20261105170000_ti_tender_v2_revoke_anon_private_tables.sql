-- Private tender workspace tables must not be discoverable through anon Data API / GraphQL grants.
revoke all on table public.ti_company_profiles from anon;
revoke all on table public.ti_company_assets from anon;
revoke all on table public.ti_competitor_watches from anon;
revoke all on table public.ti_report_schedules from anon;
revoke all on table public.ti_report_jobs from anon;
-- Authorized signed-in users are isolated by user_id-scoped RLS policies.
