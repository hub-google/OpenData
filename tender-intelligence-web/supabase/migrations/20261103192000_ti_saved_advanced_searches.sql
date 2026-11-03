-- PRD U02: reusable private advanced-search profiles across devices.
create table if not exists public.ti_saved_searches(
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 name text not null check(char_length(trim(name)) between 2 and 120),
 criteria jsonb not null check(jsonb_typeof(criteria)='object' and pg_column_size(criteria)<=16000),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(user_id,name)
);
alter table public.ti_saved_searches enable row level security;
revoke all on public.ti_saved_searches from anon,authenticated;
grant select,insert,update,delete on public.ti_saved_searches to authenticated;
create policy ti_saved_searches_select on public.ti_saved_searches for select to authenticated
using((select auth.uid())=user_id);
create policy ti_saved_searches_insert on public.ti_saved_searches for insert to authenticated
with check((select auth.uid())=user_id);
create policy ti_saved_searches_update on public.ti_saved_searches for update to authenticated
using((select auth.uid())=user_id) with check((select auth.uid())=user_id);
create policy ti_saved_searches_delete on public.ti_saved_searches for delete to authenticated
using((select auth.uid())=user_id);
create index if not exists ti_saved_searches_owner_updated
 on public.ti_saved_searches(user_id,updated_at desc);
