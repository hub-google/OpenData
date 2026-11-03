-- PRD workspace collaboration. All seats are free in the testing phase.
create table if not exists public.ti_workspaces(
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references auth.users(id) on delete cascade,
 name text not null check(char_length(name) between 1 and 120),
 created_at timestamptz not null default now()
);
create table if not exists public.ti_workspace_members(
 workspace_id uuid not null references public.ti_workspaces(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 role text not null default 'editor' check (role in ('owner','admin','editor','viewer')),
 joined_at timestamptz not null default now(),
 primary key (workspace_id,user_id)
);
create table if not exists public.ti_workspace_invites(
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.ti_workspaces(id) on delete cascade,
 token_hash text not null unique,
 created_by uuid not null references auth.users(id) on delete cascade,
 created_at timestamptz not null default now(),
 expires_at timestamptz not null default now()+interval '7 days',
 redeemed_by uuid references auth.users(id)
);
create table if not exists public.ti_workspace_cases(
 workspace_id uuid not null references public.ti_workspaces(id) on delete cascade,
 case_id text not null,
 title text not null,
 agency text,
 stage text not null default '評估中'
  check(stage in ('評估中','準備投標','已投標','待決標','已得標','未得標','不投')),
 owner_id uuid references auth.users(id),
 notes text not null default '',
 due_at timestamptz,
 updated_at timestamptz not null default now(),
 primary key (workspace_id,case_id)
);
create table if not exists public.ti_workspace_tasks(
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.ti_workspaces(id) on delete cascade,
 case_id text,
 title text not null check(char_length(title) between 1 and 300),
 assigned_to uuid references auth.users(id),
 due_at timestamptz,
 done boolean not null default false,
 created_by uuid not null references auth.users(id),
 updated_at timestamptz not null default now()
);
create index if not exists ti_workspace_tasks_idx on public.ti_workspace_tasks(workspace_id,done);

create or replace function public.ti_is_workspace_member(w uuid) returns boolean
language sql stable security definer set search_path='' as $$
select exists(select 1 from public.ti_workspace_members m
 where m.workspace_id=w and m.user_id=(select auth.uid()));
$$;
create or replace function public.ti_is_workspace_editor(w uuid) returns boolean
language sql stable security definer set search_path='' as $$
select exists(select 1 from public.ti_workspace_members m
 where m.workspace_id=w and m.user_id=(select auth.uid()) and m.role in ('owner','admin','editor'));
$$;
create or replace function public.ti_is_workspace_owner(w uuid) returns boolean
language sql stable security definer set search_path='' as $$
select exists(select 1 from public.ti_workspaces x
 where x.id=w and x.owner_id=(select auth.uid()));
$$;
revoke all on function public.ti_is_workspace_member(uuid),public.ti_is_workspace_editor(uuid),public.ti_is_workspace_owner(uuid) from public,anon;
grant execute on function public.ti_is_workspace_member(uuid),public.ti_is_workspace_editor(uuid),public.ti_is_workspace_owner(uuid) to authenticated;

create or replace function public.ti_add_workspace_owner() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 insert into public.ti_workspace_members(workspace_id,user_id,role)
 values (new.id,new.owner_id,'owner');
 return new;
end $$;
revoke execute on function public.ti_add_workspace_owner() from public,anon,authenticated;
drop trigger if exists ti_workspace_owner_trigger on public.ti_workspaces;
create trigger ti_workspace_owner_trigger after insert on public.ti_workspaces
for each row execute function public.ti_add_workspace_owner();

-- Invitation token is only returned once. Its SHA-256 hash is stored; never store raw token.
create or replace function public.ti_create_workspace_invite(w uuid) returns text
language plpgsql security definer set search_path='' as $$
declare token text;
begin
 if (select auth.uid()) is null or not public.ti_is_workspace_owner(w)
 then raise exception 'Only the workspace owner can invite members'; end if;
 token:=encode(extensions.gen_random_bytes(24),'hex');
 insert into public.ti_workspace_invites(workspace_id,token_hash,created_by)
 values (w,encode(extensions.digest(token,'sha256'),'hex'),(select auth.uid()));
 return token;
end $$;

create or replace function public.ti_accept_workspace_invite(token text) returns uuid
language plpgsql security definer set search_path='' as $$
declare w uuid;
begin
 if (select auth.uid()) is null then raise exception 'Sign in to accept invitation';end if;
 update public.ti_workspace_invites
 set redeemed_by=(select auth.uid())
 where token_hash=encode(extensions.digest(token,'sha256'),'hex')
   and expires_at>now() and redeemed_by is null
 returning workspace_id into w;
 if w is null then raise exception 'Invitation is invalid, expired or already used'; end if;
 insert into public.ti_workspace_members(workspace_id,user_id,role)
 values(w,(select auth.uid()),'editor')
 on conflict(workspace_id,user_id) do nothing;
 return w;
end $$;

revoke all on function public.ti_create_workspace_invite(uuid),public.ti_accept_workspace_invite(text) from public,anon;
grant execute on function public.ti_create_workspace_invite(uuid),public.ti_accept_workspace_invite(text) to authenticated;

alter table public.ti_workspaces enable row level security;
alter table public.ti_workspace_members enable row level security;
alter table public.ti_workspace_invites enable row level security;
alter table public.ti_workspace_cases enable row level security;
alter table public.ti_workspace_tasks enable row level security;
revoke all on public.ti_workspaces,public.ti_workspace_members,public.ti_workspace_invites,
 public.ti_workspace_cases,public.ti_workspace_tasks from anon,authenticated;
grant select,insert,update,delete on public.ti_workspaces,public.ti_workspace_cases,
 public.ti_workspace_tasks to authenticated;
grant select,delete on public.ti_workspace_members to authenticated;
-- Never grant user-facing table access to invite hashes.

create policy ti_workspace_read on public.ti_workspaces for select to authenticated
 using(public.ti_is_workspace_member(id) or owner_id=(select auth.uid()));
create policy ti_workspace_create on public.ti_workspaces for insert to authenticated
 with check(owner_id=(select auth.uid()));
create policy ti_workspace_update on public.ti_workspaces for update to authenticated
 using(public.ti_is_workspace_owner(id))
 with check(public.ti_is_workspace_owner(id) and owner_id=(select auth.uid()));
create policy ti_workspace_delete on public.ti_workspaces for delete to authenticated
 using(public.ti_is_workspace_owner(id));

create policy ti_members_read on public.ti_workspace_members for select to authenticated
 using(public.ti_is_workspace_member(workspace_id));
create policy ti_members_leave on public.ti_workspace_members for delete to authenticated
 using((user_id=(select auth.uid()) and role<>'owner') or public.ti_is_workspace_owner(workspace_id) and role<>'owner');

create policy ti_workspace_cases_read on public.ti_workspace_cases for select to authenticated
 using(public.ti_is_workspace_member(workspace_id));
create policy ti_workspace_cases_insert on public.ti_workspace_cases for insert to authenticated
 with check(public.ti_is_workspace_editor(workspace_id));
create policy ti_workspace_cases_update on public.ti_workspace_cases for update to authenticated
 using(public.ti_is_workspace_editor(workspace_id))
 with check(public.ti_is_workspace_editor(workspace_id));
create policy ti_workspace_cases_delete on public.ti_workspace_cases for delete to authenticated
 using(public.ti_is_workspace_editor(workspace_id));

create policy ti_workspace_tasks_read on public.ti_workspace_tasks for select to authenticated
 using(public.ti_is_workspace_member(workspace_id));
create policy ti_workspace_tasks_insert on public.ti_workspace_tasks for insert to authenticated
 with check(public.ti_is_workspace_editor(workspace_id) and created_by=(select auth.uid()));
create policy ti_workspace_tasks_update on public.ti_workspace_tasks for update to authenticated
 using(public.ti_is_workspace_editor(workspace_id))
 with check(public.ti_is_workspace_editor(workspace_id));
create policy ti_workspace_tasks_delete on public.ti_workspace_tasks for delete to authenticated
 using(public.ti_is_workspace_editor(workspace_id));
