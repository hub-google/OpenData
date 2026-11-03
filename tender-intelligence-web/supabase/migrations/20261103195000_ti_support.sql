-- Support tickets and AI chat history, stored privately in existing Supabase.
-- An Edge Function verifies the browser's random token or signed-in user before every read/write.
create table if not exists public.ti_support_threads (
 id uuid primary key default gen_random_uuid(),
 user_id uuid references auth.users(id) on delete set null,
 visitor_hash text not null check (length(visitor_hash)=64),
 kind text not null check (kind in ('ai','form')),
 category text not null default 'general' check (category in ('general','data','system','billing','suggestion','other')),
 subject text not null default '' check (length(subject)<=160),
 case_id text,
 page_url text not null default '' check (length(page_url)<=700),
 urgent boolean not null default false,
 status text not null default 'open' check (status in ('open','in_progress','replied','closed')),
 customer_read_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists ti_support_threads_user_idx on public.ti_support_threads(user_id,updated_at desc);
create index if not exists ti_support_threads_visitor_idx on public.ti_support_threads(visitor_hash,updated_at desc);
create index if not exists ti_support_threads_status_idx on public.ti_support_threads(kind,status,updated_at desc);
create table if not exists public.ti_support_messages (
 id bigint generated always as identity primary key,
 thread_id uuid not null references public.ti_support_threads(id) on delete cascade,
 role text not null check (role in ('customer','assistant','staff')),
 body text not null check (length(body) between 1 and 6000),
 created_at timestamptz not null default now()
);
create index if not exists ti_support_messages_thread_idx on public.ti_support_messages(thread_id,id);
create table if not exists public.ti_support_staff (
 user_id uuid primary key references auth.users(id) on delete cascade,
 created_at timestamptz not null default now()
);
alter table public.ti_support_threads enable row level security;
alter table public.ti_support_messages enable row level security;
alter table public.ti_support_staff enable row level security;
revoke all on public.ti_support_threads,public.ti_support_messages,public.ti_support_staff from anon,authenticated;
grant all on public.ti_support_threads,public.ti_support_messages,public.ti_support_staff to service_role;
grant usage,select on sequence public.ti_support_messages_id_seq to service_role;
comment on table public.ti_support_threads is 'Private AI/form support records accessed by a verified Edge Function.';
comment on table public.ti_support_staff is 'Manually assigned support staff user IDs. Never self-enroll from a public browser.';