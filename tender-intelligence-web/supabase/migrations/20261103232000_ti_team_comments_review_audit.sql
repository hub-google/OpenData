-- V8: team assignment, review, comments and immutable member-scoped activity log.
alter table public.ti_workspace_tasks
 add column if not exists review_status text not null default '未送審'
 check(review_status in ('未送審','待審核','通過','退回'));
alter table public.ti_workspace_tasks
 add column if not exists reviewed_by uuid references auth.users(id),
 add column if not exists reviewed_at timestamptz;

create table if not exists public.ti_workspace_task_comments(
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.ti_workspaces(id) on delete cascade,
 task_id uuid not null references public.ti_workspace_tasks(id) on delete cascade,
 author_id uuid not null references auth.users(id) on delete cascade,
 body text not null check(char_length(trim(body)) between 1 and 2000),
 created_at timestamptz not null default now()
);
create index if not exists ti_task_comments_recent
 on public.ti_workspace_task_comments(workspace_id,task_id,created_at desc);
alter table public.ti_workspace_task_comments enable row level security;
revoke all on public.ti_workspace_task_comments from anon,authenticated;
grant select,insert,delete on public.ti_workspace_task_comments to authenticated;
create policy ti_comments_workspace_read on public.ti_workspace_task_comments
 for select to authenticated using(public.ti_is_workspace_member(workspace_id));
create policy ti_comments_workspace_insert on public.ti_workspace_task_comments
 for insert to authenticated
 with check(author_id=(select auth.uid()) and public.ti_is_workspace_editor(workspace_id));
create policy ti_comments_owner_delete on public.ti_workspace_task_comments
 for delete to authenticated using(author_id=(select auth.uid()));

create table if not exists public.ti_workspace_activity(
 id bigint generated always as identity primary key,
 workspace_id uuid not null references public.ti_workspaces(id) on delete cascade,
 actor_id uuid references auth.users(id) on delete set null,
 entity_kind text not null check(entity_kind in ('case','task','comment')),
 entity_id text not null,
 action text not null check(action in ('created','updated','deleted')),
 summary text not null default '',
 changed_at timestamptz not null default now()
);
create index if not exists ti_workspace_activity_recent
 on public.ti_workspace_activity(workspace_id,changed_at desc);
alter table public.ti_workspace_activity enable row level security;
revoke all on public.ti_workspace_activity from public,anon,authenticated;
grant select on public.ti_workspace_activity to authenticated;
grant all on public.ti_workspace_activity to service_role;
create policy ti_workspace_activity_member_read on public.ti_workspace_activity
 for select to authenticated using(public.ti_is_workspace_member(workspace_id));

-- Validate that new assignment can only target current members of this workspace.
create or replace function public.ti_team_assignment_guard()
returns trigger language plpgsql security definer set search_path='' as $$
declare target uuid;
begin
 if TG_TABLE_NAME='ti_workspace_cases' then target:=new.owner_id;
 else target:=new.assigned_to;end if;
 if target is not null and not exists(
  select 1 from public.ti_workspace_members m
  where m.workspace_id=new.workspace_id and m.user_id=target
 ) then raise exception 'Assignee must belong to this workspace' using errcode='23514';end if;
 if TG_TABLE_NAME='ti_workspace_tasks' then
  if new.case_id is not null and not exists(
   select 1 from public.ti_workspace_cases c
   where c.workspace_id=new.workspace_id and c.case_id=new.case_id
  ) then raise exception 'Task case must belong to this workspace' using errcode='23514';end if;
  if TG_OP='UPDATE'
     and (new.review_status is distinct from old.review_status or
          new.reviewed_by is distinct from old.reviewed_by or
          new.reviewed_at is distinct from old.reviewed_at) then
   if not exists(select 1 from public.ti_workspace_members m
     where m.workspace_id=new.workspace_id and m.user_id=(select auth.uid())
       and m.role in ('owner','admin'))
   then raise exception 'Only workspace owner/admin may review tasks' using errcode='42501';end if;
  end if;
  if new.review_status in ('通過','退回') and not new.done
  then raise exception 'Only completed tasks can receive a final review' using errcode='23514';end if;
  if new.review_status in ('通過','退回') then
   new.reviewed_by=(select auth.uid());new.reviewed_at=now();
  end if;
 end if;
 return new;
end $$;
revoke all on function public.ti_team_assignment_guard() from public,anon,authenticated;
drop trigger if exists ti_team_cases_guard on public.ti_workspace_cases;
create trigger ti_team_cases_guard before insert or update on public.ti_workspace_cases
 for each row execute function public.ti_team_assignment_guard();
drop trigger if exists ti_team_tasks_guard on public.ti_workspace_tasks;
create trigger ti_team_tasks_guard before insert or update on public.ti_workspace_tasks
 for each row execute function public.ti_team_assignment_guard();

create or replace function public.ti_team_comment_guard()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.ti_workspace_tasks t
     where t.id=new.task_id and t.workspace_id=new.workspace_id)
 then raise exception 'Comment does not belong to this workspace task' using errcode='23514';end if;
 return new;
end $$;
revoke all on function public.ti_team_comment_guard() from public,anon,authenticated;
drop trigger if exists ti_team_comments_guard on public.ti_workspace_task_comments;
create trigger ti_team_comments_guard before insert on public.ti_workspace_task_comments
 for each row execute function public.ti_team_comment_guard();

create or replace function public.ti_team_audit()
returns trigger language plpgsql security definer set search_path='' as $$
declare wid uuid;entity text;summary text;
begin
 wid:=case when TG_OP='DELETE' then old.workspace_id else new.workspace_id end;
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
end $$;
revoke all on function public.ti_team_audit() from public,anon,authenticated;
drop trigger if exists ti_team_cases_audit on public.ti_workspace_cases;
create trigger ti_team_cases_audit after insert or update or delete on public.ti_workspace_cases
 for each row execute function public.ti_team_audit();
drop trigger if exists ti_team_tasks_audit on public.ti_workspace_tasks;
create trigger ti_team_tasks_audit after insert or update or delete on public.ti_workspace_tasks
 for each row execute function public.ti_team_audit();
drop trigger if exists ti_team_comments_audit on public.ti_workspace_task_comments;
create trigger ti_team_comments_audit after insert or delete on public.ti_workspace_task_comments
 for each row execute function public.ti_team_audit();
