-- PRD U18 / F19: block Supabase anonymous sign-in users from accessing
-- production member API keys. They share the authenticated Postgres role.
-- This restrictive RLS guard combines with existing owner-based policies;
-- service-role internal operations are unaffected.
CREATE POLICY ti_api_keys_permanent_members_only
ON public.ti_api_keys AS RESTRICTIVE FOR ALL TO authenticated
USING ( (SELECT (auth.jwt()->>'is_anonymous')::boolean) IS FALSE )
WITH CHECK ( (SELECT (auth.jwt()->>'is_anonymous')::boolean) IS FALSE );
