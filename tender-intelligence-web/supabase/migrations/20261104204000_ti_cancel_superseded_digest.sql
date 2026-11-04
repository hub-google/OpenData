-- PRD U06/U07: cancel a daily summary when every pending event was superseded.
create or replace function public.ti_cancel_stale_digest_batch(p_batch uuid)
returns void language plpgsql security definer set search_path='' as $$
declare b public.ti_digest_batches%rowtype;
begin
 select * into b from public.ti_digest_batches where id=p_batch for update;
 if b.id is null or b.status<>'processing' then raise exception 'Invalid digest claim';end if;
 if exists(select 1 from public.ti_notifications n
   where n.id=any(b.notification_ids) and n.stale_at is null)
 then raise exception 'Digest still has valid notices';end if;
 update public.ti_digest_batches set status='dead',
  last_attempt_at=now(),error_summary='All alerts were superseded by official corrections'
 where id=p_batch;
 insert into public.ti_delivery_attempts(notification_id,user_id,channel,status,
  attempts,last_attempt_at,error_summary)
 select n.id,b.user_id,b.channel,'dead',b.attempts,now(),'Superseded official deadline'
 from public.ti_notifications n where n.id=any(b.notification_ids)
 on conflict(notification_id,channel) do update set
  status='dead',attempts=greatest(public.ti_delivery_attempts.attempts,excluded.attempts),
  last_attempt_at=now(),error_summary=excluded.error_summary
 where public.ti_delivery_attempts.status<>'sent';
end $$;
revoke all on function public.ti_cancel_stale_digest_batch(uuid) from public,anon,authenticated;
grant execute on function public.ti_cancel_stale_digest_batch(uuid) to service_role;
