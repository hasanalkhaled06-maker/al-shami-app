-- AL SHAMI upgrade v2: operations module
-- SAFE BY DESIGN: creates new tables only; does not drop or rewrite existing tables/data.
-- Review and run manually in Supabase SQL Editor only after backing up the project.

create extension if not exists pgcrypto;

create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  email text,
  address text,
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  unit text not null default 'unit',
  quantity numeric(12,3) not null default 0 check (quantity >= 0),
  reorder_level numeric(12,3) not null default 0 check (reorder_level >= 0),
  unit_cost numeric(12,2) not null default 0 check (unit_cost >= 0),
  supplier_id uuid references public.suppliers(id) on delete set null,
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.inventory_items(id) on delete restrict,
  movement_type text not null check (movement_type in ('opening','purchase','usage','waste','adjustment')),
  quantity_change numeric(12,3) not null check (quantity_change <> 0),
  unit_cost numeric(12,2) not null default 0 check (unit_cost >= 0),
  reference text,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  expense_date date not null default current_date,
  category text not null,
  description text not null,
  amount numeric(12,2) not null check (amount > 0),
  payment_method text not null default 'cash' check (payment_method in ('cash','mobile_money','bank','other')),
  reference text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.staff_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users(id) on delete set null,
  full_name text not null,
  phone text,
  role text not null default 'staff' check (role in ('owner','manager','cashier','kitchen','staff')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.cash_shifts (
  id uuid primary key default gen_random_uuid(),
  opened_by uuid references auth.users(id) on delete set null,
  closed_by uuid references auth.users(id) on delete set null,
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  opening_cash numeric(12,2) not null default 0 check (opening_cash >= 0),
  expected_cash numeric(12,2),
  counted_cash numeric(12,2),
  difference numeric(12,2),
  notes text,
  status text not null default 'open' check (status in ('open','closed')),
  created_at timestamptz not null default now(),
  constraint closed_shift_fields check (
    (status = 'open' and closed_at is null) or
    (status = 'closed' and closed_at is not null)
  )
);

create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists inventory_items_name_idx on public.inventory_items(name);
create index if not exists inventory_movements_item_date_idx on public.inventory_movements(item_id, created_at desc);
create index if not exists expenses_date_idx on public.expenses(expense_date desc);
create index if not exists cash_shifts_opened_idx on public.cash_shifts(opened_at desc);
create index if not exists audit_log_created_idx on public.audit_log(created_at desc);

-- All new operations tables are private to authorised admins.
alter table public.suppliers enable row level security;
alter table public.inventory_items enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.expenses enable row level security;
alter table public.staff_profiles enable row level security;
alter table public.cash_shifts enable row level security;
alter table public.audit_log enable row level security;

drop policy if exists "admin manage suppliers" on public.suppliers;
create policy "admin manage suppliers" on public.suppliers for all to authenticated
using (public.is_current_user_admin()) with check (public.is_current_user_admin());

drop policy if exists "admin manage inventory items" on public.inventory_items;
create policy "admin manage inventory items" on public.inventory_items for all to authenticated
using (public.is_current_user_admin()) with check (public.is_current_user_admin());

drop policy if exists "admin manage inventory movements" on public.inventory_movements;
create policy "admin manage inventory movements" on public.inventory_movements for all to authenticated
using (public.is_current_user_admin()) with check (public.is_current_user_admin());

drop policy if exists "admin manage expenses" on public.expenses;
create policy "admin manage expenses" on public.expenses for all to authenticated
using (public.is_current_user_admin()) with check (public.is_current_user_admin());

drop policy if exists "admin manage staff profiles" on public.staff_profiles;
create policy "admin manage staff profiles" on public.staff_profiles for all to authenticated
using (public.is_current_user_admin()) with check (public.is_current_user_admin());

drop policy if exists "admin manage cash shifts" on public.cash_shifts;
create policy "admin manage cash shifts" on public.cash_shifts for all to authenticated
using (public.is_current_user_admin()) with check (public.is_current_user_admin());

drop policy if exists "admin read audit log" on public.audit_log;
create policy "admin read audit log" on public.audit_log for select to authenticated
using (public.is_current_user_admin());

-- Movement RPC keeps inventory quantity and its movement record in one transaction.
create or replace function public.record_inventory_movement(
  p_item_id uuid,
  p_movement_type text,
  p_quantity_change numeric,
  p_unit_cost numeric default 0,
  p_reference text default null,
  p_notes text default null
) returns uuid
language plpgsql security invoker set search_path = public
as $$
declare
  v_id uuid;
  v_new_quantity numeric(12,3);
begin
  if not public.is_current_user_admin() then
    raise exception 'Not authorised.';
  end if;
  if p_movement_type not in ('opening','purchase','usage','waste','adjustment') then
    raise exception 'Invalid movement type.';
  end if;
  if p_quantity_change = 0 or p_unit_cost < 0 then
    raise exception 'Quantity change cannot be zero and unit cost cannot be negative.';
  end if;

  update public.inventory_items
  set quantity = quantity + p_quantity_change,
      unit_cost = case when p_movement_type = 'purchase' and p_unit_cost > 0 then p_unit_cost else unit_cost end,
      updated_at = now()
  where id = p_item_id
  returning quantity into v_new_quantity;

  if not found then raise exception 'Inventory item not found.'; end if;
  if v_new_quantity < 0 then raise exception 'Stock cannot become negative.'; end if;

  insert into public.inventory_movements(item_id, movement_type, quantity_change, unit_cost, reference, notes, created_by)
  values(p_item_id, p_movement_type, p_quantity_change, coalesce(p_unit_cost,0), p_reference, p_notes, auth.uid())
  returning id into v_id;

  insert into public.audit_log(actor_id, action, entity_type, entity_id, details)
  values(auth.uid(), 'inventory_movement', 'inventory_item', p_item_id::text,
    jsonb_build_object('type',p_movement_type,'quantity_change',p_quantity_change,'new_quantity',v_new_quantity));

  return v_id;
end $$;
revoke all on function public.record_inventory_movement(uuid,text,numeric,numeric,text,text) from public;
grant execute on function public.record_inventory_movement(uuid,text,numeric,numeric,text,text) to authenticated;

-- Record expense through a checked admin-only RPC.
create or replace function public.record_expense(
  p_category text, p_description text, p_amount numeric,
  p_expense_date date default current_date,
  p_payment_method text default 'cash',
  p_reference text default null
) returns uuid
language plpgsql security invoker set search_path = public
as $$
declare v_id uuid;
begin
  if not public.is_current_user_admin() then raise exception 'Not authorised.'; end if;
  if length(trim(coalesce(p_category,''))) < 2 then raise exception 'Enter an expense category.'; end if;
  if length(trim(coalesce(p_description,''))) < 2 then raise exception 'Enter a description.'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Amount must be greater than zero.'; end if;
  if p_payment_method not in ('cash','mobile_money','bank','other') then raise exception 'Invalid payment method.'; end if;

  insert into public.expenses(expense_date,category,description,amount,payment_method,reference,created_by)
  values(coalesce(p_expense_date,current_date),trim(p_category),trim(p_description),p_amount,p_payment_method,nullif(trim(coalesce(p_reference,'')),''),auth.uid())
  returning id into v_id;

  insert into public.audit_log(actor_id, action, entity_type, entity_id, details)
  values(auth.uid(),'expense_created','expense',v_id::text,jsonb_build_object('category',p_category,'amount',p_amount));

  return v_id;
end $$;
revoke all on function public.record_expense(text,text,numeric,date,text,text) from public;
grant execute on function public.record_expense(text,text,numeric,date,text,text) to authenticated;

-- Shift close RPC records the actual count and the difference supplied by the caller.
create or replace function public.close_cash_shift(p_shift_id uuid, p_counted_cash numeric, p_notes text default null)
returns uuid language plpgsql security invoker set search_path = public
as $$
declare v_id uuid;
begin
  if not public.is_current_user_admin() then raise exception 'Not authorised.'; end if;
  if p_counted_cash is null or p_counted_cash < 0 then raise exception 'Counted cash cannot be negative.'; end if;

  update public.cash_shifts
  set closed_by=auth.uid(), closed_at=now(), counted_cash=p_counted_cash,
      difference=p_counted_cash-coalesce(expected_cash,opening_cash),
      notes=coalesce(nullif(trim(coalesce(p_notes,'')),''),notes),
      status='closed'
  where id=p_shift_id and status='open'
  returning id into v_id;

  if v_id is null then raise exception 'Open shift not found.'; end if;

  insert into public.audit_log(actor_id,action,entity_type,entity_id,details)
  values(auth.uid(),'cash_shift_closed','cash_shift',v_id::text,
    jsonb_build_object('counted_cash',p_counted_cash,'difference',(select difference from public.cash_shifts where id=v_id)));
  return v_id;
end $$;
revoke all on function public.close_cash_shift(uuid,numeric,text) from public;
grant execute on function public.close_cash_shift(uuid,numeric,text) to authenticated;
