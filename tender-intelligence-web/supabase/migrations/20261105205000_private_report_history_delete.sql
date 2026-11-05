-- Generated reports remain server-owned for INSERT/UPDATE but users can delete
-- their own completed/failed reports after export. Authenticated DELETE is RLS-scoped.
drop policy if exists ti_report_jobs_owner_delete on public.ti_report_jobs;
create policy ti_report_jobs_owner_delete on public.ti_report_jobs for delete to authenticated
 using(user_id=(select auth.uid()) and status in ('completed','failed'));
grant delete on public.ti_report_jobs to authenticated;
comment on policy ti_report_jobs_owner_delete on public.ti_report_jobs
is 'Allow user to clean up their own generated report history; clients cannot forge completed snapshots.';