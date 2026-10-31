
-- Keep the admin-check RPC available to signed-in users only.
revoke execute on function public.is_current_user_admin() from public, anon;
grant execute on function public.is_current_user_admin() to authenticated;

-- Add safe indexes for foreign-key columns commonly used in joins/deletes.
create index if not exists audit_log_actor_id_idx
  on public.audit_log(actor_id);
create index if not exists cash_shifts_opened_by_idx
  on public.cash_shifts(opened_by);
create index if not exists cash_shifts_closed_by_idx
  on public.cash_shifts(closed_by);
create index if not exists expenses_created_by_idx
  on public.expenses(created_by);
create index if not exists inventory_items_supplier_id_idx
  on public.inventory_items(supplier_id);
create index if not exists inventory_movements_created_by_idx
  on public.inventory_movements(created_by);
create index if not exists order_items_menu_item_id_idx
  on public.order_items(menu_item_id);
create index if not exists order_items_order_id_idx
  on public.order_items(order_id);
