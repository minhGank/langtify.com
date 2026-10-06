-- Coordination only: existing cleanup eligibility and Storage guards are unchanged.
begin;
create table if not exists private.storage_cleanup_runs (
  id uuid primary key,
  runner text not null check (runner in ('mac', 'edge')),
  started_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz,
  state text not null default 'running' check (state in ('running','success','retry','failed','abandoned')),
  result jsonb
);
create index if not exists storage_cleanup_runs_started on private.storage_cleanup_runs(started_at desc);
create table if not exists private.storage_cleanup_lease (
  singleton boolean primary key default true check (singleton),
  run_id uuid references private.storage_cleanup_runs(id),
  expires_at timestamptz not null default '-infinity'
);
insert into private.storage_cleanup_lease(singleton) values (true) on conflict do nothing;
alter table private.storage_cleanup_runs enable row level security;
alter table private.storage_cleanup_lease enable row level security;
revoke all on private.storage_cleanup_runs, private.storage_cleanup_lease from public, anon, authenticated, service_role;

create or replace function public.begin_storage_cleanup_run(request_id uuid, runner_name text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare lease private.storage_cleanup_lease%rowtype;
begin
  if request_id is null or runner_name is null or runner_name not in ('mac','edge') then
    raise exception 'Invalid cleanup run' using errcode = '22023';
  end if;
  select * into lease from private.storage_cleanup_lease where singleton for update;
  if lease.expires_at > clock_timestamp() or exists(select 1 from private.storage_cleanup_runs where id=request_id) then
    return false;
  end if;
  update private.storage_cleanup_runs set state='abandoned', finished_at=clock_timestamp()
    where id=lease.run_id and state='running';
  insert into private.storage_cleanup_runs(id,runner) values(request_id,runner_name);
  update private.storage_cleanup_lease set run_id=request_id, expires_at=clock_timestamp()+interval '15 minutes' where singleton;
  return true;
end $$;

create or replace function public.finish_storage_cleanup_run(request_id uuid, counts jsonb, uncertain boolean default false)
returns boolean language plpgsql security definer set search_path = '' as $$
declare lease private.storage_cleanup_lease%rowtype; part text; field text; retries integer:=0;
begin
  if request_id is null or uncertain is null or counts is null or jsonb_typeof(counts)<>'object' then
    raise exception 'Invalid cleanup result' using errcode='22023';
  end if;
  if (select array_agg(key order by key) from jsonb_object_keys(counts) key) is distinct from array['avatars','submissions'] then
    raise exception 'Invalid cleanup result' using errcode='22023';
  end if;
  foreach part in array array['submissions','avatars'] loop
    if jsonb_typeof(counts->part)<>'object' then raise exception 'Invalid cleanup counts' using errcode='22023'; end if;
    if (select array_agg(key order by key) from jsonb_object_keys(counts->part) key) is distinct from array['claimed','removed','retry'] then
      raise exception 'Invalid cleanup counts' using errcode='22023';
    end if;
    foreach field in array array['claimed','removed','retry'] loop
      if jsonb_typeof(counts->part->field)<>'number' or (counts->part->>field)!~'^[0-9]{1,3}$' then
        raise exception 'Invalid cleanup counts' using errcode='22023';
      end if;
    end loop;
    if (counts->part->>'claimed')::integer > 100 or
      (counts->part->>'removed')::integer+(counts->part->>'retry')::integer<>(counts->part->>'claimed')::integer then
      raise exception 'Invalid cleanup counts' using errcode='22023';
    end if;
    retries:=retries+(counts->part->>'retry')::integer;
  end loop;
  select * into lease from private.storage_cleanup_lease where singleton for update;
  if lease.run_id is distinct from request_id or lease.expires_at<=clock_timestamp() then return false; end if;
  if exists(select 1 from private.storage_cleanup_runs where id=request_id and state<>'running') then return true; end if;
  update private.storage_cleanup_runs set finished_at=clock_timestamp(), result=counts,
    state=case when uncertain then 'failed' when retries>0 then 'retry' else 'success' end where id=request_id;
  -- Unknown network outcomes keep the lease: a later retry must not overlap in-flight I/O.
  if not uncertain then update private.storage_cleanup_lease set expires_at='-infinity' where singleton; end if;
  return true;
end $$;
revoke all on function public.begin_storage_cleanup_run(uuid,text), public.finish_storage_cleanup_run(uuid,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.begin_storage_cleanup_run(uuid,text), public.finish_storage_cleanup_run(uuid,jsonb,boolean) to service_role;
commit;
