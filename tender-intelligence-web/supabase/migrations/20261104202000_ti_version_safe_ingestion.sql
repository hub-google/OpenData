-- PRD F06/F07/F09: historical backfill MUST NOT overwrite latest case state,
-- verified amounts or source links with an older/blank daily listing.
create or replace function public.ti_upsert_case_briefs(p_cases jsonb)
returns integer language plpgsql security definer set search_path='' as $$
declare affected integer:=0;
begin
 if jsonb_typeof(p_cases)<>'array' or jsonb_array_length(p_cases)>125 then
   raise exception 'Invalid case batch (max 125)' using errcode='22023';
 end if;
 insert into public.ti_cases(
  id,unit_id,job_number,title,agency,category,group_name,
  latest_notice_type,latest_notice_date,budget_amount,award_amount,
  official_url,latest_filename,source_fetched_at
 )
 select x.id,x.unit_id,x.job_number,x.title,x.agency,x.category,x.group_name,
   x.latest_notice_type,x.latest_notice_date,x.budget_amount,x.award_amount,
   x.official_url,x.latest_filename,coalesce(x.source_fetched_at,now())
 from jsonb_to_recordset(p_cases) as x(
  id text,unit_id text,job_number text,title text,agency text,category text,group_name text,
  latest_notice_type text,latest_notice_date integer,budget_amount numeric,award_amount numeric,
  official_url text,latest_filename text,source_fetched_at timestamptz
 )
 on conflict(id) do update set
  title=case when excluded.latest_notice_date>public.ti_cases.latest_notice_date
      or (excluded.latest_notice_date=public.ti_cases.latest_notice_date
          and excluded.latest_filename>public.ti_cases.latest_filename)
    then excluded.title else public.ti_cases.title end,
  agency=coalesce(excluded.agency,public.ti_cases.agency),
  category=case when excluded.latest_notice_date>=public.ti_cases.latest_notice_date
      then coalesce(excluded.category,public.ti_cases.category)
      else public.ti_cases.category end,
  group_name=case when excluded.latest_notice_date>=public.ti_cases.latest_notice_date
      then coalesce(excluded.group_name,public.ti_cases.group_name)
      else public.ti_cases.group_name end,
  latest_notice_type=case when excluded.latest_notice_date>public.ti_cases.latest_notice_date
      or (excluded.latest_notice_date=public.ti_cases.latest_notice_date
          and excluded.latest_filename>public.ti_cases.latest_filename)
    then coalesce(excluded.latest_notice_type,public.ti_cases.latest_notice_type)
    else public.ti_cases.latest_notice_type end,
  latest_notice_date=greatest(public.ti_cases.latest_notice_date,excluded.latest_notice_date),
  latest_filename=case when excluded.latest_notice_date>public.ti_cases.latest_notice_date
      or (excluded.latest_notice_date=public.ti_cases.latest_notice_date
          and excluded.latest_filename>public.ti_cases.latest_filename)
    then excluded.latest_filename else public.ti_cases.latest_filename end,
  budget_amount=case when excluded.latest_notice_date>=public.ti_cases.latest_notice_date
    then coalesce(excluded.budget_amount,public.ti_cases.budget_amount)
    else public.ti_cases.budget_amount end,
  award_amount=case when excluded.latest_notice_date>=public.ti_cases.latest_notice_date
    then coalesce(excluded.award_amount,public.ti_cases.award_amount)
    else public.ti_cases.award_amount end,
  official_url=coalesce(public.ti_cases.official_url,excluded.official_url),
  source_fetched_at=greatest(public.ti_cases.source_fetched_at,excluded.source_fetched_at);
 get diagnostics affected=row_count;
 return affected;
end $$;
revoke all on function public.ti_upsert_case_briefs(jsonb) from public,anon,authenticated;
grant execute on function public.ti_upsert_case_briefs(jsonb) to service_role;
