-- PRD 9,12: honest source registry and daily data-quality verification.
-- Rights deliberately remain 'unknown' until an actual license decision is documented.
alter table public.ti_sources
 add column if not exists data_scope text not null default '來源涵蓋範圍待獨立驗證',
 add column if not exists data_categories text[] not null default '{}'::text[],
 add column if not exists available_fields text[] not null default '{}'::text[],
 add column if not exists license_terms_url text,
 add column if not exists license_reviewed_at timestamptz,
 add column if not exists can_store_raw text not null default 'unknown'
   check(can_store_raw in ('unknown','allowed','prohibited')),
 add column if not exists can_redistribute_api text not null default 'unknown'
   check(can_redistribute_api in ('unknown','allowed','prohibited'));

update public.ti_sources
set data_scope='OpenFun API 可取得的政府電子採購網公告；不代表官方所有年度／類型已完整收錄',
 data_categories=array['招標','決標','更正','無法決標','公開閱覽／公開徵求（視來源公告）'],
 available_fields=array['unit_id','job_number','date','filename','brief.type','brief.title',
   'brief.category','company_ids（部分公告）','company_names（部分公告）',
   '預算與決標金額（部分公告／詳情）','截止時間（部分詳情）']
where id='openfun-pcc';

create table if not exists public.ti_data_quality_checks(
 report_date date primary key,
 checked_at timestamptz not null default now(),
 case_count bigint not null,
 notice_count bigint not null,
 detail_count bigint not null,
 open_deadline_count bigint not null,
 budget_known_count bigint not null,
 budget_unknown_count bigint not null,
 version_mismatch_count bigint not null,
 unresolved_gap_count bigint not null,
 prior_day_notices bigint,
 preceding_day_notices bigint,
 prior_day_deviation numeric,
 last_source_success_at timestamptz,
 status text not null check(status in ('normal','review','source_stale')),
 notes text not null default ''
);
alter table public.ti_data_quality_checks enable row level security;
revoke all on public.ti_data_quality_checks from public,anon,authenticated;
grant select on public.ti_data_quality_checks to anon,authenticated;
create policy ti_quality_public_read on public.ti_data_quality_checks
 for select to anon,authenticated using(true);

create or replace function public.ti_run_data_quality_check()
returns jsonb language plpgsql security definer set search_path='' as $$
declare today date;prev int;before_prev int;
 c_total bigint;n_total bigint;d_total bigint;deadline_count bigint;
 budget_yes bigint;budget_no bigint;version_bad bigint;gaps bigint;
 n_prev bigint;n_before bigint;ratio numeric;source_at timestamptz;
 prev_success boolean;before_success boolean;health text;message text;
begin
 today:=(now() at time zone 'Asia/Taipei')::date;
 prev:=to_char(today-1,'YYYYMMDD')::integer;
 before_prev:=to_char(today-2,'YYYYMMDD')::integer;
 select count(*),count(*) filter(where deadline_at>now()),
   count(*) filter(where budget_amount is not null),count(*) filter(where budget_amount is null)
 into c_total,deadline_count,budget_yes,budget_no from public.ti_cases;
 select count(*) into n_total from public.ti_notices;
 select count(*) into d_total from public.ti_case_details;
 select count(*) into gaps from public.ti_backfill_gaps where resolved_at is null;
 with newest as (
  select case_id,max(source_date) as max_date from public.ti_notices group by case_id
 )
 select count(*) into version_bad
 from newest n join public.ti_cases c on c.id=n.case_id
 where c.latest_notice_date is distinct from n.max_date;
 select count(*) filter(where source_date=prev),
   count(*) filter(where source_date=before_prev)
 into n_prev,n_before from public.ti_notices where source_date in(prev,before_prev);
 select exists(select 1 from public.ti_ingest_runs where source_date=prev and status='success'),
 exists(select 1 from public.ti_ingest_runs where source_date=before_prev and status='success')
 into prev_success,before_success;
 if prev_success and before_success and n_before>0 then
   ratio:=round(abs(n_prev-n_before)::numeric/n_before,4);
 else
   ratio:=null;
 end if;
 select last_success_at into source_at from public.ti_sources where id='openfun-pcc';
 health:=case when source_at is null or source_at<now()-interval '3 hours' then 'source_stale'
  when version_bad>0 or gaps>0 or (ratio is not null and ratio>0.5) then 'review'
  else 'normal' end;
 message:=concat_ws('；',
  case when version_bad>0 then '案件最新版本與公告來源不一致' end,
  case when gaps>0 then '仍有未補齊來源日期' end,
  case when ratio is null then '前兩日完整匯入無可比較樣本；不推定零公告'
   when ratio>0.5 then '前兩日公告量變動較大；不代表異常必須複核' end,
  case when source_at is null or source_at<now()-interval '3 hours' then '來源同步超過三小時未成功' end
 );
 insert into public.ti_data_quality_checks(
  report_date,checked_at,case_count,notice_count,detail_count,open_deadline_count,
  budget_known_count,budget_unknown_count,version_mismatch_count,unresolved_gap_count,
  prior_day_notices,preceding_day_notices,prior_day_deviation,last_source_success_at,status,notes)
 values(today,now(),c_total,n_total,d_total,deadline_count,budget_yes,budget_no,version_bad,gaps,
  case when prev_success then n_prev else null end,
  case when before_success then n_before else null end,ratio,source_at,health,message)
 on conflict(report_date) do update set
  checked_at=excluded.checked_at,case_count=excluded.case_count,notice_count=excluded.notice_count,
  detail_count=excluded.detail_count,open_deadline_count=excluded.open_deadline_count,
  budget_known_count=excluded.budget_known_count,budget_unknown_count=excluded.budget_unknown_count,
  version_mismatch_count=excluded.version_mismatch_count,unresolved_gap_count=excluded.unresolved_gap_count,
  prior_day_notices=excluded.prior_day_notices,preceding_day_notices=excluded.preceding_day_notices,
  prior_day_deviation=excluded.prior_day_deviation,last_source_success_at=excluded.last_source_success_at,
  status=excluded.status,notes=excluded.notes;
 return jsonb_build_object('date',today,'status',health,'cases',c_total,'notices',n_total,
  'details',d_total,'missing_budget',budget_no,'version_mismatch',version_bad,
  'missing_source_days',gaps,'daily_deviation',ratio,'last_success_at',source_at);
end $$;
revoke all on function public.ti_run_data_quality_check() from public,anon,authenticated;
grant execute on function public.ti_run_data_quality_check() to service_role;

select cron.schedule('ti_daily_quality_check','15 0 * * *',$job$
 select public.ti_run_data_quality_check();
$job$);
