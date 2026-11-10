
-- Reuse the existing private Vault-backed cron credential without copying it to GitHub.
-- A missing model key results in a no-op status, never invented embeddings.
do $block$
declare template_command text; semantics_command text;
begin
 select command into template_command from cron.job
 where jobname='ti_pcc_detail_enrichment' and active=true limit 1;
 if template_command is null or position('ti-ingest' in template_command)=0
   or position('mode' in template_command)=0 or position('details' in template_command)=0
 then raise exception 'No validated Vault-backed cron template available';end if;
 semantics_command:=replace(replace(replace(template_command,
  '/ti-ingest','/ti-semantic'),'mode','action'),'details','index_cases');
 if position('/ti-semantic' in semantics_command)=0
    or position('index_cases' in semantics_command)=0 then
  raise exception 'Could not assemble safe semantic cron command';end if;
 perform cron.schedule('ti-semantic-index','*/20 * * * *',semantics_command);
end $block$;
