-- Avoid scheduled repair errors when the source-derived search index is already complete.
create or replace function public.ti_backfill_missing_case_search(p_limit integer default 100)
returns integer language plpgsql security definer set search_path='' as $$
declare count_new integer;ids text[];
begin
 if p_limit<1 or p_limit>250 then raise exception 'limit must be 1–250';end if;
 select array_agg(id) into ids
 from (
  select c.id from public.ti_cases c
  left join public.ti_case_search_index i on i.case_id=c.id
  where i.case_id is null
  order by c.latest_notice_date desc,c.id limit p_limit
 ) missing;
 if ids is null then return 0;end if;
 select public.ti_refresh_case_search(ids) into count_new;
 return coalesce(count_new,0);
end $$;
