alter table public.orders add column if not exists receipt_code text not null default lpad((floor(random() * 1000000)::int)::text, 6, '0');
create unique index if not exists orders_receipt_code_unique on public.orders(receipt_code);
create or replace function public.get_customer_order_tracking(p_tracking_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_result jsonb;
begin
  if p_tracking_token is null then return null; end if;
  select jsonb_build_object(
    'order_number', o.order_number,
    'status', o.status,
    'order_type', o.order_type,
    'subtotal', o.subtotal,
    'delivery_fee', o.delivery_fee,
    'total', o.total,
    'created_at', o.created_at,
    'updated_at', o.updated_at,
    'completed_at', o.completed_at,
    'receipt_code', o.receipt_code,
    'items', coalesce((select jsonb_agg(jsonb_build_object('name', oi.item_name, 'quantity', oi.quantity, 'unit_price', oi.unit_price, 'line_total', oi.line_total) order by oi.id) from public.order_items oi where oi.order_id = o.id), '[]'::jsonb)
  ) into v_result
  from public.orders o where o.customer_tracking_token = p_tracking_token;
  return v_result;
end;
$$;
revoke all on function public.get_customer_order_tracking(uuid) from public;
grant execute on function public.get_customer_order_tracking(uuid) to anon, authenticated;
create or replace function public.confirm_customer_receipt(p_order_number bigint, p_receipt_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid; v_status text;
begin
  if not public.is_current_user_admin() then raise exception 'Not authorized'; end if;
  select id, status into v_id, v_status from public.orders
   where order_number = p_order_number and receipt_code = trim(p_receipt_code)
   for update;
  if v_id is null then raise exception 'Incorrect order number or receipt code'; end if;
  if v_status = 'completed' then raise exception 'Order already completed'; end if;
  if v_status = 'rejected' then raise exception 'Rejected orders cannot be completed'; end if;
  update public.orders set status = 'completed', completed_at = now(), updated_at = now() where id = v_id;
  return jsonb_build_object('order_number', p_order_number, 'status', 'completed');
end;
$$;
revoke all on function public.confirm_customer_receipt(bigint,text) from public;
grant execute on function public.confirm_customer_receipt(bigint,text) to authenticated;
