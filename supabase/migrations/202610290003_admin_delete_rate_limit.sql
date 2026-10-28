begin;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create table private.admin_delete_attempts (
  ip_hash text not null check (ip_hash ~ '^[0-9a-f]{64}$'),
  attempted_at timestamptz not null
);
create index admin_delete_attempts_ip_time_idx
  on private.admin_delete_attempts (ip_hash, attempted_at);
alter table private.admin_delete_attempts enable row level security;
revoke all on private.admin_delete_attempts from public, anon, authenticated;

create function public.consume_admin_delete_attempt(p_ip_hash text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  checked_at timestamptz;
  attempts bigint;
  oldest timestamptz;
  wait_seconds integer;
begin
  if p_ip_hash is null or p_ip_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid IP hash';
  end if;
  -- Shared across cells and API instances, serialized per IP.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('admin-delete:' || p_ip_hash, 0));
  checked_at := clock_timestamp();
  delete from private.admin_delete_attempts
    where ip_hash = p_ip_hash and attempted_at <= checked_at - interval '15 minutes';
  select count(*), min(attempted_at) into attempts, oldest
    from private.admin_delete_attempts where ip_hash = p_ip_hash;
  if attempts >= 5 then
    wait_seconds := greatest(1, ceil(extract(epoch from
      (oldest + interval '15 minutes' - checked_at)))::integer);
    return jsonb_build_object('allowed', false, 'retry_after', wait_seconds);
  end if;
  insert into private.admin_delete_attempts (ip_hash, attempted_at)
    values (p_ip_hash, checked_at);
  return jsonb_build_object('allowed', true, 'retry_after', 0);
end;
$$;
revoke all on function public.consume_admin_delete_attempt(text) from public, anon, authenticated;
grant execute on function public.consume_admin_delete_attempt(text) to service_role;
commit;
