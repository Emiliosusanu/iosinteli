-- Server-only operational and entitlement state must not be client-writable.
-- Preserve existing owner/service grants and every stored value.
set local lock_timeout = '2s';

alter table public._mwa_kdp_accounts enable row level security;
alter table public._mwa_purge_pids enable row level security;
alter table public._mwa_control_snap enable row level security;
alter table public.seo_workflow_lease enable row level security;
alter table public.seo_publication_counter enable row level security;
alter table public.founding_reservations enable row level security;
alter table public.founding_memberships enable row level security;
alter table public.plan_limit_overrides enable row level security;

revoke all on table
  public._mwa_kdp_accounts,
  public._mwa_purge_pids,
  public._mwa_control_snap,
  public.seo_workflow_lease,
  public.seo_publication_counter,
  public.founding_reservations,
  public.founding_memberships,
  public.plan_limit_overrides
from public, anon, authenticated;

-- Authenticated readers inherit the underlying ownership policies, not the
-- view owner's bypass. Service-role reads retain their existing behavior.
alter view public.user_keyword_metrics set (security_invoker = true);
alter view public.user_search_term_metrics set (security_invoker = true);
alter view public.user_campaign_metrics set (security_invoker = true);
revoke all on table
  public.user_keyword_metrics,
  public.user_search_term_metrics,
  public.user_campaign_metrics
from public, anon;
