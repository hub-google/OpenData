-- Guest-first release: no registration / permanent membership is required.
-- Anonymous Supabase Auth users have authenticated role and a unique auth.uid().
-- Keep owner-only RLS: never expose another visitor's documents, drafts or API keys.
begin;
drop policy if exists ti_api_keys_permanent_members_only on public.ti_api_keys;

drop policy if exists ti_bid_effort_self on public.ti_bid_effort_entries;
create policy ti_bid_effort_self on public.ti_bid_effort_entries
 for all to authenticated
 using ((select auth.uid()) = user_id)
 with check ((select auth.uid()) = user_id);

drop policy if exists ti_document_vectors_owner_read on public.ti_document_vectors;
create policy ti_document_vectors_owner_read on public.ti_document_vectors
 for select to authenticated
 using ((select auth.uid()) = user_id);

drop policy if exists ti_proposal_drafts_owner on public.ti_proposal_drafts;
create policy ti_proposal_drafts_owner on public.ti_proposal_drafts
 for all to authenticated
 using ((select auth.uid()) = user_id)
 with check ((select auth.uid()) = user_id);
commit;
