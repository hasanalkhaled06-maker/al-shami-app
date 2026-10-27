create or replace function public.cashier_set_order_status(
  p_order_id uuid,
  p_status text,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_order public.orders%rowtype;
  v_reason text := trim(coalesce(p_reason, ''));
begin
  if auth.uid() is null or public.get_my_staff_role() not in ('cashier', 'manager', 'owner') then
    raise exception 'Active cashier access required';
  end if;

  if p_status not in ('accepted', 'rejected', 'preparing', 'ready') then
    raise exception 'Unsupported cashier status';
  end if;

  select * into v_order
  from public.orders
  where id = p_order_id
  for update;
  if not found then
    raise exception 'Order not found';
  end if;

  if not public.al_shami_order_transition_allowed(
    v_order.order_type, v_order.status, p_status, false
  ) then
    raise exception 'This order cannot move from % to %', v_order.status, p_status
      using errcode = 'check_violation';
  end if;

  if p_status = 'rejected' and length(v_reason) < 3 then
    raise exception 'A rejection reason of at least 3 characters is required';
  end if;

  update public.orders
  set status = p_status,
      status_reason = case when p_status = 'rejected' then left(v_reason, 500) else null end,
      status_changed_at = now(),
      updated_at = now()
  where id = p_order_id;
end;
$function$;
