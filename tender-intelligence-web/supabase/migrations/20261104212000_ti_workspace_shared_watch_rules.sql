-- PRD U12 / V8: tenant-scoped shared watch rules and member alert matching.
create table if not exists public.ti_workspace_watch_rules (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.ti_workspaces(id) on delete cascade,
 created_by uuid not null references auth.users(id) on delete cascade,
 keywords text not null check(char_length(trim(keywords)) between 2 and 120),
 excludes text not null default '' check(char_length(excludes)<=250),
 agency_id text,
 group_name text,
 min_budget numeric,
 max_budget numeric,
 enabled boolean not null default true,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check(min_budget is null or min_budget>=0),
 check(max_budget is null or max_budget>=0),
 check(min_budget is null or max_budget is null or min_budget<=max_budget)
);
create index if not exists ti_team_watches_enabled on public.ti_workspace_watch_rules(workspace_id,enabled);
alter table public.ti_workspace_watch_rules enable row level security;
revoke all on public.ti_workspace_watch_rules from public,anon,authenticated;
grant select,insert,update,delete on public.ti_workspace_watch_rules to authenticated;

create or replace function public.ti_is_workspace_admin(w uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.ti_workspace_members m
   where m.workspace_id=w and m.user_id=(select auth.uid()) and m.role in ('owner','admin'))
$$;
revoke all on function public.ti_is_workspace_admin(uuid) from public,anon;
grant execute on function public.ti_is_workspace_admin(uuid) to authenticated;

create policy ti_team_watch_member_read on public.ti_workspace_watch_rules for select to authenticated
 using(public.ti_is_workspace_member(workspace_id));
create policy ti_team_watch_admin_insert on public.ti_workspace_watch_rules for insert to authenticated
 with check(public.ti_is_workspace_admin(workspace_id) and created_by=(select auth.uid()));
create policy ti_team_watch_admin_update on public.ti_workspace_watch_rules for update to authenticated
 using(public.ti_is_workspace_admin(workspace_id))
 with check(public.ti_is_workspace_admin(workspace_id));
create policy ti_team_watch_admin_delete on public.ti_workspace_watch_rules for delete to authenticated
 using(public.ti_is_workspace_admin(workspace_id));

create or replace function public.ti_team_watch_guard()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if TG_OP='UPDATE' and
 (new.id is distinct from old.id or new.workspace_id is distinct from old.workspace_id
  or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at)
 then raise exception 'Rule identity is immutable' using errcode='23514'; end if;
 if TG_OP='INSERT' then
  perform 1 from public.ti_workspaces where id=new.workspace_id for update;
  if (select count(*) from public.ti_workspace_watch_rules where workspace_id=new.workspace_id)>=100
  then raise exception 'Workspace watch rules limit reached' using errcode='23514';end if;
 end if;
 return new;
end $$;
revoke all on function public.ti_team_watch_guard() from public,anon,authenticated;
drop trigger if exists ti_team_watch_guard_trigger on public.ti_workspace_watch_rules;
create trigger ti_team_watch_guard_trigger before insert or update
 on public.ti_workspace_watch_rules for each row execute function public.ti_team_watch_guard();

-- Source notices are only matched when published after both rule creation and membership.
-- All matching team/personal rule IDs are recorded in ONE user + notice + reason notification.
create or replace function public.ti_match_team_watch_notice()
returns trigger language plpgsql security definer set search_path='' as $$
declare c public.ti_cases%rowtype;r record;words text[];excludes text[];kind text;
begin
 select * into c from public.ti_cases where id=new.case_id;
 if c.id is null then return new;end if;
 kind:=case when new.notice_type like '%更正%' then '更正公告'
  when new.notice_type like '%無法決標%' then '無法決標公告'
  when new.notice_type like '%決標%' then '決標公告'
  else '新公告' end;
 for r in
  select w.*,m.user_id from public.ti_workspace_watch_rules w
   join public.ti_workspace_members m on m.workspace_id=w.workspace_id
  where w.enabled and w.created_at<=new.fetched_at and m.joined_at<=new.fetched_at
   and to_char(w.created_at at time zone 'Asia/Taipei','YYYYMMDD')::integer<=new.source_date
   and to_char(m.joined_at at time zone 'Asia/Taipei','YYYYMMDD')::integer<=new.source_date
 loop
  if nullif(r.agency_id,'') is not null and r.agency_id<>c.unit_id then continue;end if;
  if nullif(r.group_name,'') is not null and r.group_name<>c.group_name then continue;end if;
  if (r.min_budget is not null or r.max_budget is not null) and new.budget_amount is null then continue;end if;
  if r.min_budget is not null and new.budget_amount<r.min_budget then continue;end if;
  if r.max_budget is not null and new.budget_amount>r.max_budget then continue;end if;
  words:=regexp_split_to_array(lower(replace(r.keywords,'臺','台')),'[,，、[:space:]]+');
  if not exists(select 1 from unnest(words) term where length(term)>0
    and strpos(lower(replace(coalesce(new.title,''),'臺','台')),term)>0) then continue;end if;
  excludes:=regexp_split_to_array(lower(replace(r.excludes,'臺','台')),'[,，、[:space:]]+');
  if exists(select 1 from unnest(excludes) term where length(term)>0
    and strpos(lower(replace(coalesce(new.title,''),'臺','台')),term)>0) then continue;end if;
  insert into public.ti_notifications(user_id,rule_id,case_id,notice_id,reason,match_rule_ids)
  values(r.user_id,null,new.case_id,new.id,kind,array[r.id])
  on conflict(user_id,notice_id,reason) do update
   set match_rule_ids=(select array_agg(distinct x)
     from unnest(public.ti_notifications.match_rule_ids||excluded.match_rule_ids) x)
  where not public.ti_notifications.match_rule_ids @> excluded.match_rule_ids;
 end loop;
 return new;
end $$;
revoke all on function public.ti_match_team_watch_notice() from public,anon,authenticated;
drop trigger if exists ti_team_watch_notice_insert on public.ti_notices;
create trigger ti_team_watch_notice_insert after insert on public.ti_notices
 for each row execute function public.ti_match_team_watch_notice();
