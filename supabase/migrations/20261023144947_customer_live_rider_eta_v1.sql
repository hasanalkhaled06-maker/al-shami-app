-- AL SHAMI live rider movement, heading and speed for customer ETA presentation.
-- Still token-scoped; customers do not get direct access to delivery_rider_locations.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_customer_rider_location(p_tracking_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR p_tracking_token IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT jsonb_build_object(
    'latitude', loc.latitude,
    'longitude', loc.longitude,
    'accuracy_m', loc.accuracy_m,
    'heading_deg', loc.heading_deg,
    'speed_mps', loc.speed_mps,
    'updated_at', loc.updated_at,
    'is_stale', loc.updated_at < now() - interval '45 seconds',
    'rider_name', COALESCE(sp.full_name, 'AL SHAMI delivery rider')
  )
  INTO v_result
  FROM public.orders AS o
  JOIN public.delivery_rider_locations AS loc
    ON loc.rider_user_id = o.assigned_rider_user_id
  LEFT JOIN public.staff_profiles AS sp
    ON sp.user_id = o.assigned_rider_user_id
  WHERE o.customer_tracking_token = p_tracking_token
    AND o.order_type = 'delivery'
    AND o.status = 'out_for_delivery'
    AND o.rider_tracking_started_at IS NOT NULL
    AND loc.updated_at >= o.rider_tracking_started_at
  LIMIT 1;

  RETURN v_result;
END;
$function$;

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
  IF auth.uid() IS NULL OR p_tracking_token IS NULL THEN
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
    'receipt_code', o.receipt_code,
    'delivery_latitude', o.delivery_latitude,
    'delivery_longitude', o.delivery_longitude,
    'rider_location', CASE
      WHEN o.status = 'out_for_delivery' AND o.assigned_rider_user_id IS NOT NULL THEN (
        SELECT jsonb_build_object(
          'latitude', loc.latitude,
          'longitude', loc.longitude,
          'accuracy_m', loc.accuracy_m,
          'heading_deg', loc.heading_deg,
          'speed_mps', loc.speed_mps,
          'updated_at', loc.updated_at,
          'is_stale', loc.updated_at < now() - interval '45 seconds',
          'rider_name', COALESCE(sp.full_name, 'AL SHAMI delivery rider')
        )
        FROM public.delivery_rider_locations AS loc
        LEFT JOIN public.staff_profiles AS sp
          ON sp.user_id = o.assigned_rider_user_id
        WHERE loc.rider_user_id = o.assigned_rider_user_id
          AND o.rider_tracking_started_at IS NOT NULL
          AND loc.updated_at >= o.rider_tracking_started_at
        LIMIT 1
      )
      ELSE NULL
    END,
    'items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'name', oi.item_name,
        'quantity', oi.quantity,
        'unit_price', oi.unit_price,
        'line_total', oi.line_total
      ) ORDER BY oi.id)
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

REVOKE ALL ON FUNCTION public.get_customer_rider_location(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_customer_rider_location(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.get_customer_order_tracking(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_customer_order_tracking(uuid) TO authenticated;

COMMIT;
