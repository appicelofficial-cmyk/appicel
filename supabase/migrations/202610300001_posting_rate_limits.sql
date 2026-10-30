begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create table private.posting_attempts (
  scope text not null check (scope in ('create-cell', 'upload-cell-image', 'create-checkout-session')),
  ip_hash text not null check (ip_hash ~ '^[0-9a-f]{64}$'),
  attempted_at timestamptz not null
);
create index posting_attempts_scope_ip_time_idx
  on private.posting_attempts (scope, ip_hash, attempted_at);
create index posting_attempts_time_idx on private.posting_attempts (attempted_at);
alter table private.posting_attempts enable row level security;
revoke all on private.posting_attempts from public, anon, authenticated, service_role;

create function public.consume_posting_attempt(p_scope text, p_ip_hash text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  checked_at timestamptz;
  attempts bigint;
  oldest timestamptz;
  max_attempts integer;
  wait_seconds integer;
begin
  if p_scope is null or p_scope not in ('create-cell', 'upload-cell-image', 'create-checkout-session')
    or p_ip_hash is null or p_ip_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid posting limit input';
  end if;
  max_attempts := case when p_scope = 'upload-cell-image' then 60 else 10 end;
  -- Serialize all instances for this API and IP. Rejected requests add no record.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('posting:' || p_scope || ':' || p_ip_hash, 0));
  checked_at := clock_timestamp();
  delete from private.posting_attempts
    where scope = p_scope and ip_hash = p_ip_hash
      and attempted_at <= checked_at - interval '10 minutes';
  select count(*), min(attempted_at) into attempts, oldest
    from private.posting_attempts where scope = p_scope and ip_hash = p_ip_hash;
  if attempts >= max_attempts then
    wait_seconds := greatest(1, ceil(extract(epoch from
      (oldest + interval '10 minutes' - checked_at)))::integer);
    return jsonb_build_object('allowed', false, 'retry_after', wait_seconds);
  end if;
  insert into private.posting_attempts (scope, ip_hash, attempted_at)
    values (p_scope, p_ip_hash, checked_at);
  return jsonb_build_object('allowed', true, 'retry_after', 0);
end;
$$;
revoke all on function public.consume_posting_attempt(text, text) from public, anon, authenticated;
grant execute on function public.consume_posting_attempt(text, text) to service_role;

commit;
