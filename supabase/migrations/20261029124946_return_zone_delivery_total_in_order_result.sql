CREATE OR REPLACE FUNCTION public.place_order_with_options(
  p_customer_name text,
  p_customer_phone text,
  p_order_type text,
  p_delivery_address text,
  p_notes text,
  p_items jsonb,
  p_delivery_latitude double precision,
  p_delivery_longitude double precision,
  p_requested_for timestamp with time zone DEFAULT NULL::timestamp with time zone
)
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
  v_total numeric(10,2);
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

  select o.total into v_total
  from public.orders o
  where o.id = v_order_id;

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
    'total', v_total,
    'requested_for', p_requested_for,
    'estimated_ready_at', v_eta,
    'delivery_zone', case when v_zone_found then v_zone.name else null end
  );
end;
$function$;
