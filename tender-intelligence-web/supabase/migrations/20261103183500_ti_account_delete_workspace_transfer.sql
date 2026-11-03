-- PRD U11/U12 account deletion and company workspace ownership transfer.
-- Preserve shared task records without retaining deleted members' auth IDs.
alter table public.ti_workspace_cases
 drop constraint if exists ti_workspace_cases_owner_id_fkey;
alter table public.ti_workspace_cases
 add constraint ti_workspace_cases_owner_id_fkey
 foreign key(owner_id) references auth.users(id) on delete set null;

alter table public.ti_workspace_tasks
 alter column created_by drop not null;
alter table public.ti_workspace_tasks
 drop constraint if exists ti_workspace_tasks_created_by_fkey;
alter table public.ti_workspace_tasks
 add constraint ti_workspace_tasks_created_by_fkey
 foreign key(created_by) references auth.users(id) on delete set null;

alter table public.ti_workspace_tasks
 drop constraint if exists ti_workspace_tasks_assigned_to_fkey;
alter table public.ti_workspace_tasks
 add constraint ti_workspace_tasks_assigned_to_fkey
 foreign key(assigned_to) references auth.users(id) on delete set null;

alter table public.ti_workspace_invites
 drop constraint if exists ti_workspace_invites_redeemed_by_fkey;
alter table public.ti_workspace_invites
 add constraint ti_workspace_invites_redeemed_by_fkey
 foreign key(redeemed_by) references auth.users(id) on delete set null;

-- Only the existing owner can reassign ownership to an existing member.
-- Function is SECURITY DEFINER solely to atomically adjust the owner role.
create or replace function public.ti_transfer_workspace_owner(
 p_workspace uuid,p_new_owner uuid
) returns boolean language plpgsql security definer set search_path='' as $$
declare actor uuid;
begin
 actor:=auth.uid();
 if actor is null or p_new_owner is null or p_new_owner=actor then
   raise exception 'unauthorized workspace transfer';
 end if;
 if not exists(
  select 1 from public.ti_workspaces where id=p_workspace and owner_id=actor
 ) then raise exception 'only the current workspace owner may transfer ownership'; end if;
 if not exists(
  select 1 from public.ti_workspace_members where workspace_id=p_workspace and user_id=p_new_owner
 ) then raise exception 'new owner must be a current team member'; end if;
 update public.ti_workspace_members set role='admin'
  where workspace_id=p_workspace and user_id=actor and role='owner';
 update public.ti_workspace_members set role='owner'
  where workspace_id=p_workspace and user_id=p_new_owner;
 update public.ti_workspaces set owner_id=p_new_owner where id=p_workspace;
 return true;
end $$;
revoke all on function public.ti_transfer_workspace_owner(uuid,uuid) from public,anon,authenticated;
grant execute on function public.ti_transfer_workspace_owner(uuid,uuid) to authenticated;
