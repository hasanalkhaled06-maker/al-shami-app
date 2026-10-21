-- Adds bearer-token order tracking without exposing customer phone/address data.
-- Existing orders are preserved; each receives a new private tracking token that has not been shared with its customer.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS customer_tracking_token uuid NOT NULL DEFAULT gen_random_uuid();

CREATE UNIQUE INDEX IF NOT EXISTS orders_customer_tracking_token_uidx
  ON public.orders (customer_tracking_token);

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_status_check;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_status_check
  CHECK (status = ANY (ARRAY[
    'new'::text,
    'accepted'::text,
    'preparing'::text,
    'ready'::text,
    'out_for_delivery'::text,
    'completed'::text,
    'rejected'::text
  ])) NOT VALID;

ALTER TABLE public.orders VALIDATE CONSTRAINT orders_status_check;

-- Preserve the existing order validation/pricing logic and add a private tracking token to the receipt payload.
CREATE OR REPLACE FUNCTION public.place_order(
  p_customer_name text,
  p_customer_phone text,
  p_order_type text,
  p_delivery_address text,
  p_notes text,
  p_items jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
    delivery_address, notes, subtotal, delivery_fee, total
  ) values (
    trim(p_customer_name), trim(p_customer_phone), p_order_type,
    case when p_order_type = 'delivery' then trim(p_delivery_address) else null end,
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

-- A tracking token is a high-entropy bearer capability. Return only the safe summary, never phone, address, or notes.
CREATE OR REPLACE FUNCTION public.get_customer_order_tracking(p_tracking_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  IF p_tracking_token IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT jsonb_build_object(
    'order_number', o.order_number,
    'status', o.status,
    'order_type', o.order_type,
    'subtotal', o.subtotal,
    'delivery_fee', o.delivery_fee,
    'total', o.total,
    'created_at', o.created_at,
    'updated_at', o.updated_at,
    'completed_at', o.completed_at,
    'items', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'name', oi.item_name,
          'quantity', oi.quantity,
          'unit_price', oi.unit_price,
          'line_total', oi.line_total
        ) ORDER BY oi.id
      )
      FROM public.order_items AS oi
      WHERE oi.order_id = o.id
    ), '[]'::jsonb)
  )
  INTO v_result
  FROM public.orders AS o
  WHERE o.customer_tracking_token = p_tracking_token;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_customer_order_tracking(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_customer_order_tracking(uuid) TO anon, authenticated;
