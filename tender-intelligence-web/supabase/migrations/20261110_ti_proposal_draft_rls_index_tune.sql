-- Optimize owner and member checks and index case foreign-key deletes.
create index if not exists ti_proposal_drafts_case_lookup_idx on public.ti_proposal_drafts(case_id);
drop policy if exists ti_proposal_drafts_owner on public.ti_proposal_drafts;
create policy ti_proposal_drafts_owner on public.ti_proposal_drafts
 for all to authenticated
 using (
   user_id = (select auth.uid())
   and ((select auth.jwt())->>'is_anonymous') is distinct from 'true'
 )
 with check (
   user_id = (select auth.uid())
   and ((select auth.jwt())->>'is_anonymous') is distinct from 'true'
 );
