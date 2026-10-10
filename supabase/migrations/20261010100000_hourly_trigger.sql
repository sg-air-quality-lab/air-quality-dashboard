-- Reliable hourly start for the NEA collector.
--
-- GitHub's own schedule ("cron" in the workflow) is best effort and often skips runs,
-- so the dashboard fell hours behind. Supabase's built-in timer (pg_cron) instead asks
-- GitHub every hour to start the workflow ("workflow_dispatch"). The GitHub schedule
-- stays in place as a backup; extra runs are harmless (values are upserted).
--
-- One-time setup, done by the owner in the SQL editor (never committed):
--   select vault.create_secret('<fine-grained GitHub token>', 'github_dispatch_token');
-- The token only needs "Actions: read and write" on this one repository.
-- To replace it later:
--   select vault.update_secret(id, '<new token>') from vault.secrets where name = 'github_dispatch_token';

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- Runs at :10 every hour (pg_cron uses UTC; minutes are the same in Singapore time).
-- NEA publishes the hourly value a minute or two after the hour.
select cron.schedule(
  'start-nea-collector',
  '10 * * * *',
  $job$
  select net.http_post(
    url     := 'https://api.github.com/repos/sg-air-quality-lab/air-quality-dashboard/actions/workflows/collect-nea.yml/dispatches',
    body    := '{"ref":"main"}'::jsonb,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'github_dispatch_token'),
      'Accept', 'application/vnd.github+json',
      'X-GitHub-Api-Version', '2022-11-28',
      'User-Agent', 'sg-air-quality-lab',
      'Content-Type', 'application/json'
    )
  );
  $job$
);

-- Check: the job exists and the token is stored (true/false only, never the token itself).
select jobname, schedule, active,
  exists (select 1 from vault.secrets where name = 'github_dispatch_token') as token_saved
from cron.job where jobname = 'start-nea-collector';
