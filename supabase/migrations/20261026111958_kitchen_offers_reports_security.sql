-- Additive restaurant operations features. Existing order and inventory rows are preserved.
begin;

-- Offer scheduling and targeting (starts_at/ends_at already exist).
alter table public.offers
  add column if not exists max_uses integer,
  add column if not exists uses_count integer not null default 0,
  add column if not exists days_of_week smallint[] not null default '{}',
  add column if not exists starts_local_time time,
  add column if not exists ends_local_time time,
  add column if not exists menu_item_ids uuid[] not null default '{}',
  add column if not exists event_name text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname='offers_max_uses_nonnegative') then
    alter table public.offers add constraint offers_max_uses_nonnegative check (max_uses is null or max_uses > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname='offers_uses_count_nonnegative') then
    alter table public.offers add constraint offers_uses_count_nonnegative check (uses_count >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname='offers_days_of_week_valid') then
    alter table public.offers add constraint offers_days_of_week_valid check (days_of_week <@ array[0,1,2,3,4,5,6]::smallint[]);
  end if;
end $$;

-- Reasons are retained with the order for review and audit.
alter table public.orders add column if not exists status_reason text;
alter table public.orders add column if not exists status_changed_at timestamptz not null default now();
create table if not exists public.order_status_audit (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  old_status text,
  new_status text not null,
  reason text,
  changed_at timestamptz not null default now()
);
create index if not exists order_status_audit_order_changed_idx on public.order_status_audit(order_id,changed_at desc);
alter table public.order_status_audit enable row level security;
revoke all on public.order_status_audit from public,anon,authenticated;

-- Kitchen reads and status transitions are exposed through narrowly-scoped RPCs.
create or replace function public.get_kitchen_queue()
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v_result jsonb;
begin
  if auth.uid() is null or not exists (
    select 1 from public.staff_profiles s where s.user_id=auth.uid() and s.role='kitchen'
      and s.is_active and s.employment_status='active'
  ) then raise exception 'Active kitchen access required'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',o.id,'order_number',o.order_number,'created_at',o.created_at,'requested_for',o.requested_for,
    'estimated_ready_at',o.estimated_ready_at,'order_type',o.order_type,'status',o.status,
    'customer_name',o.customer_name,'notes',o.notes,
    'items',coalesce((select jsonb_agg(jsonb_build_object(
      'name',coalesce(i.item_name,m.name),'quantity',i.quantity,'note',i.item_note,
      'allergens',m.allergens,'station',m.category
    ) order by i.created_at) from public.order_items i left join public.menu_items m on m.id=i.menu_item_id where i.order_id=o.id),'[]'::jsonb)
  ) order by coalesce(o.requested_for,o.created_at),o.created_at), '[]'::jsonb) into v_result
  from public.orders o where o.status in ('new','accepted','preparing','ready');
  return v_result;
end $$;
revoke all on function public.get_kitchen_queue() from public,anon;
grant execute on function public.get_kitchen_queue() to authenticated;

create or replace function public.update_kitchen_order(p_order_id uuid,p_status text)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_old text;
begin
  if auth.uid() is null or not exists (
    select 1 from public.staff_profiles s where s.user_id=auth.uid() and s.role='kitchen'
      and s.is_active and s.employment_status='active'
  ) then raise exception 'Active kitchen access required'; end if;
  if p_status not in ('preparing','ready') then raise exception 'Unsupported kitchen status'; end if;
  select status into v_old from public.orders where id=p_order_id for update;
  if v_old is null or v_old not in ('accepted','preparing') then raise exception 'Order is not in the kitchen queue'; end if;
  update public.orders set status=p_status,updated_at=now(),status_changed_at=now() where id=p_order_id;
  insert into public.order_status_audit(order_id,actor_id,old_status,new_status)
  values(p_order_id,auth.uid(),v_old,p_status);
end $$;
revoke all on function public.update_kitchen_order(uuid,text) from public,anon;
grant execute on function public.update_kitchen_order(uuid,text) to authenticated;

