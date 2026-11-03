-- V1: evidence-backed user feedback to tune future matching, never a fabricated win rate.
create table if not exists public.ti_match_feedback(
 user_id uuid not null references auth.users(id) on delete cascade,
 case_id text not null references public.ti_cases(id) on delete cascade,
 verdict text not null check(verdict in ('relevant','irrelevant')),
 reason text not null default '' check(char_length(reason)<=600),
 updated_at timestamptz not null default now(),
 primary key(user_id,case_id)
);
alter table public.ti_match_feedback enable row level security;
revoke all on public.ti_match_feedback from anon,authenticated;
grant select,insert,update,delete on public.ti_match_feedback to authenticated;
create policy ti_match_feedback_self on public.ti_match_feedback
 for all to authenticated using((select auth.uid())=user_id)
 with check((select auth.uid())=user_id);
create index if not exists ti_match_feedback_recent on public.ti_match_feedback(user_id,updated_at desc);
