-- Manual live RLS acceptance test. Run with privileged DB access.
-- Fixtures are inserted and completely rolled back.
BEGIN;
DO $prepare$
DECLARE a uuid; p uuid;
BEGIN
 SELECT id INTO a FROM auth.users WHERE is_anonymous ORDER BY created_at DESC LIMIT 1;
 SELECT id INTO p FROM auth.users WHERE NOT is_anonymous ORDER BY created_at DESC LIMIT 1;
 IF a IS NULL OR p IS NULL THEN RAISE EXCEPTION 'Need both anonymous and permanent identities'; END IF;
 PERFORM set_config('qa.a',a::text,true);
 PERFORM set_config('qa.p',p::text,true);
 INSERT INTO public.ti_api_keys(user_id,name,token_hash,token_prefix)
 VALUES(a,'__qa_demo','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','qa_demo__'),
       (p,'__qa_member','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','qa_member');
END
$prepare$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',json_build_object('sub',current_setting('qa.a'),'role','authenticated','is_anonymous',true)::text,true);
DO $assert_denied$
DECLARE n int; allowed bool := false;
BEGIN
 SELECT count(*) INTO n FROM public.ti_api_keys WHERE user_id=current_setting('qa.a')::uuid;
 IF n<>0 THEN RAISE EXCEPTION 'Anonymous token can read API keys'; END IF;
 BEGIN
   INSERT INTO public.ti_api_keys(user_id,name,token_hash,token_prefix)
   VALUES(current_setting('qa.a')::uuid,'__qa_create','cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc','qa_newkey');
   allowed:=true;
 EXCEPTION WHEN insufficient_privilege THEN allowed:=false;
 END;
 IF allowed THEN RAISE EXCEPTION 'Anonymous token can issue API keys'; END IF;
END
$assert_denied$;
SELECT set_config('request.jwt.claims',json_build_object('sub',current_setting('qa.p'),'role','authenticated','is_anonymous',false)::text,true);
DO $assert_member$
BEGIN
 IF (SELECT count(*) FROM public.ti_api_keys WHERE user_id=current_setting('qa.p')::uuid) <> 1
 THEN RAISE EXCEPTION 'Permanent account cannot access its own key'; END IF;
END
$assert_member$;
ROLLBACK;
-- After ROLLBACK, no test keys should remain.
