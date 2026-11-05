-- A user-requested second verification is eligible even if the latest notice
-- version was already fetched but some fields were absent upstream.
create or replace function public.ti_pick_details_enrichment(p_limit integer default 8)
returns table(case_id text,unit_id text,job_number text,latest_notice_date integer,latest_notice_type text,latest_filename text)
language sql stable security invoker set search_path=pg_catalog,public
as $$
 select c.id,c.unit_id,c.job_number,c.latest_notice_date,c.latest_notice_type,c.latest_filename
 from public.ti_cases c
 left join public.ti_case_details d on d.case_id=c.id
 left join public.ti_detail_enrichment_attempts a on a.case_id=c.id
 left join (select case_id,min(requested_at) as first_requested from public.ti_detail_requests
            where status='queued' group by case_id) r on r.case_id=c.id
 where (r.first_requested is not null or d.case_id is null
        or d.latest_notice_id is distinct from (c.id||'::'||c.latest_notice_date::text||'::'||coalesce(c.latest_filename,'')))
   and (a.next_retry_at is null or a.next_retry_at<=now())
   and length(c.unit_id) between 1 and 80 and length(c.job_number) between 1 and 100
 order by
   case when r.first_requested is not null then -1
        when coalesce(c.latest_notice_type,'') ~ '(公開招標公告|公開取得報價單|限制性招標公告|選擇性招標)' then 0
        when coalesce(c.latest_notice_type,'') ~ '(更正公告|招標)' then 1
        when coalesce(c.latest_notice_type,'') ~ '(公開徵求|公開閱覽)' then 2
        else 3 end,
   r.first_requested nulls last,c.latest_notice_date desc,c.id asc
 limit least(greatest(coalesce(p_limit,8),1),12)
$$;