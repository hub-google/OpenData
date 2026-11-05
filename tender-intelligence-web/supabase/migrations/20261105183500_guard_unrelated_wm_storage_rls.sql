-- Restrict the unrelated WM evidence predicate to its own bucket before invoking
-- a deliberately non-executable security-definer helper. Preserve its permissions.
-- PostgreSQL can evaluate AND predicates in either order, causing other buckets to
-- fail with "permission denied for function can_access_evidence".
alter policy wm_request_evidence_storage_download on storage.objects
 using (
   case when bucket_id = 'wm-private-evidence'
     then wm_private.can_access_evidence(name, false)
     else false end
 );
alter policy wm_request_evidence_storage_upload on storage.objects
 with check (
   case when bucket_id = 'wm-private-evidence'
     then wm_private.can_access_evidence(name, true)
     else false end
 );