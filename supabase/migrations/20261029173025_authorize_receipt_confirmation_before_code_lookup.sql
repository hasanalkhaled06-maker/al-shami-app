create or replace function public.confirm_customer_receipt(p_order_number bigint, p_receipt_code text)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_order public.orders%rowtype;
  v_user_id uuid := auth.uid();
  v_is_admin boolean := false;
  v_is_assigned_rider boolean := false;
begin
  if v_user_id is null then
    raise exception 'Not authorized';
  end if;

  v_is_admin := public.is_current_user_admin();

  select *
  into v_order
  from public.orders
  where order_number = p_order_number
  for update;

  if not found then
    raise exception 'Order not found';
  end if;

  if not v_is_admin then
    select exists (
      select 1
      from public.staff_profiles sp
      where sp.user_id = v_user_id
        and sp.role = 'delivery_rider'
        and sp.is_active = true
        and sp.employment_status = 'active'
    )
    into v_is_assigned_rider;

    if not v_is_assigned_rider
       or v_order.order_type <> 'delivery'
       or v_order.assigned_rider_user_id is distinct from v_user_id then
      raise exception 'Only the assigned active delivery rider can confirm this order';
    end if;
  end if;

  if v_order.receipt_code is distinct from trim(p_receipt_code) then
    raise exception 'Incorrect receipt code';
  end if;
  if v_order.status = 'completed' then
    raise exception 'Order already completed';
  end if;
  if v_order.status = 'rejected' then
    raise exception 'Rejected orders cannot be completed';
  end if;
  if not (
    (v_order.order_type = 'pickup' and v_order.status = 'ready')
    or (v_order.order_type = 'delivery' and v_order.status = 'out_for_delivery')
  ) then
    raise exception 'Confirm receipt only after the order is ready for handoff';
  end if;

  insert into public.order_completion_authorizations(transaction_id, order_id, actor_user_id)
  values (txid_current(), v_order.id, v_user_id);

  update public.orders
  set status = 'completed', completed_at = now(), updated_at = now()
  where id = v_order.id;

  return jsonb_build_object('order_number', p_order_number, 'status', 'completed');
end;
$function$;
