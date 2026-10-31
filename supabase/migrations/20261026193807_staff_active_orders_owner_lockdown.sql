begin;

-- Shared restaurant workstations may use active staff accounts for the live queue,
-- but history and management data remain restricted to administrators.
drop policy if exists "active order staff read active orders" on public.orders;
create policy "active order staff read active orders"
  on public.orders
  for select
  to authenticated
  using (
    status in ('new', 'accepted', 'preparing', 'ready', 'out_for_delivery')
    and public.get_my_staff_role() in ('cashier', 'kitchen')
  );

drop policy if exists "active order staff read active items" on public.order_items;
create policy "active order staff read active items"
  on public.order_items
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.orders o
      where o.id = order_items.order_id
        and o.status in ('new', 'accepted', 'preparing', 'ready', 'out_for_delivery')
    )
    and public.get_my_staff_role() in ('cashier', 'kitchen')
  );

-- Status changes go through the role-specific, validated RPCs. No authenticated
-- browser session may edit customer, payment, delivery, or other order fields.
revoke update on table public.orders from authenticated;
revoke delete on table public.orders from authenticated;
revoke delete on table public.order_items from authenticated;

commit;
