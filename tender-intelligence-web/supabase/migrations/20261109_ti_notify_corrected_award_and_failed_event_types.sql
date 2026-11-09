-- Correct event classification while keeping existing unique per-user notice keys.

CREATE OR REPLACE FUNCTION public.ti_note_matches_new_notice()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  r record;
  c record;
  words text[];
  excluded text[];
  kind text;
begin
  select * into c from public.ti_cases where id=new.case_id;
  if not found then return new; end if;
  for r in select * from public.ti_watch_rules
           where enabled=true
             and created_at<=new.fetched_at
             and to_char(created_at at time zone 'Asia/Taipei','YYYYMMDD')::integer<=new.source_date
  loop
    if nullif(r.agency_id,'') is not null and r.agency_id<>c.unit_id then continue;end if;
    if nullif(r.group_name,'') is not null and r.group_name<>c.group_name then continue;end if;
    if (r.min_budget is not null or r.max_budget is not null) and new.budget_amount is null then continue;end if;
    if r.min_budget is not null and new.budget_amount<r.min_budget then continue;end if;
    if r.max_budget is not null and new.budget_amount>r.max_budget then continue;end if;
    words:=regexp_split_to_array(lower(r.keywords),'[,，、[:space:]]+');
    if not exists(select 1 from unnest(words) term where length(term)>0 and strpos(lower(coalesce(new.title,'')),term)>0) then continue;end if;
    excluded:=regexp_split_to_array(lower(r.excludes),'[,，、[:space:]]+');
    if exists(select 1 from unnest(excluded) term where length(term)>0 and strpos(lower(coalesce(new.title,'')),term)>0) then continue;end if;
    kind:=case when new.notice_type ~ '(無法決標|流標|廢標)' then '無法決標公告'
       when new.notice_type like '%更正決標%' then '決標更正公告'
       when new.notice_type like '%決標%' then '決標公告'
       when new.notice_type like '%更正%' then '更正公告'
       else '新公告' end;
    insert into public.ti_notifications(user_id,rule_id,case_id,notice_id,reason,match_rule_ids)
    values(r.user_id,r.id,new.case_id,new.id,kind,array[r.id])
    on conflict (user_id,notice_id,reason) do update
       set match_rule_ids=(select array_agg(distinct x)
         from unnest(public.ti_notifications.match_rule_ids||excluded.match_rule_ids) x)
    where not public.ti_notifications.match_rule_ids @> excluded.match_rule_ids;
  end loop;
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.ti_match_team_watch_notice()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare c public.ti_cases%rowtype;r record;words text[];excludes text[];kind text;
begin
 select * into c from public.ti_cases where id=new.case_id;
 if c.id is null then return new;end if;
 kind:=case when new.notice_type ~ '(無法決標|流標|廢標)' then '無法決標公告'
  when new.notice_type like '%更正決標%' then '決標更正公告'
  when new.notice_type like '%決標%' then '決標公告'
  when new.notice_type like '%更正%' then '更正公告'
  else '新公告' end;
 for r in
  select w.*,m.user_id from public.ti_workspace_watch_rules w
   join public.ti_workspace_members m on m.workspace_id=w.workspace_id
  where w.enabled and w.created_at<=new.fetched_at and m.joined_at<=new.fetched_at
   and to_char(w.created_at at time zone 'Asia/Taipei','YYYYMMDD')::integer<=new.source_date
   and to_char(m.joined_at at time zone 'Asia/Taipei','YYYYMMDD')::integer<=new.source_date
 loop
  if nullif(r.agency_id,'') is not null and r.agency_id<>c.unit_id then continue;end if;
  if nullif(r.group_name,'') is not null and r.group_name<>c.group_name then continue;end if;
  if (r.min_budget is not null or r.max_budget is not null) and new.budget_amount is null then continue;end if;
  if r.min_budget is not null and new.budget_amount<r.min_budget then continue;end if;
  if r.max_budget is not null and new.budget_amount>r.max_budget then continue;end if;
  words:=regexp_split_to_array(lower(replace(r.keywords,'臺','台')),'[,，、[:space:]]+');
  if not exists(select 1 from unnest(words) term where length(term)>0
    and strpos(lower(replace(coalesce(new.title,''),'臺','台')),term)>0) then continue;end if;
  excludes:=regexp_split_to_array(lower(replace(r.excludes,'臺','台')),'[,，、[:space:]]+');
  if exists(select 1 from unnest(excludes) term where length(term)>0
    and strpos(lower(replace(coalesce(new.title,''),'臺','台')),term)>0) then continue;end if;
  insert into public.ti_notifications(user_id,rule_id,case_id,notice_id,reason,match_rule_ids)
  values(r.user_id,null,new.case_id,new.id,kind,array[r.id])
  on conflict(user_id,notice_id,reason) do update
   set match_rule_ids=(select array_agg(distinct x)
     from unnest(public.ti_notifications.match_rule_ids||excluded.match_rule_ids) x)
  where not public.ti_notifications.match_rule_ids @> excluded.match_rule_ids;
 end loop;
 return new;
end $function$
;