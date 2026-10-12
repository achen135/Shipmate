-- Primary 30-minute trigger for the Watch workflow.
--
-- GitHub's own `schedule` trigger only fired about every 5-6 hours in
-- practice (it drops scheduled runs under load), so Postgres does the timing:
-- pg_cron runs dispatch_watch() at :13 and :43, which asks GitHub to start
-- watch.yml through the workflow_dispatch API, sent with pg_net. The GitHub
-- schedule in watch.yml stays as a fallback; its `concurrency: watch` group
-- stops a dispatch and a scheduled run from overlapping.
--
-- The GitHub token (fine-grained, this repo only, Actions: read and write)
-- lives in Supabase Vault under the name below, never in a migration or the
-- repo. Without it the job does nothing but raise a notice, so local stacks
-- and CI never call GitHub.
--
-- Check it on production:
--   select status, return_message, start_time from cron.job_run_details
--     order by start_time desc limit 5;
--   select status_code, content, created from net._http_response
--     order by created desc limit 5;   -- 204 = dispatched

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- Not security definer: pg_cron runs the job as the role that scheduled it
-- (postgres), which can read Vault. Nobody else may call it.
create function public.dispatch_watch()
returns bigint
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_token text;
begin
  select decrypted_secret into v_token
  from vault.decrypted_secrets
  where name = 'github_watch_dispatch_token'
  limit 1;

  if coalesce(v_token, '') = '' then
    raise notice 'dispatch_watch: no github_watch_dispatch_token in Vault; skipping';
    return null;
  end if;

  -- Returns pg_net's request id; the response lands in net._http_response.
  return net.http_post(
    url := 'https://api.github.com/repos/achen135/Shipmate/actions/workflows/watch.yml/dispatches',
    body := '{"ref":"main"}'::jsonb,
    headers := jsonb_build_object(
      'Accept', 'application/vnd.github+json',
      'Authorization', 'Bearer ' || v_token,
      'X-GitHub-Api-Version', '2022-11-28',
      'User-Agent', 'Shipmate-dispatcher (github.com/achen135/Shipmate)'
    ),
    timeout_milliseconds := 10000
  );
end;
$$;

revoke execute on function public.dispatch_watch() from public, anon, authenticated;

-- :13 and :43, away from the top of the hour when GitHub is busiest.
-- cron.schedule updates the job in place if one with this name exists.
select cron.schedule('dispatch-watch', '13,43 * * * *', 'select public.dispatch_watch()');
