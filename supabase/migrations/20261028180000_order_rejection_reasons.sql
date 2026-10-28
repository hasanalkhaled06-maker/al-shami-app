-- Require a clear rejection reason and expose it only on rejected customer orders.
-- This migration changes functions only; it does not rewrite existing orders.

create or replace function public.admin_reject_order(
  p_order_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_order public.orders%rowtype;
  v_reason text := left(trim(coalesce(p_reason, '')), 500);
begin
  if auth.uid() is null or not public.is_current_user_admin() then
    raise exception 'Active administrator access required';
  end if;

  if length(v_reason) < 3 then
    raise exception 'A rejection reason of at least 3 characters is required';
  end if;

  select * into v_order
  from public.orders
  where id = p_order_id
  for update;
  if not found then
    raise exception 'Order not found';
  end if;

  if not public.al_shami_order_transition_allowed(
    v_order.order_type, v_order.status, 'rejected', false
  ) then
    raise exception 'This order cannot move from % to rejected', v_order.status
      using errcode = 'check_violation';
  end if;

  update public.orders
  set status = 'rejected',
      status_reason = v_reason,
      status_changed_at = now(),
      updated_at = now()
  where id = p_order_id;
end;
$$;

revoke all on function public.admin_reject_order(uuid, text) from public, anon;
grant execute on function public.admin_reject_order(uuid, text) to authenticated;

create or replace function public.get_customer_order_tracking(p_tracking_token uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_result jsonb;
begin
  if auth.uid() is null or p_tracking_token is null then return null; end if;

  select jsonb_build_object(
    'id', o.id,
    'order_number', o.order_number,
    'status', o.status,
    'status_reason', case when o.status = 'rejected' then o.status_reason else null end,
    'can_review', (o.status = 'completed' and o.customer_user_id = auth.uid()),
    'order_type', o.order_type,
    'subtotal', o.subtotal,
    'delivery_fee', o.delivery_fee,
    'total', o.total,
    'created_at', o.created_at,
    'updated_at', o.updated_at,
    'completed_at', o.completed_at,
    'requested_for', o.requested_for,
    'estimated_ready_at', o.estimated_ready_at,
    'receipt_code', o.receipt_code,
    'delivery_latitude', o.delivery_latitude,
    'delivery_longitude', o.delivery_longitude,
    'rider_location', case
      when o.status = 'out_for_delivery' and o.assigned_rider_user_id is not null then (
        select jsonb_build_object(
          'latitude', loc.latitude,
          'longitude', loc.longitude,
          'accuracy_m', loc.accuracy_m,
          'heading_deg', loc.heading_deg,
          'speed_mps', loc.speed_mps,
          'updated_at', loc.updated_at,
          'is_stale', loc.updated_at < now() - interval '45 seconds',
          'rider_name', coalesce(sp.full_name, 'AL SHAMI delivery rider')
        )
        from public.delivery_rider_locations loc
        left join public.staff_profiles sp on sp.user_id = o.assigned_rider_user_id
        where loc.rider_user_id = o.assigned_rider_user_id
          and o.rider_tracking_started_at is not null
          and loc.updated_at >= o.rider_tracking_started_at
        limit 1
      )
      else null
    end,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', oi.id,
        'menu_item_id', oi.menu_item_id,
        'name', oi.item_name,
        'quantity', oi.quantity,
        'unit_price', oi.unit_price,
        'line_total', oi.line_total,
        'item_note', oi.item_note
      ) order by oi.id)
      from public.order_items oi where oi.order_id = o.id
    ), '[]'::jsonb)
  )
  into v_result
  from public.orders o
  where o.customer_tracking_token = p_tracking_token;

  return v_result;
end;
$$;

revoke all on function public.get_customer_order_tracking(uuid) from public, anon;
grant execute on function public.get_customer_order_tracking(uuid) to authenticated;
