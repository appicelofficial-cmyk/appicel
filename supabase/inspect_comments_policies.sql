-- Read-only: identify actual INSERT/ALL policy names and generate exact SQL.
-- For ALL policies, replace with SELECT-only policies so comment reads keep working.
select policyname, cmd, roles, permissive, qual, with_check,
  format('DROP POLICY %I ON public.comments;', policyname) as delete_sql,
  case when cmd = 'ALL' then
    format('CREATE POLICY %I ON public.comments AS %s FOR SELECT TO %s USING (%s);',
      policyname, permissive,
      (select string_agg(quote_ident(r::text), ', ') from unnest(roles) r),
      coalesce(qual, 'true'))
  end as preserve_select_sql
from pg_policies
where schemaname = 'public' and tablename = 'comments'
  and cmd in ('INSERT', 'ALL');

-- Inspect table/column grants too: policies alone do not determine access.
select grantee, privilege_type from information_schema.table_privileges
where table_schema = 'public' and table_name = 'comments';
select grantee, column_name, privilege_type from information_schema.column_privileges
where table_schema = 'public' and table_name = 'comments';