-- Stocktakes use a barcode identifier and append adjustments to the existing movement ledger.
alter table public.inventory_items add column if not exists barcode text;
create unique index if not exists inventory_items_barcode_uq on public.inventory_items(barcode) where barcode is not null and barcode<>'';
create table if not exists public.inventory_stocktakes (
  id uuid primary key default gen_random_uuid(),
  started_by uuid references auth.users(id) on delete set null,
  completed_by uuid references auth.users(id) on delete set null,
  status text not null default 'open' check(status in ('open','completed')),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create table if not exists public.inventory_stocktake_lines (
  id uuid primary key default gen_random_uuid(),
  stocktake_id uuid not null references public.inventory_stocktakes(id) on delete cascade,
  item_id uuid not null references public.inventory_items(id) on delete restrict,
  expected_quantity numeric(12,3) not null,
  counted_quantity numeric(12,3) not null check(counted_quantity>=0),
  created_at timestamptz not null default now(),
  unique(stocktake_id,item_id)
);
alter table public.inventory_stocktakes enable row level security;
alter table public.inventory_stocktake_lines enable row level security;
revoke all on public.inventory_stocktakes,public.inventory_stocktake_lines from public,anon,authenticated;
create or replace function public.record_inventory_stocktake(p_barcode text,p_counted numeric)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_uid uuid:=auth.uid(); v_item public.inventory_items%rowtype; v_session uuid; v_delta numeric;
begin
  if v_uid is null or not public.is_current_user_admin() then raise exception 'Admin access required'; end if;
  if p_counted is null or p_counted<0 or length(trim(coalesce(p_barcode,'')))=0 then raise exception 'Barcode and a nonnegative count are required'; end if;
  select * into v_item from public.inventory_items where barcode=trim(p_barcode) and is_active for update;
  if not found then raise exception 'No active inventory item matches this barcode'; end if;
  insert into public.inventory_stocktakes(started_by) values(v_uid) returning id into v_session;
  insert into public.inventory_stocktake_lines(stocktake_id,item_id,expected_quantity,counted_quantity)
  values(v_session,v_item.id,v_item.quantity,p_counted);
  v_delta:=p_counted-v_item.quantity;
  if v_delta<>0 then perform public.record_inventory_movement(v_item.id,'adjustment',v_delta,v_item.unit_cost,'stocktake:'||v_session::text,'Barcode stocktake'); end if;
  update public.inventory_stocktakes set completed_by=v_uid,status='completed',completed_at=now() where id=v_session;
  return jsonb_build_object('stocktake_id',v_session,'item',v_item.name,'expected',v_item.quantity,'counted',p_counted,'difference',v_delta);
end $$;
revoke all on function public.record_inventory_stocktake(text,numeric) from public,anon;
grant execute on function public.record_inventory_stocktake(text,numeric) to authenticated;

-- Manager approval records for sensitive changes, with an explicit reason and immutable decision trail.
create table if not exists public.manager_approvals (
  id uuid primary key default gen_random_uuid(),
  action_type text not null check(action_type in ('cancel_accepted_order','change_menu_price')),
  entity_id uuid not null,
  requested_by uuid not null references auth.users(id) on delete restrict,
  approved_by uuid references auth.users(id) on delete set null,
  reason text not null check(length(trim(reason)) between 3 and 500),
  old_value jsonb not null default '{}'::jsonb,
  new_value jsonb not null default '{}'::jsonb,
  state text not null default 'pending' check(state in ('pending','approved','rejected')),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
alter table public.manager_approvals enable row level security;
revoke all on public.manager_approvals from public,anon,authenticated;

create or replace function public.get_sales_item_performance(p_from timestamptz,p_to timestamptz)
returns table(item_name text,units_sold bigint,gross_sales numeric,estimated_food_cost numeric,estimated_food_profit numeric)
language plpgsql stable security definer set search_path=pg_catalog,public as $$
begin
  if auth.uid() is null or not public.is_current_user_admin() then raise exception 'Admin access required'; end if;
  if p_from is null or p_to is null or p_to<=p_from or p_to-p_from>interval '366 days' then raise exception 'Choose a valid date range (up to 366 days)'; end if;
  return query
  with totals as (
    select oi.menu_item_id,coalesce(oi.item_name,m.name,'Deleted item') n,sum(oi.quantity)::bigint qty,
      sum(oi.line_total)::numeric sales,
      sum(oi.quantity*coalesce(rc.cost,0))::numeric food_cost
    from public.order_items oi join public.orders o on o.id=oi.order_id
    left join public.menu_items m on m.id=oi.menu_item_id
    left join lateral (select sum(r.quantity_per_item*i.unit_cost) cost from public.menu_item_recipes r join public.inventory_items i on i.id=r.inventory_item_id where r.menu_item_id=oi.menu_item_id) rc on true
    where o.status='completed' and o.completed_at>=p_from and o.completed_at<p_to
    group by oi.menu_item_id,coalesce(oi.item_name,m.name,'Deleted item')
  ) select n,qty,sales,food_cost,sales-food_cost from totals order by qty desc;
end $$;
revoke all on function public.get_sales_item_performance(timestamptz,timestamptz) from public,anon;
grant execute on function public.get_sales_item_performance(timestamptz,timestamptz) to authenticated;

create or replace function public.get_repeat_customer_rate(p_from timestamptz,p_to timestamptz)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v jsonb;
begin
  if auth.uid() is null or not public.is_current_user_admin() then raise exception 'Admin access required'; end if;
  if p_from is null or p_to is null or p_to<=p_from or p_to-p_from>interval '366 days' then raise exception 'Choose a valid date range (up to 366 days)'; end if;
  with customers as (
    select coalesce(nullif(trim(customer_phone),''),nullif(trim(lower(customer_name)),''),id::text) key,count(*) orders
    from public.orders where status='completed' and completed_at>=p_from and completed_at<p_to
    group by 1
  ) select jsonb_build_object('customers',count(*),'repeat_customers',count(*) filter(where orders>1),
    'repeat_rate',case when count(*)=0 then 0 else round(100.0*count(*) filter(where orders>1)/count(*),1) end)
    into v from customers;
  return v;
end $$;
revoke all on function public.get_repeat_customer_rate(timestamptz,timestamptz) from public,anon;
grant execute on function public.get_repeat_customer_rate(timestamptz,timestamptz) to authenticated;

commit;
