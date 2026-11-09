-- Only a workspace's real owner may grant/revoke admin/editor/viewer.
-- This SECURITY DEFINER endpoint is explicitly authenticated-only and checks
-- ownership from public.ti_workspaces, not untrusted user metadata.
create or replace function public.ti_set_workspace_member_role(
 p_workspace uuid,p_member uuid,p_role text
) returns text
language plpgsql security definer set search_path = ''
as $$
declare actor uuid; outcome text;
begin
 actor:=(select auth.uid());
 if actor is null then raise exception 'Sign in to manage a workspace'; end if;
 if p_workspace is null or p_member is null or p_role not in ('admin','editor','viewer')
 then raise exception 'Invalid workspace member role'; end if;
 if not exists(select 1 from public.ti_workspaces where id=p_workspace and owner_id=actor)
 then raise exception 'Only the workspace owner can manage member roles'; end if;
 update public.ti_workspace_members
 set role=p_role
 where workspace_id=p_workspace and user_id=p_member and role<>'owner'
 returning role into outcome;
 if outcome is null then raise exception 'Member not found or owner role is immutable'; end if;
 return outcome;
end;
$$;
revoke all on function public.ti_set_workspace_member_role(uuid,uuid,text) from public,anon;
grant execute on function public.ti_set_workspace_member_role(uuid,uuid,text) to authenticated;
comment on function public.ti_set_workspace_member_role(uuid,uuid,text)
 is 'Owner-only audited role change, never allows changing owner directly or escalating non-owners.';
