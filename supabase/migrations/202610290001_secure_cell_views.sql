begin;

-- Keep the existing SELECT policies and Realtime ranking subscription intact.
alter table public.cell_views enable row level security;
revoke insert, update, delete on public.cell_views from public, anon, authenticated;

-- Report actual policy names in the SQL editor before removing write access.
select policyname, cmd, roles from pg_policies
where schemaname = 'public' and tablename = 'cell_views'
  and cmd in ('INSERT', 'ALL');

-- INSERT policies are unnecessary even when their names differ by deployment.
do $$
declare p record;
begin
  for p in select policyname from pg_policies
    where schemaname = 'public' and tablename = 'cell_views' and cmd = 'INSERT'
  loop
    execute format('drop policy %I on public.cell_views', p.policyname);
  end loop;
end $$;
-- ALL policies may also grant SELECT; retain them, with writes denied by REVOKE.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create table if not exists private.cell_view_limits (
  cell_id text not null,
  viewer_id text not null,
  ip_hash text not null,
  created_at timestamptz not null default now()
);
alter table private.cell_view_limits enable row level security;
revoke all on private.cell_view_limits from public, anon, authenticated;
create index if not exists cell_view_limits_viewer_idx
  on private.cell_view_limits (cell_id, viewer_id, created_at);
create index if not exists cell_view_limits_ip_idx
  on private.cell_view_limits (cell_id, ip_hash, created_at);

create or replace function public.record_cell_view(
  p_cell_id text, p_viewer_id text, p_ip_hash text
) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare recorded_at timestamptz;
begin
  if p_cell_id is null or p_viewer_id is null or p_ip_hash is null
    or length(p_cell_id) > 128
    or p_viewer_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_ip_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid view identifiers';
  end if;

  -- Serialize check + insert across all API instances for this cell.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_cell_id, 0));
  recorded_at := clock_timestamp();
  if exists (
    select 1 from private.cell_view_limits
    where cell_id = p_cell_id and created_at > recorded_at - interval '1 hour'
      and (viewer_id = p_viewer_id or ip_hash = p_ip_hash)
  ) or exists (
    -- Respect pre-migration viewer records as well.
    select 1 from public.cell_views
    where cell_id::text = p_cell_id and viewer_id::text = p_viewer_id
      and created_at > recorded_at - interval '1 hour'
  ) then
    return false;
  end if;

  insert into public.cell_views (cell_id, viewer_id, created_at)
    select id,
      (jsonb_populate_record(null::public.cell_views,
        jsonb_build_object('viewer_id', p_viewer_id))).viewer_id,
      recorded_at
    from public.cells where id::text = p_cell_id;
  if not found then return false; end if;

  delete from private.cell_view_limits
    where cell_id = p_cell_id and created_at <= recorded_at - interval '1 hour';
  insert into private.cell_view_limits (cell_id, viewer_id, ip_hash, created_at)
    values (p_cell_id, p_viewer_id, p_ip_hash, recorded_at);
  return true;
end;
$$;

revoke all on function public.record_cell_view(text, text, text) from public, anon, authenticated;
grant execute on function public.record_cell_view(text, text, text) to service_role;
commit;
