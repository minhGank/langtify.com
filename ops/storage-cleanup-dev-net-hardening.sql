-- DEV ONLY: ssuyyrfncvyqsgkirvpq. Requires Supabase-managed object-owner authority.
-- NOT applied: hosted postgres cannot revoke supabase_admin-owned PUBLIC grants.
-- Support must confirm the target, review other trusted pg_net callers, and run
-- this transaction as supabase_admin (or another authorized owner-equivalent role).
-- Does not enable Cron, call HTTP, alter eligibility, or read any secret.
begin;
do $$ begin
  if exists(select 1 from cron.job where jobname='langtify-dev-storage-cleanup' and active) then
    raise exception 'Keep cleanup Cron paused during hardening';
  end if;
end $$;

-- Observed dispatcher owner, Cron username and pg_net worker username: postgres.
-- http_post needs queue INSERT/SELECT and sequence USAGE; the worker reads/deletes
-- requests, inserts responses, and removes expired responses. Monitoring reads them.
grant usage on schema net to postgres;
grant select, insert, delete on table net.http_request_queue to postgres;
grant select, insert, delete on table net._http_response to postgres;
grant usage on sequence net.http_request_queue_id_seq to postgres;
-- Function EXECUTE is unchanged; the managed object owner retains its authority.
revoke all privileges on table net.http_request_queue, net._http_response from public, anon, authenticated;
revoke all privileges on sequence net.http_request_queue_id_seq from public, anon, authenticated;
revoke usage on schema net from public, anon, authenticated;

do $$ declare client text; privilege text; begin
  foreach client in array array['anon','authenticated'] loop
    if has_schema_privilege(client,'net','usage')
      or has_table_privilege(client,'net.http_request_queue','select')
      or has_table_privilege(client,'net._http_response','select')
      or has_sequence_privilege(client,'net.http_request_queue_id_seq','usage') then
      raise exception 'Managed pg_net client privileges remain; transaction must roll back';
    end if;
  end loop;
  if not has_schema_privilege('postgres','net','usage')
    or not has_sequence_privilege('postgres','net.http_request_queue_id_seq','usage') then
    raise exception 'Trusted pg_net path lost required privileges';
  end if;
  foreach privilege in array array['SELECT','INSERT','DELETE'] loop
    if not has_table_privilege('postgres','net.http_request_queue',privilege)
      or not has_table_privilege('postgres','net._http_response',privilege) then
      raise exception 'Trusted pg_net worker lost required table privilege';
    end if;
  end loop;
end $$;
commit;
