
create table if not exists public.google_routes_eta_usage (
  month_start date primary key,
  request_count integer not null default 0 check (request_count >= 0 and request_count <= 450),
  updated_at timestamptz not null default now(),
  check (month_start = date_trunc('month', month_start::timestamp)::date)
);

alter table public.google_routes_eta_usage enable row level security;
revoke all on table public.google_routes_eta_usage from public, anon, authenticated;
grant select, insert, update on table public.google_routes_eta_usage to service_role;

create or replace function public.consume_google_routes_eta_request()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_count integer;
  v_month_start date := date_trunc('month', timezone('utc', now()))::date;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;

  insert into public.google_routes_eta_usage(month_start, request_count, updated_at)
  values (v_month_start, 1, now())
  on conflict (month_start) do update
    set request_count = public.google_routes_eta_usage.request_count + 1,
        updated_at = now()
    where public.google_routes_eta_usage.request_count < 450
  returning request_count into v_count;

  return v_count;
end;
$function$;

revoke all on function public.consume_google_routes_eta_request() from public, anon, authenticated;
grant execute on function public.consume_google_routes_eta_request() to service_role;
