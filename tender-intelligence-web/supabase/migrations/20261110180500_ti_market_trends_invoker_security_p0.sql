-- P0 security hardening.
-- Public market trends aggregate only public ti_cases and require no RLS bypass.
-- SECURITY INVOKER preserves output while respecting caller table permissions.
ALTER FUNCTION public.ti_market_trends_v1(integer,text,text) SECURITY INVOKER;
