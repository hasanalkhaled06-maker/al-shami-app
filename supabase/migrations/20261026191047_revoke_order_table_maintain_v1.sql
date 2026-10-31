-- PostgreSQL 17 adds MAINTAIN to the broad legacy table grants. Staff clients only need SELECT on orders and order_items; explicitly remove this residual.
revoke maintain on table public.orders, public.order_items from authenticated;
