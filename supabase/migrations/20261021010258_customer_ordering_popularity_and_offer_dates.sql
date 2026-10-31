
-- Customer ordering improvements: safe public menu visibility, offer windows, and aggregate popularity.
-- No orders or customer records are changed by this migration.

ALTER TABLE public.offers
  ADD COLUMN IF NOT EXISTS starts_at timestamptz,
  ADD COLUMN IF NOT EXISTS ends_at timestamptz;

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'offers_valid_date_range'
      AND conrelid = 'public.offers'::regclass
  ) THEN
    ALTER TABLE public.offers
      ADD CONSTRAINT offers_valid_date_range
      CHECK (starts_at IS NULL OR ends_at IS NULL OR ends_at >= starts_at);
  END IF;
END
$migration$;

DROP POLICY IF EXISTS "public read available menu" ON public.menu_items;
CREATE POLICY "public read menu including unavailable"
  ON public.menu_items
  FOR SELECT
  TO anon
  USING (true);

DROP POLICY IF EXISTS "authenticated read menu" ON public.menu_items;
CREATE POLICY "authenticated read menu including unavailable"
  ON public.menu_items
  FOR SELECT
  TO authenticated
  USING (true);

CREATE OR REPLACE FUNCTION public.get_public_menu_popularity()
RETURNS TABLE(menu_item_id uuid, order_count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT oi.menu_item_id,
         pg_catalog.sum(oi.quantity)::bigint AS order_count
  FROM public.order_items AS oi
  JOIN public.orders AS o ON o.id = oi.order_id
  WHERE oi.menu_item_id IS NOT NULL
    AND o.status <> 'rejected'
  GROUP BY oi.menu_item_id;
$function$;

REVOKE ALL ON FUNCTION public.get_public_menu_popularity() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_menu_popularity() TO anon, authenticated;
