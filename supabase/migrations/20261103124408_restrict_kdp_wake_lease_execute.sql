-- This lease is used only by the authenticated server-side wake sender.
-- Explicit role grants survive a PUBLIC revoke, so remove all client paths.
revoke all on function public.claim_kdp_wake_dispatch(integer)
  from public, anon, authenticated;
grant execute on function public.claim_kdp_wake_dispatch(integer)
  to service_role;
