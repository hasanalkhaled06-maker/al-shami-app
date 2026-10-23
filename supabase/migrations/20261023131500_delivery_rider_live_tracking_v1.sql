-- AL SHAMI delivery rider app v1.
-- Additive only: preserves existing orders and gives riders no permission to
-- accept/reject orders or change order status. Admin status remains authoritative.

BEGIN;

-- Allow the existing employee roster to identify delivery riders.
ALTER TABLE public.staff_profiles
  DROP CONSTRAINT IF EXISTS staff_profiles_role_check;

ALTER TABLE public.staff_profiles
  ADD CONSTRAINT staff_profiles_role_check
  CHECK (role = ANY (ARRAY[
    'owner'::text, 'manager'::text, 'cashier'::text,
    'kitchen'::text, 'staff'::text, 'delivery_rider'::text
  ]));

-- A delivery order is automatically dispatched when administration accepts it.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS assigned_rider_user_id uuid,
  ADD COLUMN IF NOT EXISTS rider_tracking_started_at timestamptz;

-- staff_profiles.user_id already has a UNIQUE constraint in the staff-management schema,
-- so it already prevents assigning one Auth account to multiple staff profiles.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'orders_assigned_rider_user_id_fkey'
      AND conrelid = 'public.orders'::regclass
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_assigned_rider_user_id_fkey
      FOREIGN KEY (assigned_rider_user_id)
      REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'orders_assigned_rider_delivery_only_check'
      AND conrelid = 'public.orders'::regclass
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_assigned_rider_delivery_only_check
      CHECK (assigned_rider_user_id IS NULL OR order_type = 'delivery') NOT VALID;
  END IF;
END $$;

ALTER TABLE public.orders
  VALIDATE CONSTRAINT orders_assigned_rider_delivery_only_check;

CREATE INDEX IF NOT EXISTS orders_assigned_rider_status_idx
  ON public.orders (assigned_rider_user_id, status, created_at DESC);

-- Keep only the latest GPS point for each rider. Customers access it via a
-- token-scoped RPC and see it only while their order is Out for delivery.
CREATE TABLE IF NOT EXISTS public.delivery_rider_locations (
  rider_user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  latitude double precision NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude double precision NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  accuracy_m double precision CHECK (accuracy_m IS NULL OR accuracy_m BETWEEN 0 AND 100000),
  heading_deg double precision CHECK (heading_deg IS NULL OR heading_deg BETWEEN 0 AND 360),
  speed_mps double precision CHECK (speed_mps IS NULL OR speed_mps BETWEEN 0 AND 1000),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.delivery_rider_locations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.delivery_rider_locations FROM PUBLIC, anon, authenticated;

-- Select the active rider with the fewest unfinished delivery orders. This
-- happens only on the server; the rider app cannot claim, accept, reject, or
-- modify an order. If no active rider account is configured, the order stays
-- unassigned and the admin dashboard will indicate that setup is needed.
CREATE OR REPLACE FUNCTION public.al_shami_auto_assign_delivery_rider()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_rider_user_id uuid;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.order_type = 'delivery'
     AND NEW.status = 'out_for_delivery'
     AND OLD.status IS DISTINCT FROM NEW.status THEN
    NEW.rider_tracking_started_at := now();
  END IF;

  IF NEW.order_type <> 'delivery'
     OR NEW.status NOT IN ('accepted', 'preparing', 'ready', 'out_for_delivery')
     OR NEW.assigned_rider_user_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT sp.user_id
    INTO v_rider_user_id
  FROM public.staff_profiles AS sp
  LEFT JOIN public.orders AS active_order
    ON active_order.assigned_rider_user_id = sp.user_id
   AND active_order.id IS DISTINCT FROM NEW.id
   AND active_order.order_type = 'delivery'
   AND active_order.status IN ('accepted', 'preparing', 'ready', 'out_for_delivery')
  WHERE sp.user_id IS NOT NULL
    AND sp.role = 'delivery_rider'
    AND sp.is_active = true
    AND sp.employment_status = 'active'
  GROUP BY sp.id, sp.user_id, sp.created_at
  ORDER BY count(active_order.id) ASC, sp.created_at ASC, sp.id ASC
  LIMIT 1;

  IF v_rider_user_id IS NOT NULL THEN
    NEW.assigned_rider_user_id := v_rider_user_id;
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.al_shami_auto_assign_delivery_rider() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS al_shami_auto_assign_delivery_rider ON public.orders;
CREATE TRIGGER al_shami_auto_assign_delivery_rider
  BEFORE INSERT OR UPDATE OF status ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.al_shami_auto_assign_delivery_rider();

-- Read-only list of the authenticated rider's assigned, active delivery orders.
CREATE OR REPLACE FUNCTION public.get_my_delivery_orders()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_result jsonb;
BEGIN
  IF v_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.staff_profiles AS sp
    WHERE sp.user_id = v_user_id
      AND sp.role = 'delivery_rider'
      AND sp.is_active = true
      AND sp.employment_status = 'active'
  ) THEN
    RAISE EXCEPTION 'This account is not an active AL SHAMI delivery rider';
  END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', o.id,
      'order_number', o.order_number,
      'status', o.status,
      'customer_name', o.customer_name,
      'customer_phone', o.customer_phone,
      'delivery_address', o.delivery_address,
      'delivery_latitude', o.delivery_latitude,
      'delivery_longitude', o.delivery_longitude,
      'notes', o.notes,
      'subtotal', o.subtotal,
      'delivery_fee', o.delivery_fee,
      'total', o.total,
      'created_at', o.created_at,
      'updated_at', o.updated_at,
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
    ) ORDER BY o.created_at DESC
  ), '[]'::jsonb)
  INTO v_result
  FROM public.orders AS o
  WHERE o.assigned_rider_user_id = v_user_id
    AND o.order_type = 'delivery'
    AND o.status IN ('accepted', 'preparing', 'ready', 'out_for_delivery');

  RETURN v_result;
