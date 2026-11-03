-- V8: editors can submit finished work for review; only owners/admins approve/reject.
-- Prevent creating a task with forged reviewed status/identity.
create or replace function public.ti_team_assignment_guard()
returns trigger language plpgsql security definer set search_path='' as $$
declare target uuid; is_reviewer boolean;
begin
 if TG_TABLE_NAME='ti_workspace_cases' then target:=new.owner_id;
 else target:=new.assigned_to;end if;
 if target is not null and not exists(
  select 1 from public.ti_workspace_members m
  where m.workspace_id=new.workspace_id and m.user_id=target)
 then raise exception 'Assignee must belong to this workspace' using errcode='23514';end if;
 if TG_TABLE_NAME='ti_workspace_tasks' then
  if new.case_id is not null and not exists(
   select 1 from public.ti_workspace_cases c
   where c.workspace_id=new.workspace_id and c.case_id=new.case_id)
  then raise exception 'Task case must belong to this workspace' using errcode='23514';end if;
  if TG_OP='INSERT' then
   if new.review_status<>'未送審' or new.reviewed_by is not null or new.reviewed_at is not null
   then raise exception 'New task cannot pretend it was already reviewed' using errcode='42501';end if;
  else
   is_reviewer:=exists(select 1 from public.ti_workspace_members m
     where m.workspace_id=new.workspace_id and m.user_id=(select auth.uid())
       and m.role in ('owner','admin'));
   if new.review_status is distinct from old.review_status then
    if new.review_status='待審核' and old.review_status in ('未送審','退回') and new.done then
     new.reviewed_by:=null;new.reviewed_at:=null;
    elsif new.review_status in ('通過','退回')
      and old.review_status='待審核' and new.done and is_reviewer then
     new.reviewed_by:=(select auth.uid());new.reviewed_at:=now();
    elsif new.review_status='未送審' and is_reviewer then
     new.reviewed_by:=null;new.reviewed_at:=null;
    else raise exception 'Invalid task review transition or insufficient rights' using errcode='42501';end if;
   elsif new.reviewed_by is distinct from old.reviewed_by
      or new.reviewed_at is distinct from old.reviewed_at then
    raise exception 'Review identity cannot be changed directly' using errcode='42501';
   end if;
   if not new.done and new.review_status in ('通過','退回','待審核') then
    raise exception 'An incomplete task cannot retain reviewed status' using errcode='23514';
   end if;
  end if;
 end if;
 return new;
end $$;
revoke all on function public.ti_team_assignment_guard() from public,anon,authenticated;
