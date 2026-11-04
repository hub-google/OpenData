-- PRD V8 / U12: private team file attachments for shared bids and tasks.
-- Separate from personal ti-private-documents and all other projects' buckets.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('ti-workspace-documents','ti-workspace-documents',false,15728640,
 array['application/pdf',
       'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
       'text/plain','text/markdown'])
on conflict(id) do nothing;

create table if not exists public.ti_workspace_documents(
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.ti_workspaces(id) on delete cascade,
 case_id text,
 task_id uuid references public.ti_workspace_tasks(id) on delete set null,
 uploader_id uuid not null references auth.users(id) on delete cascade,
 storage_path text not null unique,
 filename text not null check(char_length(filename) between 1 and 200),
 mime_type text not null,
 bytes bigint not null check(bytes between 1 and 15728640),
 created_at timestamptz not null default now(),
 check(storage_path like workspace_id::text || '/%')
);
create index if not exists ti_workspace_documents_team
 on public.ti_workspace_documents(workspace_id,created_at desc);
create index if not exists ti_workspace_documents_task
 on public.ti_workspace_documents(task_id) where task_id is not null;
alter table public.ti_workspace_documents enable row level security;
revoke all on public.ti_workspace_documents from public,anon,authenticated;
grant select,insert,delete on public.ti_workspace_documents to authenticated;
create policy ti_team_documents_member_read on public.ti_workspace_documents for select to authenticated
 using(public.ti_is_workspace_member(workspace_id));
create policy ti_team_documents_editor_insert on public.ti_workspace_documents for insert to authenticated
 with check(public.ti_is_workspace_editor(workspace_id)
   and uploader_id=(select auth.uid()));
create policy ti_team_documents_writer_delete on public.ti_workspace_documents for delete to authenticated
 using(uploader_id=(select auth.uid()) or public.ti_is_workspace_admin(workspace_id));

-- Verify the reference actually belongs to this same workspace.
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
   o.bucket_id='ti-workspace-documents' and o.name=new.storage_path)
 then raise exception 'Attached file does not exist in private bucket' using errcode='23514';end if;
 return new;
end $$;
revoke all on function public.ti_workspace_document_guard() from public,anon,authenticated;
drop trigger if exists ti_workspace_document_guard_trg on public.ti_workspace_documents;
create trigger ti_workspace_document_guard_trg before insert on public.ti_workspace_documents
 for each row execute function public.ti_workspace_document_guard();

-- Safe conversion of first folder name to UUID or NULL, so other bucket filenames never throw.
create or replace function public.ti_workspace_folder_uuid(p_path text)
returns uuid language plpgsql immutable set search_path='' as $$
declare prefix text;
begin
 prefix:=split_part(coalesce(p_path,''),'/',1);
 if prefix ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
 then return prefix::uuid;end if;
 return null;
end $$;
revoke all on function public.ti_workspace_folder_uuid(text) from public,anon;
grant execute on function public.ti_workspace_folder_uuid(text) to authenticated;

create policy ti_workspace_storage_read on storage.objects for select to authenticated
 using(bucket_id='ti-workspace-documents'
   and public.ti_is_workspace_member(public.ti_workspace_folder_uuid(name)));
create policy ti_workspace_storage_write on storage.objects for insert to authenticated
 with check(bucket_id='ti-workspace-documents'
   and public.ti_is_workspace_editor(public.ti_workspace_folder_uuid(name)));
create policy ti_workspace_storage_delete on storage.objects for delete to authenticated
 using(bucket_id='ti-workspace-documents'
  and (owner=(select auth.uid())
    or public.ti_is_workspace_admin(public.ti_workspace_folder_uuid(name))));
