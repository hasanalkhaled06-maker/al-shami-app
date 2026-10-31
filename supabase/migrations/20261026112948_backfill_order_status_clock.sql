-- Backfill only the newly introduced status clock; no order status or customer/order data changes.
update public.orders
set status_changed_at = coalesce(updated_at, created_at)
where status_changed_at > coalesce(updated_at, created_at);
