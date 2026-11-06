-- Retry unresolved official source dates hourly, rotating oldest last-attempt first.
do $$
declare v_command text;
begin
 select command into v_command from cron.job where jobname='ti_pcc_retry_source_gaps' and active;
 if v_command is null then raise exception 'Source retry job missing or disabled'; end if;
 perform cron.schedule('ti_pcc_retry_source_gaps','42 * * * *',v_command);
end $$;
