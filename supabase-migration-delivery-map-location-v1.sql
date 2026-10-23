-- AL SHAMI delivery map location support v1.
-- These nullable coordinates preserve compatibility with existing/manual-address orders.

alter table public.orders
  add column if not exists delivery_latitude double precision,
  add column if not exists delivery_longitude double precision;

alter table public.orders
  drop constraint if exists orders_delivery_location_pair_check;
alter table public.orders
  add constraint orders_delivery_location_pair_check
  check (
    (delivery_latitude is null and delivery_longitude is null)
    or
    (delivery_latitude is not null and delivery_longitude is not null
     and delivery_latitude between -90 and 90
     and delivery_longitude between -180 and 180)
  );

create or replace function public.place_order_with_location(
  p_customer_name text,
  p_customer_phone text,
  p_order_type text,
  p_delivery_address text,
  p_notes text,
  p_items jsonb,
  p_delivery_latitude double precision,
  p_delivery_longitude double precision
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_order_id uuid;
  v_number bigint;
  v_tracking_token uuid;
  v_subtotal numeric(10,2) := 0;
  v_fee numeric(10,2) := 0;
  v_min numeric(10,2) := 0;
  v_item jsonb;
  v_product public.menu_items%rowtype;
  v_qty integer;
begin
  if length(trim(coalesce(p_customer_name,''))) < 2
     or length(trim(coalesce(p_customer_phone,''))) < 7 then
    raise exception 'Enter a valid name and phone number';
  end if;

  if p_order_type not in ('delivery','pickup') then
    raise exception 'Invalid order type';
  end if;

  if p_order_type = 'delivery'
     and length(trim(coalesce(p_delivery_address,''))) < 3 then
    raise exception 'Enter a delivery address';
  end if;

  if (p_delivery_latitude is null) <> (p_delivery_longitude is null) then
    raise exception 'Delivery map location needs both latitude and longitude';
  end if;

  if p_delivery_latitude is not null and (
       p_delivery_latitude not between -90 and 90
       or p_delivery_longitude not between -180 and 180
     ) then
    raise exception 'Invalid delivery map coordinates';
  end if;

  if p_order_type = 'pickup'
     and (p_delivery_latitude is not null or p_delivery_longitude is not null) then
    raise exception 'Pickup orders cannot have a delivery map location';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 then
    raise exception 'Your basket is empty';
  end if;

  select delivery_fee, minimum_order
  into v_fee, v_min
  from public.restaurant_settings where id = 1;

  if p_order_type = 'pickup' then v_fee := 0; end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_qty := (v_item->>'quantity')::integer;

    if v_qty < 1 or v_qty > 50 then
      raise exception 'Invalid quantity';
    end if;

    select * into v_product
    from public.menu_items
    where id = (v_item->>'product_id')::uuid
      and is_available = true;

    if not found then
      raise exception 'A menu item is unavailable';
    end if;

    v_subtotal := v_subtotal + v_product.price * v_qty;
  end loop;

  if v_subtotal < v_min then
    raise exception 'Order is below the minimum amount';
  end if;

  insert into public.orders (
    customer_name, customer_phone, order_type,
    delivery_address, delivery_latitude, delivery_longitude,
    notes, subtotal, delivery_fee, total
  ) values (
    trim(p_customer_name), trim(p_customer_phone), p_order_type,
    case when p_order_type = 'delivery' then trim(p_delivery_address) else null end,
    case when p_order_type = 'delivery' then p_delivery_latitude else null end,
    case when p_order_type = 'delivery' then p_delivery_longitude else null end,
    nullif(trim(coalesce(p_notes,'')), ''),
    v_subtotal, v_fee, v_subtotal + v_fee
  ) returning id, order_number, customer_tracking_token
    into v_order_id, v_number, v_tracking_token;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_qty := (v_item->>'quantity')::integer;

    select * into v_product
    from public.menu_items
    where id = (v_item->>'product_id')::uuid
      and is_available = true;

    insert into public.order_items (
      order_id, menu_item_id, item_name, quantity, unit_price
    ) values (
      v_order_id, v_product.id, v_product.name, v_qty, v_product.price
    );
  end loop;

  return jsonb_build_object(
    'id', v_order_id,
    'order_number', v_number,
    'total', v_subtotal + v_fee,
    'tracking_token', v_tracking_token
  );
end;
$function$;

grant execute on function public.place_order_with_location(
  text, text, text, text, text, jsonb, double precision, double precision
) to anon, authenticated;
