-- Recover procurement classifications ONLY from official source category codes.
-- Never infer engineering/goods/service from a title or from AI.
create or replace function public.ti_repair_case_categories(p_limit integer default 1500)
returns integer language plpgsql security invoker
set search_path = pg_catalog, public
as $$
declare v_count integer;
begin
 if p_limit is null or p_limit < 1 or p_limit > 5000 then raise exception 'invalid category repair batch'; end if;
 with known as (
   select distinct on (c.id) c.id,n.category,
     case when n.category like '工程類%' then '工程'
          when n.category like '財物類%' then '財物'
          when n.category like '勞務類%' then '勞務' end as new_group
   from public.ti_cases c
   join public.ti_notices n on n.case_id=c.id
   where (c.group_name is null or c.group_name='未分類')
     and (n.category like '工程類%' or n.category like '財物類%' or n.category like '勞務類%')
   order by c.id,n.source_date desc,n.filename desc
   limit p_limit
 )
 update public.ti_cases c set category=k.category,group_name=k.new_group
 from known k where c.id=k.id and k.new_group is not null;
 get diagnostics v_count=row_count;
 return v_count;
end;
$$;
revoke all on function public.ti_repair_case_categories(integer) from public,anon,authenticated;
grant execute on function public.ti_repair_case_categories(integer) to service_role;

create or replace function public.ti_sync_case_category_from_notice()
returns trigger language plpgsql security invoker
set search_path=pg_catalog,public
as $$
declare v_group text;
begin
 v_group:=case when new.category like '工程類%' then '工程'
               when new.category like '財物類%' then '財物'
               when new.category like '勞務類%' then '勞務'
               else null end;
 if v_group is not null then
  update public.ti_cases c set category=new.category,group_name=v_group
   where c.id=new.case_id and (c.group_name is null or c.group_name='未分類');
 end if;
 return new;
end;
$$;
drop trigger if exists ti_notice_fix_case_category on public.ti_notices;
create trigger ti_notice_fix_case_category
after insert or update of category on public.ti_notices
for each row execute function public.ti_sync_case_category_from_notice();

do $$
begin
 if exists (select 1 from cron.job where jobname='ti-category-repair') then
  perform cron.unschedule('ti-category-repair');
 end if;
 perform cron.schedule('ti-category-repair','*/5 * * * *',
  'select public.ti_repair_case_categories(1500);');
end $$;
comment on function public.ti_repair_case_categories(integer)
is 'Only use official archived notice category prefixes, never infer a procurement category from its title.';