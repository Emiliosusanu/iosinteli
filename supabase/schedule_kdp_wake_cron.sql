-- Schedule silent KDP wakes every 15 minutes via pg_cron + pg_net.
-- Run in the Supabase SQL editor AFTER:
--   1) deploying kdp-wake-push
--   2) supabase secrets set KDP_WAKE_SECRET="$(openssl rand -hex 32)"
--   3) storing vault secrets:
--        inteliads_anon_key
--        inteliads_kdp_wake_secret
--
-- Do not paste credentials into this file.

create extension if not exists pg_cron;
create extension if not exists pg_net;
create extension if not exists supabase_vault with schema vault;

do $validation$
begin
  if not exists (
    select 1 from vault.decrypted_secrets where name = 'inteliads_anon_key'
  ) or not exists (
    select 1 from vault.decrypted_secrets where name = 'inteliads_kdp_wake_secret'
  ) then
    raise exception 'Create inteliads_anon_key and inteliads_kdp_wake_secret in Supabase Vault first';
  end if;
end;
$validation$;

select cron.unschedule(jobid)
  from cron.job
 where jobname = 'inteliads-kdp-wake-push';

select cron.schedule(
  'inteliads-kdp-wake-push',
  '*/15 * * * *',
  $$
  select net.http_post(
    url     := 'https://sjdlkprlkaweyuiaigix.supabase.co/functions/v1/kdp-wake-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        select decrypted_secret from vault.decrypted_secrets
         where name = 'inteliads_anon_key' limit 1
      ),
      'X-InteliAds-Wake-Secret', (
        select decrypted_secret from vault.decrypted_secrets
         where name = 'inteliads_kdp_wake_secret' limit 1
      )
    ),
    body := '{}'::jsonb
  );
  $$
);
