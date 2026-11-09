-- A parent workspace deletion cascades into tasks/cases. The child DELETE
-- audit trigger must not recreate an activity referencing the now-deleted
-- parent. Explicit task/case deletes continue to create audit records.
create or replace function public.ti_team_audit()
returns trigger language plpgsql security definer set search_path=''
as $$
declare wid uuid; entity text; summary text;
begin
 wid:=case when TG_OP='DELETE' then old.workspace_id else new.workspace_id end;
 if not exists(select 1 from public.ti_workspaces where id=wid) then
  return case when TG_OP='DELETE' then old else new end;
 end if;
 if TG_TABLE_NAME='ti_workspace_cases' then
  entity:=case when TG_OP='DELETE' then old.case_id else new.case_id end;
  summary:=case when TG_OP='DELETE' then old.title else new.title end;
 elsif TG_TABLE_NAME='ti_workspace_tasks' then
  entity:=case when TG_OP='DELETE' then old.id::text else new.id::text end;
  summary:=case when TG_OP='DELETE' then old.title else new.title end;
 else
  entity:=case when TG_OP='DELETE' then old.task_id::text else new.task_id::text end;
  summary:='任務留言';
 end if;
 insert into public.ti_workspace_activity(workspace_id,actor_id,entity_kind,entity_id,action,summary)
 values(wid,(select auth.uid()),
  case when TG_TABLE_NAME='ti_workspace_cases' then 'case'
       when TG_TABLE_NAME='ti_workspace_tasks' then 'task' else 'comment' end,
  entity,case when TG_OP='INSERT' then 'created'
              when TG_OP='DELETE' then 'deleted' else 'updated' end,
  left(coalesce(summary,''),160));
 return case when TG_OP='DELETE' then old else new end;
end
$$;