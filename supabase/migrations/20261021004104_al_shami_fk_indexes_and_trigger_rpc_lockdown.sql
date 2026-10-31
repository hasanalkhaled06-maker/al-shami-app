-- Safe performance/security hardening: indexes only; no existing rows are changed.
create index if not exists cash_payouts_created_by_idx
  on public.cash_payouts (created_by);
create index if not exists order_inventory_deductions_stock_movement_id_idx
  on public.order_inventory_deductions (stock_movement_id);
create index if not exists purchase_order_items_item_id_idx
  on public.purchase_order_items (item_id);
create index if not exists purchase_orders_created_by_idx
  on public.purchase_orders (created_by);
create index if not exists purchase_orders_supplier_id_idx
  on public.purchase_orders (supplier_id);
create index if not exists staff_attendance_check_in_by_idx
  on public.staff_attendance (check_in_by);
create index if not exists staff_attendance_check_out_by_idx
  on public.staff_attendance (check_out_by);

-- This is a trigger-only function. It should not be callable as a public RPC.
revoke execute on function public.apply_order_inventory_recipe_usage() from public, anon, authenticated;
