-- The usage Edge Function calls this server-only helper.
create or replace function public.get_database_size_bytes()
returns bigint
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select pg_database_size(current_database());
$$;

revoke all on function public.get_database_size_bytes() from public;
revoke all on function public.get_database_size_bytes() from anon;
revoke all on function public.get_database_size_bytes() from authenticated;
grant execute on function public.get_database_size_bytes() to service_role;
