-- AL SHAMI migration v3
-- Additive operations upgrade for a database that already has supabase-schema.sql
-- and supabase-migration-v2.sql applied.
-- Safe to re-run: tables/columns/indexes are IF NOT EXISTS; functions and triggers are replaced.
-- Does not delete or reset any orders, menu items, or stock records.

create table if not exists public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid references public.suppliers(id) on delete restrict,
  status text not null default 'draft' check (status in ('draft','ordered','received','cancelled')),
  reference text,
  notes text,
  ordered_at timestamptz,
  received_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.purchase_order_items (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.purchase_orders(id) on delete cascade,
  item_id uuid not null references public.inventory_items(id) on delete restrict,
  quantity numeric(12,3) not null check (quantity > 0),
  received_quantity numeric(12,3) not null default 0 check (received_quantity >= 0),
  unit_cost numeric(12,2) not null check (unit_cost >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.cash_payouts (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid references public.cash_shifts(id) on delete set null,
  payout_date date not null default current_date,
  category text not null,
  description text not null,
  amount numeric(12,2) not null check (amount > 0),
  payment_method text not null default 'cash' check (payment_method in ('cash','mobile_money','bank','other')),
  reference text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.staff_attendance (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff_profiles(id) on delete restrict,
  work_date date not null default current_date,
  check_in_at timestamptz not null default now(),
  check_out_at timestamptz,
  check_in_by uuid references auth.users(id) on delete set null,
  check_out_by uuid references auth.users(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  constraint staff_attendance_checkout_after_checkin check (check_out_at is null or check_out_at >= check_in_at)
);

create table if not exists public.menu_item_recipes (
  id uuid primary key default gen_random_uuid(),
  menu_item_id uuid not null references public.menu_items(id) on delete cascade,
  inventory_item_id uuid not null references public.inventory_items(id) on delete restrict,
  quantity_per_item numeric(12,3) not null check (quantity_per_item > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(menu_item_id, inventory_item_id)
);

create table if not exists public.order_inventory_deductions (
  order_item_id uuid not null references public.order_items(id) on delete cascade,
  inventory_item_id uuid not null references public.inventory_items(id) on delete restrict,
  quantity_deducted numeric(12,3) not null check (quantity_deducted > 0),
  stock_movement_id uuid references public.inventory_movements(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key(order_item_id, inventory_item_id)
);

alter table public.orders add column if not exists completed_at timestamptz;
update public.orders set completed_at = updated_at where status = 'completed' and completed_at is null;

create index if not exists purchase_orders_created_at_idx on public.purchase_orders(created_at desc);
create index if not exists purchase_order_items_order_idx on public.purchase_order_items(purchase_order_id);
create index if not exists cash_payouts_date_idx on public.cash_payouts(payout_date desc);
create index if not exists cash_payouts_shift_idx on public.cash_payouts(shift_id, created_at);
create index if not exists staff_attendance_date_idx on public.staff_attendance(work_date desc, check_in_at desc);
create unique index if not exists staff_attendance_one_open_shift_idx on public.staff_attendance(staff_id) where check_out_at is null;
create index if not exists menu_item_recipes_menu_idx on public.menu_item_recipes(menu_item_id);
create index if not exists menu_item_recipes_inventory_idx on public.menu_item_recipes(inventory_item_id);
create index if not exists order_inventory_deductions_inventory_idx on public.order_inventory_deductions(inventory_item_id, created_at desc);
create index if not exists orders_completed_at_idx on public.orders(completed_at desc) where status = 'completed';

alter table public.purchase_orders enable row level security;
alter table public.purchase_order_items enable row level security;
alter table public.cash_payouts enable row level security;
alter table public.staff_attendance enable row level security;
alter table public.menu_item_recipes enable row level security;
alter table public.order_inventory_deductions enable row level security;

drop policy if exists "admin manage purchase orders" on public.purchase_orders;
create policy "admin manage purchase orders" on public.purchase_orders for all to authenticated
  using (public.is_current_user_admin()) with check (public.is_current_user_admin());
drop policy if exists "admin manage purchase order items" on public.purchase_order_items;
create policy "admin manage purchase order items" on public.purchase_order_items for all to authenticated
  using (public.is_current_user_admin()) with check (public.is_current_user_admin());
drop policy if exists "admin manage cash payouts" on public.cash_payouts;
create policy "admin manage cash payouts" on public.cash_payouts for all to authenticated
  using (public.is_current_user_admin()) with check (public.is_current_user_admin());
drop policy if exists "admin manage staff attendance" on public.staff_attendance;
create policy "admin manage staff attendance" on public.staff_attendance for all to authenticated
  using (public.is_current_user_admin()) with check (public.is_current_user_admin());
drop policy if exists "admin manage menu item recipes" on public.menu_item_recipes;
create policy "admin manage menu item recipes" on public.menu_item_recipes for all to authenticated
  using (public.is_current_user_admin()) with check (public.is_current_user_admin());
drop policy if exists "admin read order inventory deductions" on public.order_inventory_deductions;
create policy "admin read order inventory deductions" on public.order_inventory_deductions for select to authenticated
  using (public.is_current_user_admin());

grant select, insert, update, delete on public.purchase_orders, public.purchase_order_items,
  public.cash_payouts, public.staff_attendance, public.menu_item_recipes to authenticated;
grant select on public.order_inventory_deductions to authenticated;

create or replace function public.record_cash_payout(
  p_category text, p_description text, p_amount numeric,
  p_payment_method text default 'cash', p_payout_date date default current_date,
  p_reference text default null, p_shift_id uuid default null
)
returns uuid language plpgsql security invoker set search_path = public as $$
declare v_id uuid;
begin
  if not public.is_current_user_admin() then raise exception 'Not authorised.'; end if;
  if length(trim(coalesce(p_category,''))) < 2 then raise exception 'Enter a payout category.'; end if;
  if length(trim(coalesce(p_description,''))) < 2 then raise exception 'Enter a payout description.'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Amount must be greater than zero.'; end if;
  if p_payment_method not in ('cash','mobile_money','bank','other') then raise exception 'Invalid payment method.'; end if;
  if p_shift_id is not null and not exists (select 1 from public.cash_shifts where id=p_shift_id and status='open') then
    raise exception 'Choose an open cash shift for cash payouts.';
  end if;
  insert into public.cash_payouts(shift_id,payout_date,category,description,amount,payment_method,reference,created_by)
  values(p_shift_id,coalesce(p_payout_date,current_date),trim(p_category),trim(p_description),p_amount,p_payment_method,
    nullif(trim(coalesce(p_reference,'')),''),auth.uid()) returning id into v_id;
  insert into public.audit_log(actor_id,action,entity_type,entity_id,details)
  values(auth.uid(),'cash_payout_created','cash_payout',v_id::text,
    jsonb_build_object('category',trim(p_category),'amount',p_amount,'payment_method',p_payment_method,'shift_id',p_shift_id));
  return v_id;
end;
$$;
revoke all on function public.record_cash_payout(text,text,numeric,text,date,text,uuid) from public, anon;
grant execute on function public.record_cash_payout(text,text,numeric,text,date,text,uuid) to authenticated;

create or replace function public.receive_purchase_order(p_purchase_order_id uuid)
returns uuid language plpgsql security invoker set search_path = public as $$
declare
  v_order public.purchase_orders%rowtype;
  v_line record;
  v_movement_id uuid;
begin
  if not public.is_current_user_admin() then raise exception 'Not authorised.'; end if;
  select * into v_order from public.purchase_orders where id=p_purchase_order_id for update;
  if not found then raise exception 'Purchase order not found.'; end if;
  if v_order.status <> 'ordered' then raise exception 'Only ordered purchases can be received.'; end if;
  if not exists(select 1 from public.purchase_order_items where purchase_order_id=p_purchase_order_id) then
    raise exception 'Purchase order has no items.';
  end if;
  for v_line in
    select poi.*,ii.name as item_name from public.purchase_order_items poi
    join public.inventory_items ii on ii.id=poi.item_id
    where poi.purchase_order_id=p_purchase_order_id for update of poi,ii
  loop
    update public.inventory_items set quantity=quantity+v_line.quantity,unit_cost=v_line.unit_cost,updated_at=now()
      where id=v_line.item_id;
    insert into public.inventory_movements(item_id,movement_type,quantity_change,unit_cost,reference,notes,created_by)
    values(v_line.item_id,'purchase',v_line.quantity,v_line.unit_cost,
      coalesce(v_order.reference,p_purchase_order_id::text),'Received from purchase order',auth.uid())
    returning id into v_movement_id;
    update public.purchase_order_items set received_quantity=quantity where id=v_line.id;
    insert into public.audit_log(actor_id,action,entity_type,entity_id,details)
    values(auth.uid(),'purchase_order_item_received','inventory_item',v_line.item_id::text,
      jsonb_build_object('purchase_order_id',p_purchase_order_id,'quantity',v_line.quantity,'unit_cost',v_line.unit_cost,'movement_id',v_movement_id));
  end loop;
  update public.purchase_orders set status='received',received_at=now(),updated_at=now() where id=p_purchase_order_id;
  insert into public.audit_log(actor_id,action,entity_type,entity_id,details)
  values(auth.uid(),'purchase_order_received','purchase_order',p_purchase_order_id::text,
    jsonb_build_object('supplier_id',v_order.supplier_id,'reference',v_order.reference));
  return p_purchase_order_id;
end;
$$;
revoke all on function public.receive_purchase_order(uuid) from public, anon;
grant execute on function public.receive_purchase_order(uuid) to authenticated;

create or replace function public.set_order_completed_at()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.status='completed' then
    if tg_op='INSERT' then
      new.completed_at := coalesce(new.completed_at,now());
    elsif old.status is distinct from new.status then
      new.completed_at := coalesce(old.completed_at,now());
    elsif new.completed_at is null then
      new.completed_at := old.completed_at;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists orders_set_completed_at on public.orders;
create trigger orders_set_completed_at before insert or update of status on public.orders
for each row execute function public.set_order_completed_at();

create or replace function public.apply_order_inventory_recipe_usage()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_line record;
  v_needed numeric(12,3);
  v_new_quantity numeric(12,3);
  v_recorded_item_id uuid;
  v_movement_id uuid;
begin
  if new.status <> 'completed' or old.status = 'completed' then return new; end if;
  for v_line in
    select oi.id as order_item_id,oi.quantity as meal_quantity,oi.item_name,oi.menu_item_id,
      r.inventory_item_id,r.quantity_per_item,ii.name as ingredient_name,ii.unit,ii.unit_cost
    from public.order_items oi
    join public.menu_item_recipes r on r.menu_item_id=oi.menu_item_id
    join public.inventory_items ii on ii.id=r.inventory_item_id
    where oi.order_id=new.id order by oi.id,r.inventory_item_id
  loop
    v_needed := v_line.quantity_per_item*v_line.meal_quantity;
    insert into public.order_inventory_deductions(order_item_id,inventory_item_id,quantity_deducted)
    values(v_line.order_item_id,v_line.inventory_item_id,v_needed)
    on conflict(order_item_id,inventory_item_id) do nothing
    returning order_item_id into v_recorded_item_id;
    if v_recorded_item_id is null then continue; end if;

    update public.inventory_items set quantity=quantity-v_needed,updated_at=now()
    where id=v_line.inventory_item_id and quantity>=v_needed returning quantity into v_new_quantity;
    if not found then
      raise exception 'Not enough stock for ingredient "%". Required: % %, available stock is insufficient. Add stock or adjust the recipe before completing this order.',
        v_line.ingredient_name,v_needed,v_line.unit;
    end if;
    insert into public.inventory_movements(item_id,movement_type,quantity_change,unit_cost,reference,notes,created_by)
    values(v_line.inventory_item_id,'usage',-v_needed,coalesce(v_line.unit_cost,0),
      'Order #'||coalesce(new.order_number::text,new.id::text),
      'Automatic recipe usage for '||coalesce(v_line.item_name,'menu item')||' ('||v_line.meal_quantity||' sold)',auth.uid())
    returning id into v_movement_id;
    update public.order_inventory_deductions set stock_movement_id=v_movement_id
    where order_item_id=v_line.order_item_id and inventory_item_id=v_line.inventory_item_id;
    insert into public.audit_log(actor_id,action,entity_type,entity_id,details)
    values(auth.uid(),'order_recipe_stock_deduction','inventory_item',v_line.inventory_item_id::text,
      jsonb_build_object('order_id',new.id,'order_number',new.order_number,'order_item_id',v_line.order_item_id,
        'menu_item_id',v_line.menu_item_id,'quantity_deducted',v_needed,'unit',v_line.unit,'remaining_quantity',v_new_quantity));
  end loop;
  return new;
end;
$$;
drop trigger if exists orders_apply_inventory_recipe_usage on public.orders;
create trigger orders_apply_inventory_recipe_usage after update of status on public.orders
for each row when (new.status='completed' and old.status is distinct from new.status)
execute function public.apply_order_inventory_recipe_usage();

create or replace function public.close_cash_shift(
  p_shift_id uuid,p_counted_cash numeric,p_notes text default null
)
returns uuid language plpgsql security invoker set search_path = public as $$
declare
  v_id uuid;
  v_opened_at timestamptz;
  v_closed_at timestamptz := now();
  v_opening_cash numeric(12,2);
  v_sales numeric(12,2) := 0;
  v_cash_expenses numeric(12,2) := 0;
  v_cash_payouts numeric(12,2) := 0;
  v_expected_cash numeric(12,2);
  v_difference numeric(12,2);
begin
  if not public.is_current_user_admin() then raise exception 'Not authorised.'; end if;
  if p_counted_cash is null or p_counted_cash<0 then raise exception 'Counted cash cannot be negative.'; end if;
  select opened_at,opening_cash into v_opened_at,v_opening_cash
  from public.cash_shifts where id=p_shift_id and status='open' for update;
  if not found then raise exception 'Open shift not found.'; end if;
  select coalesce(sum(total),0) into v_sales from public.orders
    where status='completed' and completed_at>=v_opened_at and completed_at<=v_closed_at;
  select coalesce(sum(amount),0) into v_cash_expenses from public.expenses
    where payment_method='cash' and created_at>=v_opened_at and created_at<=v_closed_at;
  select coalesce(sum(amount),0) into v_cash_payouts from public.cash_payouts
    where payment_method='cash' and created_at>=v_opened_at and created_at<=v_closed_at
      and (shift_id=p_shift_id or shift_id is null);
  v_expected_cash:=v_opening_cash+v_sales-v_cash_expenses-v_cash_payouts;
  v_difference:=p_counted_cash-v_expected_cash;
  update public.cash_shifts set closed_by=auth.uid(),closed_at=v_closed_at,expected_cash=v_expected_cash,
    counted_cash=p_counted_cash,difference=v_difference,
    notes=coalesce(nullif(trim(coalesce(p_notes,'')),''),notes),status='closed'
    where id=p_shift_id and status='open' returning id into v_id;
  if v_id is null then raise exception 'Open shift not found.'; end if;
  insert into public.audit_log(actor_id,action,entity_type,entity_id,details)
  values(auth.uid(),'cash_shift_closed','cash_shift',v_id::text,
    jsonb_build_object('opening_cash',v_opening_cash,'completed_cash_sales',v_sales,'cash_expenses',v_cash_expenses,
      'cash_payouts',v_cash_payouts,'expected_cash',v_expected_cash,'counted_cash',p_counted_cash,'difference',v_difference));
  return v_id;
end;
$$;
revoke all on function public.close_cash_shift(uuid,numeric,text) from public;
grant execute on function public.close_cash_shift(uuid,numeric,text) to authenticated;

notify pgrst, 'reload schema';
