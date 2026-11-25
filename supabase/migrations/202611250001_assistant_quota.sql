begin;

create schema if not exists mut_private;
revoke all on schema mut_private from public, anon, authenticated, service_role;

create table if not exists mut_private.assistant_quota (
  singleton boolean primary key default true check (singleton),
  quota_day date,
  quota_month date,
  daily_count integer not null default 0 check (daily_count between 0 and 5),
  monthly_count integer not null default 0 check (monthly_count between 0 and 50),
  last_reserved_at timestamptz
);
alter table mut_private.assistant_quota enable row level security;
revoke all on table mut_private.assistant_quota from public, anon, authenticated, service_role;
insert into mut_private.assistant_quota (singleton) values (true) on conflict do nothing;

create or replace function public.mut_reserve_assistant_call()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  quota mut_private.assistant_quota%rowtype;
  reserved_at timestamptz;
  today date;
  this_month date;
begin
  select * into strict quota from mut_private.assistant_quota where singleton for update;
  reserved_at := clock_timestamp();
  today := (reserved_at at time zone 'UTC')::date;
  this_month := date_trunc('month', today::timestamp)::date;
  if quota.quota_day is distinct from today then
    quota.daily_count := 0;
  end if;
  if quota.quota_month is distinct from this_month then
    quota.monthly_count := 0;
  end if;
  if quota.daily_count >= 5 or quota.monthly_count >= 50 then
    return jsonb_build_object('allowed', false);
  end if;
  -- Un appel par minute même après redémarrage ou sur deux instances.
  if reserved_at < quota.last_reserved_at + interval '1 minute' then
    return jsonb_build_object('allowed', false, 'retry_after',
      ceil(extract(epoch from (quota.last_reserved_at + interval '1 minute' - reserved_at)))::integer);
  end if;
  update mut_private.assistant_quota
     set quota_day = today, quota_month = this_month, daily_count = quota.daily_count + 1,
         monthly_count = quota.monthly_count + 1, last_reserved_at = reserved_at
     where singleton;
  return jsonb_build_object('allowed', true);
end;
$$;

revoke all on function public.mut_reserve_assistant_call() from public, anon, authenticated;
grant execute on function public.mut_reserve_assistant_call() to service_role;

notify pgrst, 'reload schema';

commit;
