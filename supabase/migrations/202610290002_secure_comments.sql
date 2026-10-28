begin;

alter table public.comments enable row level security;
revoke insert, update, delete on public.comments from public, anon, authenticated;
-- Table REVOKE does not remove pre-existing column grants.
do $$
declare cols text;
begin
  select string_agg(quote_ident(attname), ', ') into cols
  from pg_attribute where attrelid = 'public.comments'::regclass
    and attnum > 0 and not attisdropped;
  execute format('revoke insert (%s), update (%s) on public.comments from public, anon, authenticated', cols, cols);
end $$;

-- Remove INSERT and ALL policies by actual name. Preserve ALL's SELECT
-- semantics, including roles and permissive/restrictive behavior.
do $$
declare p record; role_list text;
begin
  for p in select * from pg_policies
    where schemaname = 'public' and tablename = 'comments' and cmd in ('INSERT', 'ALL')
  loop
    execute format('drop policy %I on public.comments', p.policyname);
    if p.cmd = 'ALL' then
      select string_agg(quote_ident(r::text), ', ') into role_list from unnest(p.roles) r;
      execute format('create policy %I on public.comments as %s for select to %s using (%s)',
        p.policyname, p.permissive, role_list, coalesce(p.qual, 'true'));
    end if;
  end loop;
end $$;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create table if not exists private.comment_post_limits (
  viewer_id text not null,
  ip_hash text not null,
  created_at timestamptz not null
);
alter table private.comment_post_limits enable row level security;
revoke all on private.comment_post_limits from public, anon, authenticated;
create index if not exists comment_post_limits_viewer_idx
  on private.comment_post_limits (viewer_id, created_at);
create index if not exists comment_post_limits_ip_idx
  on private.comment_post_limits (ip_hash, created_at);
create index if not exists comments_cell_id_spam_guard_idx on public.comments (cell_id);

create or replace function public.create_cell_comment(
  p_cell_id text, p_viewer_id text, p_ip_hash text, p_author text, p_body text
) returns text
language plpgsql security definer set search_path = ''
as $$
declare
  target public.cells%rowtype;
  lock_key bigint;
  posted_at timestamptz;
begin
  if p_cell_id is null or p_cell_id !~ '^[a-zA-Z0-9-]{1,128}$'
    or p_viewer_id is null
    or p_viewer_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_ip_hash is null or p_ip_hash !~ '^[0-9a-f]{64}$'
    or p_author is null or char_length(p_author) > 10
    or p_body is null or char_length(p_body) > 150
    or p_body !~ '[^[:space:]]' then
    raise exception 'Invalid comment input';
  end if;
  p_viewer_id := lower(p_viewer_id);

  -- Ordered locks cover either identifier, even across different cells.
  -- Lock keys are sorted numerically to avoid deadlocks, including hash collisions.
  for lock_key in
    select distinct k from unnest(array[
      pg_catalog.hashtextextended('comment:viewer:' || p_viewer_id, 0),
      pg_catalog.hashtextextended('comment:ip:' || p_ip_hash, 0)
    ]) k order by k
  loop
    perform pg_catalog.pg_advisory_xact_lock(lock_key);
  end loop;

  -- Also serialize different posters competing for the 100th slot.
  -- Row locking prevents concurrent comment-OFF updates/deletes from racing.
  select * into target from public.cells where id::text = p_cell_id for update;
  if not found then return 'not_found'; end if;
  if target.comments_enabled is false then return 'comments_disabled'; end if;
  if (select count(*) from public.comments where cell_id = target.id) >= 100 then
    return 'comment_limit';
  end if;

  posted_at := clock_timestamp();
  if exists (
    select 1 from private.comment_post_limits
    where created_at > posted_at - interval '30 seconds'
      and (viewer_id = p_viewer_id or ip_hash = p_ip_hash)
  ) then return 'rate_limited'; end if;

  insert into public.comments (cell_id, author, body)
    values (target.id, coalesce(nullif(btrim(p_author), ''), '名無し'), p_body);
  -- Retain only recent records for identifiers involved in this request.
  delete from private.comment_post_limits
    where created_at <= posted_at - interval '30 seconds'
      and (viewer_id = p_viewer_id or ip_hash = p_ip_hash);
  insert into private.comment_post_limits (viewer_id, ip_hash, created_at)
    values (p_viewer_id, p_ip_hash, posted_at);
  return 'created';
end;
$$;

revoke all on function public.create_cell_comment(text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.create_cell_comment(text, text, text, text, text) to service_role;
commit;