END;
$function$;

-- A rider can publish location only while they have an active delivery assigned.
CREATE OR REPLACE FUNCTION public.update_my_delivery_location(
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy_m double precision DEFAULT NULL,
  p_heading_deg double precision DEFAULT NULL,
  p_speed_mps double precision DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_updated_at timestamptz;
BEGIN
  IF v_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.staff_profiles AS sp
    WHERE sp.user_id = v_user_id
      AND sp.role = 'delivery_rider'
      AND sp.is_active = true
      AND sp.employment_status = 'active'
  ) THEN
    RAISE EXCEPTION 'This account is not an active AL SHAMI delivery rider';
  END IF;

  IF p_latitude IS NULL OR p_longitude IS NULL
     OR p_latitude NOT BETWEEN -90 AND 90
     OR p_longitude NOT BETWEEN -180 AND 180
     OR (p_accuracy_m IS NOT NULL AND p_accuracy_m NOT BETWEEN 0 AND 100000)
     OR (p_heading_deg IS NOT NULL AND p_heading_deg NOT BETWEEN 0 AND 360)
     OR (p_speed_mps IS NOT NULL AND p_speed_mps NOT BETWEEN 0 AND 1000) THEN
    RAISE EXCEPTION 'Invalid GPS coordinates';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.orders AS o
    WHERE o.assigned_rider_user_id = v_user_id
      AND o.order_type = 'delivery'
      AND o.status IN ('accepted', 'preparing', 'ready', 'out_for_delivery')
  ) THEN
    RAISE EXCEPTION 'There are no active delivery orders assigned to this rider';
  END IF;

  INSERT INTO public.delivery_rider_locations (
    rider_user_id, latitude, longitude, accuracy_m, heading_deg, speed_mps, updated_at
  ) VALUES (
    v_user_id, p_latitude, p_longitude, p_accuracy_m, p_heading_deg, p_speed_mps, now()
  )
  ON CONFLICT (rider_user_id) DO UPDATE SET
    latitude = EXCLUDED.latitude,
    longitude = EXCLUDED.longitude,
    accuracy_m = EXCLUDED.accuracy_m,
    heading_deg = EXCLUDED.heading_deg,
    speed_mps = EXCLUDED.speed_mps,
    updated_at = now()
  RETURNING updated_at INTO v_updated_at;

  RETURN jsonb_build_object('ok', true, 'updated_at', v_updated_at);
END;
$function$;

-- Token-scoped location endpoint. A customer cannot search or inspect other riders.
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

-- Extend the existing safe tracking response with the delivery destination and
-- current rider point. Keep the receipt code/status/items used by the customer UI.
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

-- Explicit RPC grants; neither riders nor customers receive direct table access.
REVOKE ALL ON FUNCTION public.get_my_delivery_orders() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_delivery_orders() TO authenticated;

REVOKE ALL ON FUNCTION public.update_my_delivery_location(
  double precision, double precision, double precision, double precision, double precision
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_my_delivery_location(
  double precision, double precision, double precision, double precision, double precision
) TO authenticated;

REVOKE ALL ON FUNCTION public.get_customer_rider_location(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_customer_rider_location(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.get_customer_order_tracking(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_customer_order_tracking(uuid) TO authenticated;

COMMIT;
