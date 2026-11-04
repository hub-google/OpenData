-- PRD U12: prevent editors from attributing another teammate's uploaded file to themselves.
create or replace function public.ti_workspace_document_guard()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.case_id is not null and not exists(
  select 1 from public.ti_workspace_cases c
  where c.workspace_id=new.workspace_id and c.case_id=new.case_id)
 then raise exception 'Attachment case must belong to workspace' using errcode='23514';end if;
 if new.task_id is not null and not exists(
  select 1 from public.ti_workspace_tasks t
  where t.workspace_id=new.workspace_id and t.id=new.task_id)
 then raise exception 'Attachment task must belong to workspace' using errcode='23514';end if;
 if not exists(select 1 from storage.objects o where
   o.bucket_id='ti-workspace-documents' and o.name=new.storage_path
   and o.owner=(select auth.uid()))
 then raise exception 'Attached file does not exist in private bucket' using errcode='23514';end if;
 return new;
end $$;
