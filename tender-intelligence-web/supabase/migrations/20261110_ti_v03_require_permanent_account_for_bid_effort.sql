
-- New member-only bid effort records are not available to Supabase
-- anonymous sign-in identities, even though they have role authenticated.
drop policy if exists ti_bid_effort_self on public.ti_bid_effort_entries;
create policy ti_bid_effort_self on public.ti_bid_effort_entries
 for all to authenticated
 using (user_id=(select auth.uid())
        and (select auth.jwt()->>'is_anonymous') is distinct from 'true')
 with check (user_id=(select auth.uid())
        and (select auth.jwt()->>'is_anonymous') is distinct from 'true');
