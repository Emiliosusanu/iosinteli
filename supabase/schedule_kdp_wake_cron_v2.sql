-- Run after deploying the authenticated kdp-wake-push function and lease migration.
-- Store the public anon API key and dedicated KDP_WAKE_CRON_SECRET in Vault first.
-- Existing KDP_WAKE_SECRET and all device/user credentials remain unchanged.
create extension if not exists pg_cron;
create extension if not exists pg_net;
create extension if not exists supabase_vault with schema vault;

do $validation$
begin
  if not exists (select 1 from vault.secrets where name = 'inteliads_anon_key')
     or not exists (select 1 from vault.secrets where name = 'inteliads_kdp_wake_cron_secret') then
    raise exception 'The dedicated cron credential and public API key must exist in Vault';
  end if;
  if to_regprocedure('public.claim_kdp_wake_dispatch(integer)') is null then
    raise exception 'Install the distributed wake lease before scheduling';
  end if;
end;
$validation$;

select cron.unschedule(jobid) from cron.job where jobname = 'inteliads-kdp-wake-push';
select cron.schedule('inteliads-kdp-wake-push', '*/15 * * * *', $$
  select net.http_post(
    url := 'https://sjdlkprlkaweyuiaigix.supabase.co/functions/v1/kdp-wake-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        select decrypted_secret from vault.decrypted_secrets
        where name = 'inteliads_anon_key' limit 1
      ),
      'X-InteliAds-Wake-Secret', (
        select decrypted_secret from vault.decrypted_secrets
        where name = 'inteliads_kdp_wake_cron_secret' limit 1
      )
    ),
    body := '{}'::jsonb
  );
$$);
