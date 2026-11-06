-- Keep the legacy order RPC available only to SECURITY DEFINER wrappers owned by
-- the database owner. Browser clients must use authenticated wrappers that bind
-- an order to auth.uid().
REVOKE EXECUTE ON FUNCTION public.place_order_with_location(
  text, text, text, text, text, jsonb, double precision, double precision
) FROM PUBLIC, anon, authenticated;

-- The secure place_order_with_options and place_order_with_rewards wrappers
-- call this function as their owner and continue to work without a direct grant
-- to authenticated users.
