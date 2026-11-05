-- PRD V3: source-verified vendor participation and award evidence.
-- Role comes ONLY from real notice company_role_keys, never from a co-mention.
create or replace function public.ti_vendor_role_evidence(p_tax_id text)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
 if p_tax_id !~ '^[0-9]{8}$' then
  raise exception 'A valid eight-digit company ID is required' using errcode='22023';end if;
 with matched as materialized(
  select n.id as notice_id,n.case_id,n.source_date,n.notice_type,n.company_ids,
   n.company_names,n.company_role_keys,n.award_amount,
   array_position(n.company_ids,p_tax_id) as company_position
  from public.ti_notices n
  where n.company_ids @> array[p_tax_id]::text[]
 ), roles as(
  select m.*,m.company_names[m.company_position] as company_name,
   (select exists(select 1 from jsonb_array_elements_text(
    case when jsonb_typeof(m.company_role_keys->m.company_names[m.company_position])='array'
     then m.company_role_keys->m.company_names[m.company_position] else '[]'::jsonb end) v
     where v like '%:得標廠商%' and v not like '%:未得標廠商%')) as confirmed_winner,
   (select exists(select 1 from jsonb_array_elements_text(
    case when jsonb_typeof(m.company_role_keys->m.company_names[m.company_position])='array'
     then m.company_role_keys->m.company_names[m.company_position] else '[]'::jsonb end) v
     where v like '%:投標廠商%')) as confirmed_bidder,
   (select exists(select 1 from jsonb_array_elements_text(
    case when jsonb_typeof(m.company_role_keys->m.company_names[m.company_position])='array'
     then m.company_role_keys->m.company_names[m.company_position] else '[]'::jsonb end) v
     where v like '%:未得標廠商%')) as confirmed_nonwinner,
   (select count(*) from jsonb_object_keys(m.company_role_keys) key
    where exists(select 1 from jsonb_array_elements_text(
      case when jsonb_typeof(m.company_role_keys->key)='array'
       then m.company_role_keys->key else '[]'::jsonb end) v
      where v like '%:得標廠商%' and v not like '%:未得標廠商%')) as winner_count
  from matched m
 ), yearly as(
  select source_date/10000 as year,
   count(distinct notice_id) notice_mentions,
   count(distinct case_id) case_mentions,
   count(distinct notice_id) filter(where confirmed_bidder) explicit_bidder_notices,
   count(distinct notice_id) filter(where confirmed_winner) explicit_winner_notices,
   count(distinct notice_id) filter(where confirmed_nonwinner) explicit_nonwinner_notices,
   count(distinct notice_id) filter(where confirmed_winner and winner_count=1 and award_amount>0) single_winner_money_samples,
   coalesce(sum(award_amount) filter(where confirmed_winner and winner_count=1 and award_amount>0),0) single_winner_amount_samples
  from roles group by source_date/10000
 ), agencies as(
  select c.agency,c.unit_id,count(distinct r.notice_id) notice_mentions,
   count(distinct r.notice_id) filter(where r.confirmed_winner) confirmed_award_notices,
   max(r.source_date) last_notice_date
  from roles r join public.ti_cases c on c.id=r.case_id
  group by c.agency,c.unit_id
  order by confirmed_award_notices desc,notice_mentions desc,last_notice_date desc
  limit 15
 ), sample as(
  select r.source_date,r.notice_type,r.company_name,r.confirmed_bidder,r.confirmed_winner,r.confirmed_nonwinner,
   c.title,c.agency,c.unit_id,c.job_number,c.group_name,
   case when r.confirmed_winner and r.winner_count=1 and r.award_amount>0
    then r.award_amount else null end as whole_case_award_amount_single_winner
  from roles r join public.ti_cases c on c.id=r.case_id
  order by r.source_date desc,r.notice_id desc limit 25
 )
 select jsonb_build_object('company_id',p_tax_id,
  'notice_mentions',(select count(*) from matched),
  'years',coalesce((select jsonb_agg(to_jsonb(y) order by y.year) from yearly y),'[]'::jsonb),
  'agencies',coalesce((select jsonb_agg(to_jsonb(a)) from agencies a),'[]'::jsonb),
  'recent',coalesce((select jsonb_agg(to_jsonb(s) order by s.source_date desc) from sample s),'[]'::jsonb),
  'warning','Roles rely on exact source company-name keys. Missing roles do not mean a firm did not bid or win. Notices may not list all bidders, so do not compute win probability. Whole-case award amounts are shown only when exactly one winner is identified, and are not per-item prices.')
 into result;
 return result;
end $$;
revoke all on function public.ti_vendor_role_evidence(text) from public;
grant execute on function public.ti_vendor_role_evidence(text) to anon,authenticated;
