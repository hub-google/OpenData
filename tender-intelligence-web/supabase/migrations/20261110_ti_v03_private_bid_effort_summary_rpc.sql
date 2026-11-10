
-- W08 exact owner-scoped totals from logged entries, never inferred from public procurement awards.
create or replace function public.ti_bid_effort_summary()
returns table(entry_count bigint,total_hours numeric,cash_expense numeric,estimated_labor numeric,hours_without_rate numeric)
language sql stable security invoker set search_path='pg_catalog','public'
as $fn$
 select count(*)::bigint,
        coalesce(sum(e.hours),0)::numeric,
        coalesce(sum(e.cash_cost),0)::numeric,
        coalesce(sum(e.hours*e.hourly_rate) filter (where e.hourly_rate is not null),0)::numeric,
        coalesce(sum(e.hours) filter (where e.hourly_rate is null),0)::numeric
 from public.ti_bid_effort_entries e
 where e.user_id=(select auth.uid());
$fn$;
revoke all on function public.ti_bid_effort_summary() from public,anon,authenticated;
grant execute on function public.ti_bid_effort_summary() to authenticated,service_role;
