-- First-party support: private owner allowlist, never expose personal emails in Git.
-- The dashboard owner can populate this table using a SHA-256 digest of a verified Auth email.
create table if not exists public.ti_support_admin_owners (
  email_sha256 text primary key check (email_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
);
alter table public.ti_support_admin_owners enable row level security;
revoke all on public.ti_support_admin_owners from anon, authenticated;
grant select on public.ti_support_admin_owners to service_role;
comment on table public.ti_support_admin_owners is 'Private verified owner-email hashes to authorize support administrator bootstrap, no personal addresses in public code.';
