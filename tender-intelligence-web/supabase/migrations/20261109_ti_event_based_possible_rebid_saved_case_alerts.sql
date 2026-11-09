
-- Event-driven, source-backed *possible* re-tender lead for cloud-saved cases.
-- Never merges separate case IDs and never calls it a confirmed re-tender.
create or replace function public.ti_notify_possible_rebid()
returns trigger language plpgsql security definer set search_path = ''
as $fn$
declare target public.ti_cases%rowtype;
begin
 if public.ti_case_stage(new.notice_type)<>'招標' then return new; end if;
 select * into target from public.ti_cases where id=new.case_id;
 if not found or length(coalesce(target.title,''))<6 then return new; end if;
 -- Backfill must not generate retroactive alerts for notices predating a save.
 insert into public.ti_notifications(user_id,rule_id,case_id,notice_id,reason,match_rule_ids)
 select distinct s.user_id,null,new.case_id,new.id,'可能重招線索',array[]::uuid[]
 from public.ti_saved_cases s
 join public.ti_cases prior on prior.id=s.case_id
 where prior.unit_id=target.unit_id and prior.id<>new.case_id
   and prior.latest_notice_date<=new.source_date
   and s.added_at<=new.fetched_at
   and to_char(s.added_at at time zone 'Asia/Taipei','YYYYMMDD')::integer<=new.source_date
   and length(regexp_replace(lower(replace(prior.title,'臺','台')),
       '[[:space:][:punct:]、（）]+','','g'))>=6
   and regexp_replace(
      regexp_replace(lower(replace(prior.title,'臺','台')),
        '[0-9]{3,4}([/\\-~至][0-9]{3,4})?年度?','','g'),
      '[[:space:][:punct:]、（）]+','','g')
    =regexp_replace(
      regexp_replace(lower(replace(target.title,'臺','台')),
        '[0-9]{3,4}([/\\-~至][0-9]{3,4})?年度?','','g'),
      '[[:space:][:punct:]、（）]+','','g')
 on conflict (user_id,notice_id,reason) do nothing;
 return new;
end;
$fn$;
revoke all on function public.ti_notify_possible_rebid() from public, anon, authenticated;
drop trigger if exists ti_possible_rebid_notice_insert on public.ti_notices;
create trigger ti_possible_rebid_notice_insert
 after insert on public.ti_notices for each row
 execute function public.ti_notify_possible_rebid();
