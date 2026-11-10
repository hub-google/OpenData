-- W06 source-based editable proposal draft, one per private account and official case.
create table if not exists public.ti_proposal_drafts (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
 case_id text not null references public.ti_cases(id) on delete cascade,
 title text not null default '' check (char_length(title) between 0 and 250),
 content_md text not null default '' check (char_length(content_md)<=100000),
 source_refs jsonb not null default '[]'::jsonb check (jsonb_typeof(source_refs)='array'),
 generation_mode text not null default 'evidence_template'
  check (generation_mode in ('evidence_template','ai_assisted','manual')),
 review_status text not null default 'unreviewed'
  check (review_status in ('unreviewed','needs_review','reviewed')),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique (user_id,case_id)
);
alter table public.ti_proposal_drafts enable row level security;
drop policy if exists ti_proposal_drafts_owner on public.ti_proposal_drafts;
create policy ti_proposal_drafts_owner on public.ti_proposal_drafts
 for all to authenticated
 using ((select auth.uid())=user_id and
        (select auth.jwt()->>'is_anonymous') is distinct from 'true')
 with check ((select auth.uid())=user_id and
        (select auth.jwt()->>'is_anonymous') is distinct from 'true');
revoke all on public.ti_proposal_drafts from anon;
grant select,insert,update,delete on public.ti_proposal_drafts to authenticated;
create index if not exists ti_proposal_drafts_user_updated_idx
 on public.ti_proposal_drafts(user_id,updated_at desc);
