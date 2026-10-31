
-- Recipe-based inventory costing and idempotent stock deductions on order completion.
-- No existing orders or stock quantities are altered by installing this migration.

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

create index if not exists menu_item_recipes_menu_idx
  on public.menu_item_recipes(menu_item_id);
create index if not exists menu_item_recipes_inventory_idx
  on public.menu_item_recipes(inventory_item_id);
create index if not exists order_inventory_deductions_inventory_idx
  on public.order_inventory_deductions(inventory_item_id, created_at desc);

alter table public.menu_item_recipes enable row level security;
alter table public.order_inventory_deductions enable row level security;

drop policy if exists "admin manage menu item recipes" on public.menu_item_recipes;
create policy "admin manage menu item recipes" on public.menu_item_recipes
  for all to authenticated using (public.is_current_user_admin())
  with check (public.is_current_user_admin());

drop policy if exists "admin read order inventory deductions" on public.order_inventory_deductions;
create policy "admin read order inventory deductions" on public.order_inventory_deductions
  for select to authenticated using (public.is_current_user_admin());

grant select, insert, update, delete on public.menu_item_recipes to authenticated;
grant select on public.order_inventory_deductions to authenticated;

create or replace function public.apply_order_inventory_recipe_usage()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line record;
  v_needed numeric(12,3);
  v_new_quantity numeric(12,3);
  v_recorded_item_id uuid;
  v_movement_id uuid;
begin
  if new.status <> 'completed' or old.status = 'completed' then
    return new;
  end if;

  for v_line in
    select oi.id as order_item_id, oi.quantity as meal_quantity,
           oi.item_name, oi.menu_item_id,
           r.inventory_item_id, r.quantity_per_item,
           ii.name as ingredient_name, ii.unit, ii.unit_cost
    from public.order_items oi
    join public.menu_item_recipes r on r.menu_item_id = oi.menu_item_id
    join public.inventory_items ii on ii.id = r.inventory_item_id
    where oi.order_id = new.id
    order by oi.id, r.inventory_item_id
  loop
    v_needed := v_line.quantity_per_item * v_line.meal_quantity;

    insert into public.order_inventory_deductions(
      order_item_id, inventory_item_id, quantity_deducted
    )
    values(v_line.order_item_id, v_line.inventory_item_id, v_needed)
    on conflict(order_item_id, inventory_item_id) do nothing
    returning order_item_id into v_recorded_item_id;

    if v_recorded_item_id is null then
      continue;
    end if;

    update public.inventory_items
    set quantity = quantity - v_needed,
        updated_at = now()
    where id = v_line.inventory_item_id
      and quantity >= v_needed
    returning quantity into v_new_quantity;

    if not found then
      raise exception 'Not enough stock for ingredient "%". Required: % %, available stock is insufficient. Add stock or adjust the recipe before completing this order.',
        v_line.ingredient_name, v_needed, v_line.unit;
    end if;

    insert into public.inventory_movements(
      item_id, movement_type, quantity_change, unit_cost, reference, notes, created_by
    )
    values(
      v_line.inventory_item_id, 'usage', -v_needed, coalesce(v_line.unit_cost,0),
      'Order #' || coalesce(new.order_number::text, new.id::text),
      'Automatic recipe usage for ' || coalesce(v_line.item_name,'menu item') ||
        ' (' || v_line.meal_quantity || ' sold)',
      auth.uid()
    )
    returning id into v_movement_id;

    update public.order_inventory_deductions
    set stock_movement_id = v_movement_id
    where order_item_id = v_line.order_item_id
      and inventory_item_id = v_line.inventory_item_id;

    insert into public.audit_log(actor_id,action,entity_type,entity_id,details)
    values(auth.uid(),'order_recipe_stock_deduction','inventory_item',v_line.inventory_item_id::text,
      jsonb_build_object('order_id',new.id,'order_number',new.order_number,
        'order_item_id',v_line.order_item_id,'menu_item_id',v_line.menu_item_id,
        'quantity_deducted',v_needed,'unit',v_line.unit,'remaining_quantity',v_new_quantity));
  end loop;

  return new;
end;
$$;

drop trigger if exists orders_apply_inventory_recipe_usage on public.orders;
create trigger orders_apply_inventory_recipe_usage
after update of status on public.orders
for each row
when (new.status = 'completed' and old.status is distinct from new.status)
execute function public.apply_order_inventory_recipe_usage();

notify pgrst, 'reload schema';
