-- These RPCs accept a backend-resolved user scope, not a caller identity.
-- Nest service clients remain authorized; direct client calls must not bypass it.
revoke all on function
  public.get_search_terms_with_metrics_page(uuid,character varying,character varying,character varying,character varying,character varying,date,date,character varying,character varying,integer,integer,character varying,numeric,numeric,integer,numeric,integer,integer,numeric,numeric,character varying[]),
  public.get_targeting_metric_report_coverage(uuid),
  public.page_keywords_negative_status(uuid,character varying,character varying,character varying[],character varying,character varying,character varying,character varying,character varying,character varying,text,date,date,character varying,character varying,integer,integer,numeric),
  public.page_negative_keywords(uuid,character varying,character varying[],character varying,character varying,character varying,character varying,character varying,character varying,character varying,integer,integer),
  public.page_negative_product_targets(uuid,character varying,character varying[],character varying,character varying,character varying,character varying,character varying,character varying,character varying,integer,integer),
  public.page_product_targets_negative_status(uuid,character varying,character varying,character varying[],character varying,character varying,character varying,character varying,character varying,character varying,text,date,date,character varying,character varying,integer,integer,numeric),
  public.reserve_founding_membership_slot(uuid,integer)
from public, anon, authenticated;
grant execute on function
  public.get_search_terms_with_metrics_page(uuid,character varying,character varying,character varying,character varying,character varying,date,date,character varying,character varying,integer,integer,character varying,numeric,numeric,integer,numeric,integer,integer,numeric,numeric,character varying[]),
  public.get_targeting_metric_report_coverage(uuid),
  public.page_keywords_negative_status(uuid,character varying,character varying,character varying[],character varying,character varying,character varying,character varying,character varying,character varying,text,date,date,character varying,character varying,integer,integer,numeric),
  public.page_negative_keywords(uuid,character varying,character varying[],character varying,character varying,character varying,character varying,character varying,character varying,character varying,integer,integer),
  public.page_negative_product_targets(uuid,character varying,character varying[],character varying,character varying,character varying,character varying,character varying,character varying,character varying,integer,integer),
  public.page_product_targets_negative_status(uuid,character varying,character varying,character varying[],character varying,character varying,character varying,character varying,character varying,character varying,text,date,date,character varying,character varying,integer,integer,numeric),
  public.reserve_founding_membership_slot(uuid,integer)
to service_role;
