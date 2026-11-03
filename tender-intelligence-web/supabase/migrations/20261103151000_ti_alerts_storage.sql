-- Server-side match engine for genuine newly inserted government notices.
-- New watch rules never generate notifications for old historical cases.
create or replace function public.ti_note_matches_new_notice() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  c record;
  words text[];
  excluded text[];
begin
  select * into c from public.ti_cases where id = new.case_id;
  if not found then return new; end if;
  for r in select * from public.ti_watch_rules
           where enabled = true
             and created_at <= new.fetched_at
             and to_char(created_at at time zone 'Asia/Taipei','YYYYMMDD')::integer <= new.source_date
  loop
    if r.agency_id is not null and r.agency_id <> '' and r.agency_id <> c.unit_id then continue; end if;
    if r.group_name is not null and r.group_name <> '' and
       (case when c.category like '工程%' then '工程'
             when c.category like '財物%' then '財物'
             when c.category like '勞務%' then '勞務'
             else '未分類' end) <> r.group_name then continue; end if;
    if (r.min_budget is not null or r.max_budget is not null) and new.budget_amount is null then continue; end if;
    if r.min_budget is not null and new.budget_amount < r.min_budget then continue; end if;
    if r.max_budget is not null and new.budget_amount > r.max_budget then continue; end if;
    words := regexp_split_to_array(lower(r.keywords),'[,，、[:space:]]+');
    if not exists (select 1 from unnest(words) term where length(term)>0 and strpos(lower(coalesce(new.title,'')),term)>0) then continue; end if;
    excluded := regexp_split_to_array(lower(r.excludes),'[,，、[:space:]]+');
    if exists (select 1 from unnest(excluded) term where length(term)>0 and strpos(lower(coalesce(new.title,'')),term)>0) then continue; end if;
    insert into public.ti_notifications(user_id,rule_id,case_id,notice_id,reason)
    values (r.user_id,r.id,new.case_id,new.id,case when new.notice_type like '%更正%' then '更正公告'
           when new.notice_type like '%決標%' then '決標公告' else '新公告' end)
    on conflict (user_id,rule_id,notice_id) do nothing;
  end loop;
  return new;
end $$;
revoke execute on function public.ti_note_matches_new_notice() from public,anon,authenticated;
drop trigger if exists ti_notice_match_trigger on public.ti_notices;
create trigger ti_notice_match_trigger after insert on public.ti_notices
for each row execute function public.ti_note_matches_new_notice();

-- Preserve most recent case state when historical dates are backfilled out of order.
create or replace function public.ti_preserve_latest_case() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.latest_notice_date is null or (old.latest_notice_date is not null and new.latest_notice_date < old.latest_notice_date) then
    new.title:=old.title;
    new.agency:=old.agency;
    new.category:=old.category;
    new.group_name:=old.group_name;
    new.latest_notice_type:=old.latest_notice_type;
    new.latest_notice_date:=old.latest_notice_date;
    new.latest_filename:=old.latest_filename;
    new.official_url:=old.official_url;
    new.deadline_at:=old.deadline_at;
  end if;
  if new.budget_amount is null then new.budget_amount:=old.budget_amount; end if;
  if new.award_amount is null then new.award_amount:=old.award_amount; end if;
  new.first_seen_at:=old.first_seen_at;
  return new;
end $$;
drop trigger if exists ti_case_preserve_trigger on public.ti_cases;
create trigger ti_case_preserve_trigger before update on public.ti_cases
for each row execute function public.ti_preserve_latest_case();

-- A named document bucket with owner-only storage policies.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('ti-private-documents','ti-private-documents',false,15728640,
 array['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','text/plain','text/markdown'])
on conflict(id) do nothing;
drop policy if exists ti_documents_owner_read on storage.objects;
create policy ti_documents_owner_read on storage.objects for select to authenticated
using(bucket_id='ti-private-documents' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists ti_documents_owner_write on storage.objects;
create policy ti_documents_owner_write on storage.objects for insert to authenticated
with check(bucket_id='ti-private-documents' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists ti_documents_owner_update on storage.objects;
create policy ti_documents_owner_update on storage.objects for update to authenticated
using(bucket_id='ti-private-documents' and (storage.foldername(name))[1] = (select auth.uid())::text)
with check(bucket_id='ti-private-documents' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists ti_documents_owner_delete on storage.objects;
create policy ti_documents_owner_delete on storage.objects for delete to authenticated
using(bucket_id='ti-private-documents' and (storage.foldername(name))[1] = (select auth.uid())::text);
