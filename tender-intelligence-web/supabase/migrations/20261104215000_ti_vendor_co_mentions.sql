-- PRD V3: same-announcement co-mentioned companies, never infer a bid duel or winner.
-- A notice may list agency contacts, members of joint bids, awardees and suppliers.
create index if not exists ti_notices_company_ids_gin on public.ti_notices using gin(company_ids);

create or replace function public.ti_vendor_co_mentions(p_tax_id text,p_limit integer default 15)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
 if p_tax_id !~ '^[0-9]{8}$' or p_limit<1 or p_limit>30
 then raise exception '8-digit tax ID and limit 1–30 required' using errcode='22023';end if;
 with source as (
  select n.id as notice_id,n.case_id,n.source_date,n.company_ids
  from public.ti_notices n where n.company_ids @> array[p_tax_id]::text[]
 ), joined as (
  select src.notice_id,src.case_id,src.source_date,c.id as other_id
  from source src cross join lateral unnest(src.company_ids) as c(id)
  where c.id<>p_tax_id and c.id ~ '^[0-9]{8}$'
 ), counted as (
  select other_id,count(distinct notice_id) as shared_notices,
   count(distinct case_id) as shared_cases,
   min(source_date) first_date,max(source_date) last_date
  from joined group by other_id
 ), chosen as (
  select * from counted order by shared_notices desc,last_date desc,other_id
  limit p_limit
 )
 select jsonb_build_object(
  'company_id',p_tax_id,
  'source_notice_count',(select count(*) from source),
  'co_mentions',coalesce((
    select jsonb_agg(jsonb_build_object(
      'other_company_id',c.other_id,'shared_notices',c.shared_notices,
      'shared_cases',c.shared_cases,'first_date',c.first_date,'last_date',c.last_date,
      'cases',(select coalesce(jsonb_agg(to_jsonb(e) order by e.source_date desc),'[]'::jsonb)
       from (
         select j.source_date,x.unit_id,x.job_number,x.title,x.agency
         from joined j join public.ti_cases x on x.id=j.case_id
         where j.other_id=c.other_id
         order by j.source_date desc,j.notice_id desc limit 4
       ) e)
    ) order by c.shared_notices desc,c.last_date desc)
    from chosen c),'[]'::jsonb),
  'warning','Both company IDs appear in the same publicly archived notice. This does not prove competing bids, a co-bid, defeat, a winner or any company relationship.'
 ) into result;
 return result;
end $$;
revoke all on function public.ti_vendor_co_mentions(text,integer) from public;
grant execute on function public.ti_vendor_co_mentions(text,integer) to anon,authenticated;
