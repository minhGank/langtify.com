-- DEV ONLY: ssuyyrfncvyqsgkirvpq. Run through the explicitly targeted CLI.
-- Provision STORAGE_CLEANUP_JOB_SECRET in Edge secrets and the identical Vault
-- secret named langtify_dev_storage_cleanup_job_key before running this file.
-- No cleanup eligibility or Storage policy is changed here.
begin;
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
create table if not exists private.storage_cleanup_dispatches (
  hour timestamptz primary key,
  run_id uuid not null unique,
  request_id bigint not null,
  created_at timestamptz not null default clock_timestamp()
);
alter table private.storage_cleanup_dispatches enable row level security;
revoke all on private.storage_cleanup_dispatches from public,anon,authenticated,service_role;
create or replace function private.dispatch_storage_cleanup() returns bigint
language plpgsql security definer set search_path='' as $$
declare job_key text; request bigint; run uuid:=gen_random_uuid(); current_hour timestamptz:=date_trunc('hour',clock_timestamp(),'UTC');
begin
  -- Concurrent/replayed cron dispatch in this hour is a no-op.
  perform pg_advisory_xact_lock(730103, 1);
  select request_id into request from private.storage_cleanup_dispatches where hour=current_hour;
  if found then return request; end if;
  select decrypted_secret into job_key from vault.decrypted_secrets where name='langtify_dev_storage_cleanup_job_key';
  if job_key is null or job_key!~'^[0-9a-f]{64}$' then raise exception 'Cleanup credential unavailable'; end if;
  select net.http_post(
    url:='https://ssuyyrfncvyqsgkirvpq.supabase.co/functions/v1/storage-cleanup',
    headers:=jsonb_build_object('Content-Type','application/json','x-cleanup-job-key',job_key),
    body:=jsonb_build_object('requestId',run),
    timeout_milliseconds:=120000
  ) into request;
  insert into private.storage_cleanup_dispatches(hour,run_id,request_id) values(current_hour,run,request);
  return request;
end $$;
revoke all on function private.dispatch_storage_cleanup() from public,anon,authenticated,service_role;
-- Named scheduling updates the existing job instead of creating duplicates.
select cron.schedule('langtify-dev-storage-cleanup','0 * * * *','select private.dispatch_storage_cleanup();');
commit;
