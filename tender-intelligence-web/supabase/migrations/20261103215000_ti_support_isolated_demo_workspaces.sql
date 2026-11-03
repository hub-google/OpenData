-- Demo logins use a per-anonymous-user sandbox, not the live staff queue.
alter table public.ti_support_threads add column if not exists is_demo boolean not null default false;
create index if not exists ti_support_demo_user_idx on public.ti_support_threads (user_id, updated_at desc) where is_demo = true;
comment on column public.ti_support_threads.is_demo is 'Sandbox tickets for one-click demo users; invisible to regular staff.';