-- Keep customer order tracking behind sign-in, enforce map coordinates for delivery,
-- and remove the legacy order RPC that bypasses the map-selection requirement.
CREATE OR REPLACE FUNCTION public.place_order_with_location(
  p_customer_name text,
  p_customer_phone text,
  p_order_type text,
  p_delivery_address text,
  p_notes text,
  p_items jsonb,
  p_delivery_latitude double precision,
  p_delivery_longitude double precision
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_order_id uuid;
  v_number bigint;
  v_tracking_token uuid;
  v_subtotal numeric(10,2) := 0;
  v_fee numeric(10,2) := 0;
  v_min numeric(10,2) := 0;
  v_item jsonb;
  v_product public.menu_items%rowtype;
  v_qty integer;
BEGIN
  IF length(trim(coalesce(p_customer_name, ''))) < 2
     OR length(trim(coalesce(p_customer_phone, ''))) < 7 THEN
    RAISE EXCEPTION 'Enter a valid name and phone number';
  END IF;

  IF p_order_type NOT IN ('delivery', 'pickup') THEN
    RAISE EXCEPTION 'Invalid order type';
  END IF;

  IF p_order_type = 'delivery'
     AND length(trim(coalesce(p_delivery_address, ''))) < 3 THEN
    RAISE EXCEPTION 'Enter a delivery address';
  END IF;

  IF p_order_type = 'delivery'
     AND (p_delivery_latitude IS NULL OR p_delivery_longitude IS NULL) THEN
    RAISE EXCEPTION 'Select and confirm a delivery location on the map';
  END IF;

  IF (p_delivery_latitude IS NULL) <> (p_delivery_longitude IS NULL) THEN
    RAISE EXCEPTION 'Delivery map location needs both latitude and longitude';
  END IF;

  IF p_delivery_latitude IS NOT NULL AND (
    p_delivery_latitude NOT BETWEEN -90 AND 90
    OR p_delivery_longitude NOT BETWEEN -180 AND 180
  ) THEN
    RAISE EXCEPTION 'Invalid delivery map coordinates';
  END IF;

  IF p_order_type = 'pickup'
     AND (p_delivery_latitude IS NOT NULL OR p_delivery_longitude IS NOT NULL) THEN
    RAISE EXCEPTION 'Pickup orders cannot have a delivery map location';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array'
     OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Your basket is empty';
  END IF;

  SELECT delivery_fee, minimum_order
    INTO v_fee, v_min
  FROM public.restaurant_settings
  WHERE id = 1;

  IF p_order_type = 'pickup' THEN
    v_fee := 0;
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_qty := (v_item->>'quantity')::integer;
    IF v_qty < 1 OR v_qty > 50 THEN
      RAISE EXCEPTION 'Invalid quantity';
    END IF;

    SELECT * INTO v_product
    FROM public.menu_items
    WHERE id = (v_item->>'product_id')::uuid
      AND is_available = true;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'A menu item is unavailable';
    END IF;
    v_subtotal := v_subtotal + v_product.price * v_qty;
  END LOOP;

  IF v_subtotal < v_min THEN
    RAISE EXCEPTION 'Order is below the minimum amount';
  END IF;

  INSERT INTO public.orders (
    customer_name, customer_phone, order_type,
    delivery_address, delivery_latitude, delivery_longitude,
    notes, subtotal, delivery_fee, total
  ) VALUES (
    trim(p_customer_name), trim(p_customer_phone), p_order_type,
    CASE WHEN p_order_type = 'delivery' THEN trim(p_delivery_address) ELSE NULL END,
    CASE WHEN p_order_type = 'delivery' THEN p_delivery_latitude ELSE NULL END,
    CASE WHEN p_order_type = 'delivery' THEN p_delivery_longitude ELSE NULL END,
    nullif(trim(coalesce(p_notes, '')), ''),
    v_subtotal, v_fee, v_subtotal + v_fee
  )
  RETURNING id, order_number, customer_tracking_token
  INTO v_order_id, v_number, v_tracking_token;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_qty := (v_item->>'quantity')::integer;
    SELECT * INTO v_product
    FROM public.menu_items
    WHERE id = (v_item->>'product_id')::uuid
      AND is_available = true;

    INSERT INTO public.order_items (
      order_id, menu_item_id, item_name, quantity, unit_price
    ) VALUES (
      v_order_id, v_product.id, v_product.name, v_qty, v_product.price
    );
  END LOOP;

  RETURN jsonb_build_object(
    'id', v_order_id,
    'order_number', v_number,
    'total', v_subtotal + v_fee,
    'tracking_token', v_tracking_token
  );
END;
$function$;

-- The current customer app requires a signed-in account. The location-aware RPC
-- is the only order-placement endpoint the client should be able to call.
REVOKE EXECUTE ON FUNCTION public.place_order(text, text, text, text, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.place_order(text, text, text, text, text, jsonb)
  TO service_role;

REVOKE EXECUTE ON FUNCTION public.place_order_with_location(
  text, text, text, text, text, jsonb, double precision, double precision
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.place_order_with_location(
  text, text, text, text, text, jsonb, double precision, double precision
) TO authenticated;

-- Order tracking uses per-order UUIDs, but this app now requires authentication.
REVOKE EXECUTE ON FUNCTION public.get_customer_order_tracking(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_customer_order_tracking(uuid) TO authenticated;

-- A receipt code is an administrative action. The function also verifies admin membership.
REVOKE EXECUTE ON FUNCTION public.confirm_customer_receipt(bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_customer_receipt(bigint, text) TO authenticated;
