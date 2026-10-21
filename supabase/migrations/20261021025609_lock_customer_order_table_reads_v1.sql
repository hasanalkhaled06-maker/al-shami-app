-- Public customers should use the token-checked tracking RPC, not direct reads of customer order tables.
REVOKE SELECT ON TABLE public.orders, public.order_items FROM anon;
