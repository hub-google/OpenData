-- U03: explicit per-account read/unread status, nullable until opened/marked.
alter table public.ti_saved_cases add column if not exists read_at timestamptz;
create index if not exists ti_saved_unread_idx
 on public.ti_saved_cases(user_id,read_at,added_at desc);
-- Existing self-scoped RLS and owner-only grants protect this column.
