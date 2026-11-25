begin;

create or replace function public.mut_check_assistant_quota()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select exists (
    select 1 from mut_private.assistant_quota where singleton
  );
$$;

revoke all on function public.mut_check_assistant_quota()
  from public, anon, authenticated;
grant execute on function public.mut_check_assistant_quota()
  to service_role;

notify pgrst, 'reload schema';

commit;
