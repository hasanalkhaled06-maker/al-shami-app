-- Add fixed offer prices and honor them on customer orders without changing current offer rows.
ALTER TABLE public.offers
  ADD COLUMN price numeric(10,2);

ALTER TABLE public.offers
  ADD CONSTRAINT offers_price_positive
  CHECK (price IS NULL OR price > 0);

ALTER TABLE public.order_items
  ADD COLUMN offer_id uuid REFERENCES public.offers(id) ON DELETE SET NULL;

ALTER TABLE public.order_items
  ADD CONSTRAINT order_items_one_catalog_source
  CHECK (menu_item_id IS NULL OR offer_id IS NULL);

CREATE OR REPLACE FUNCTION public.place_order_with_location(p_customer_name text, p_customer_phone text, p_order_type text, p_delivery_address text, p_notes text, p_items jsonb, p_delivery_latitude double precision, p_delivery_longitude double precision)
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
  v_offer public.offers%rowtype;
  v_expected_price numeric(10,2);
  v_offer_note text;
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

    IF v_item ? 'offer_id' THEN
      IF v_item ? 'product_id' THEN
        RAISE EXCEPTION 'An order line cannot be both a product and an offer';
      END IF;

      SELECT * INTO v_offer
      FROM public.offers
      WHERE id = (v_item->>'offer_id')::uuid
        AND is_active = true
        AND price IS NOT NULL
        AND (starts_at IS NULL OR starts_at <= now())
        AND (ends_at IS NULL OR ends_at >= now());

      IF NOT FOUND THEN
        RAISE EXCEPTION 'This offer is unavailable or has no price';
      END IF;

      IF nullif(v_item->>'expected_price', '') IS NULL
         OR round((v_item->>'expected_price')::numeric, 2) <> v_offer.price THEN
        RAISE EXCEPTION 'The offer price changed. Review your basket and try again.';
      END IF;

      v_subtotal := v_subtotal + v_offer.price * v_qty;
    ELSE
      SELECT * INTO v_product
      FROM public.menu_items
      WHERE id = (v_item->>'product_id')::uuid
        AND is_available = true;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'A menu item is unavailable';
      END IF;
      v_subtotal := v_subtotal + v_product.price * v_qty;
    END IF;
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

    IF v_item ? 'offer_id' THEN
      SELECT * INTO v_offer
      FROM public.offers
      WHERE id = (v_item->>'offer_id')::uuid
        AND is_active = true
        AND price IS NOT NULL
        AND (starts_at IS NULL OR starts_at <= now())
        AND (ends_at IS NULL OR ends_at >= now());

      IF NOT FOUND OR round((v_item->>'expected_price')::numeric, 2) <> v_offer.price THEN
        RAISE EXCEPTION 'The offer price changed. Review your basket and try again.';
      END IF;

      v_offer_note := nullif(left(trim(concat_ws(E'\n',
        nullif(trim(v_offer.details), ''),
        nullif(trim(coalesce(v_item->>'item_note', '')), '')
      )), 500), '');

      INSERT INTO public.order_items (
        order_id, menu_item_id, offer_id, item_name, quantity, unit_price, item_note
      ) VALUES (
        v_order_id, NULL, v_offer.id, v_offer.title, v_qty, v_offer.price, v_offer_note
      );
    ELSE
      SELECT * INTO v_product
      FROM public.menu_items
      WHERE id = (v_item->>'product_id')::uuid
        AND is_available = true;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'A menu item is unavailable';
      END IF;

      INSERT INTO public.order_items (
        order_id, menu_item_id, item_name, quantity, unit_price
      ) VALUES (
        v_order_id, v_product.id, v_product.name, v_qty, v_product.price
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'id', v_order_id,
    'order_number', v_number,
    'total', v_subtotal + v_fee,
    'tracking_token', v_tracking_token
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.place_order_with_options(p_customer_name text, p_customer_phone text, p_order_type text, p_delivery_address text, p_notes text, p_items jsonb, p_delivery_latitude double precision, p_delivery_longitude double precision, p_requested_for timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_result jsonb;
  v_order_id uuid;
  v_zone public.delivery_zones%rowtype;
  v_zone_found boolean := false;
  v_settings public.restaurant_settings%rowtype;
  v_fee numeric(10,2);
  v_prep integer;
  v_delivery_minutes integer;
  v_eta timestamptz;
  v_requested timestamptz := p_requested_for;
  v_item jsonb;
begin
  if v_user_id is null then
    raise exception 'Sign in before placing an order';
  end if;

  select * into v_settings from public.restaurant_settings where id = 1;
  if not found then raise exception 'Restaurant settings are unavailable'; end if;

  if v_requested is not null then
    if not v_settings.allow_scheduled_orders then
      raise exception 'Scheduled orders are not available right now';
    end if;
    if v_requested < now() + make_interval(mins => v_settings.schedule_min_notice_minutes)
       or v_requested > now() + make_interval(days => v_settings.schedule_max_days) then
      raise exception 'Choose a time within the available scheduling window';
    end if;
  end if;

  if p_order_type = 'delivery' then
    select z.* into v_zone
    from public.delivery_zones z
    where z.is_active
      and 6371 * acos(least(1, greatest(-1,
        sin(radians(p_delivery_latitude)) * sin(radians(z.center_latitude)) +
        cos(radians(p_delivery_latitude)) * cos(radians(z.center_latitude)) *
        cos(radians(z.center_longitude - p_delivery_longitude))
      ))) <= z.radius_km
    order by z.radius_km asc
    limit 1;
    v_zone_found := found;
    if not v_zone_found and exists (select 1 from public.delivery_zones where is_active) then
      raise exception 'This location is outside the active delivery zones';
    end if;
  end if;

  v_result := public.place_order_with_location(
    p_customer_name, p_customer_phone, p_order_type, p_delivery_address,
    p_notes, p_items, p_delivery_latitude, p_delivery_longitude
  );
  v_order_id := (v_result->>'id')::uuid;

  if p_order_type = 'delivery' and v_zone_found then
    v_fee := v_zone.delivery_fee;
  else
    v_fee := case when p_order_type = 'pickup' then 0 else coalesce(v_settings.delivery_fee, 0) end;
  end if;

  select max(prep_minutes) into v_prep
  from (
    select m.prep_minutes
    from jsonb_array_elements(p_items) as it(item)
    join public.menu_items m on m.id = (it.item->>'product_id')::uuid
    where it.item ? 'product_id'
    union all
    select m.prep_minutes
    from jsonb_array_elements(p_items) as it(item)
    join public.offers o on o.id = (it.item->>'offer_id')::uuid
    join public.menu_items m on m.id = any(o.menu_item_ids)
    where it.item ? 'offer_id'
  ) offer_prep;

  if v_requested is null then v_requested := now(); end if;
  v_delivery_minutes := case
    when p_order_type = 'pickup' then 0
    else coalesce(v_zone.estimated_delivery_minutes, v_settings.default_delivery_minutes)
  end;
  if coalesce(v_prep, v_settings.default_prep_minutes) is not null
     and v_delivery_minutes is not null then
    v_eta := v_requested + make_interval(mins =>
      coalesce(v_prep, v_settings.default_prep_minutes) + v_delivery_minutes
    );
  end if;

  update public.orders
  set customer_user_id = v_user_id,
      requested_for = p_requested_for,
      delivery_zone_id = case when v_zone_found then v_zone.id else null end,
      delivery_fee = v_fee,
      total = subtotal + v_fee,
      estimated_ready_at = v_eta
  where id = v_order_id;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    if v_item ? 'offer_id' then
      update public.order_items
      set item_note = coalesce(
        nullif(left(trim(coalesce(v_item->>'item_note','')), 500), ''),
        item_note
      )
      where order_id = v_order_id
        and offer_id = (v_item->>'offer_id')::uuid;
    else
      update public.order_items
      set item_note = nullif(left(trim(coalesce(v_item->>'item_note','')), 500), '')
      where order_id = v_order_id
        and menu_item_id = (v_item->>'product_id')::uuid;
    end if;
  end loop;

  return v_result || jsonb_build_object(
    'delivery_fee', v_fee,
    'requested_for', p_requested_for,
    'estimated_ready_at', v_eta,
    'delivery_zone', case when v_zone_found then v_zone.name else null end
  );
end;
$function$
;
