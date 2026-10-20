-- AL SHAMI ordering system — run in Supabase SQL Editor as project owner.
-- After creating your first admin user in Authentication, add that user's UUID to public.admin_users.
create extension if not exists pgcrypto;

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create or replace function public.is_current_user_admin()
returns boolean language sql stable security definer set search_path=public
as $$ select exists(select 1 from public.admin_users where user_id=auth.uid()); $$;
revoke all on function public.is_current_user_admin() from public, anon;
grant execute on function public.is_current_user_admin() to authenticated;

create table if not exists public.menu_items (
 id uuid primary key default gen_random_uuid(),
 name text not null,
 category text not null default 'Other',
 description text,
 price numeric(10,2) not null check(price > 0),
 image_url text,
 is_available boolean not null default true,
 sort_order integer not null default 0,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create table if not exists public.offers (
 id uuid primary key default gen_random_uuid(),
 title text not null,
 details text,
 is_active boolean not null default true,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create table if not exists public.restaurant_settings (
 id integer primary key check(id=1),
 delivery_fee numeric(10,2) not null default 0 check(delivery_fee>=0),
 minimum_order numeric(10,2) not null default 0 check(minimum_order>=0),
 restaurant_name text not null default 'AL SHAMI RESTAURANT & FAST FOOD',
 updated_at timestamptz not null default now()
);
insert into public.restaurant_settings(id) values(1) on conflict(id) do nothing;

create table if not exists public.orders (
 id uuid primary key default gen_random_uuid(),
 order_number bigint generated always as identity unique,
 customer_name text not null,
 customer_phone text not null,
 order_type text not null check(order_type in ('delivery','pickup')),
 delivery_address text,
 notes text,
 status text not null default 'new' check(status in ('new','accepted','preparing','ready','completed','rejected')),
 subtotal numeric(10,2) not null check(subtotal>=0),
 delivery_fee numeric(10,2) not null default 0 check(delivery_fee>=0),
 total numeric(10,2) not null check(total>=0),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 constraint delivery_address_required check(order_type <> 'delivery' or nullif(trim(delivery_address),'') is not null)
);
create table if not exists public.order_items (
 id uuid primary key default gen_random_uuid(),
 order_id uuid not null references public.orders(id) on delete cascade,
 menu_item_id uuid references public.menu_items(id) on delete set null,
 item_name text not null,
 quantity integer not null check(quantity between 1 and 50),
 unit_price numeric(10,2) not null check(unit_price>0),
 line_total numeric(10,2) generated always as (quantity*unit_price) stored
);
create index if not exists orders_created_at_idx on public.orders(created_at desc);
create index if not exists orders_status_idx on public.orders(status);
create index if not exists order_items_order_id_idx on public.order_items(order_id);
create index if not exists order_items_menu_item_id_idx on public.order_items(menu_item_id);

alter table public.admin_users enable row level security;
alter table public.menu_items enable row level security;
alter table public.offers enable row level security;
alter table public.restaurant_settings enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;

drop policy if exists "admins read admin list" on public.admin_users;
create policy "admins read admin list" on public.admin_users for select to authenticated using (public.is_current_user_admin());
drop policy if exists "public read available menu" on public.menu_items;
create policy "public read available menu" on public.menu_items for select to anon, authenticated using (is_available or public.is_current_user_admin());
drop policy if exists "admins manage menu" on public.menu_items;
create policy "admins manage menu" on public.menu_items for all to authenticated using (public.is_current_user_admin()) with check (public.is_current_user_admin());
drop policy if exists "public read active offers" on public.offers;
create policy "public read active offers" on public.offers for select to anon, authenticated using (is_active or public.is_current_user_admin());
drop policy if exists "admins manage offers" on public.offers;
create policy "admins manage offers" on public.offers for all to authenticated using (public.is_current_user_admin()) with check (public.is_current_user_admin());
drop policy if exists "public read settings" on public.restaurant_settings;
create policy "public read settings" on public.restaurant_settings for select to anon, authenticated using (true);
drop policy if exists "admins update settings" on public.restaurant_settings;
create policy "admins update settings" on public.restaurant_settings for update to authenticated using (public.is_current_user_admin()) with check (public.is_current_user_admin());
drop policy if exists "admins read orders" on public.orders;
create policy "admins read orders" on public.orders for select to authenticated using (public.is_current_user_admin());
drop policy if exists "admins update orders" on public.orders;
create policy "admins update orders" on public.orders for update to authenticated using (public.is_current_user_admin()) with check (public.is_current_user_admin());
drop policy if exists "admins read order items" on public.order_items;
create policy "admins read order items" on public.order_items for select to authenticated using (public.is_current_user_admin());

-- Atomic order placement. Browser cannot choose prices or totals: server fetches them from the current menu.
create or replace function public.place_order(
 p_customer_name text,
 p_customer_phone text,
 p_order_type text,
 p_delivery_address text,
 p_notes text,
 p_items jsonb
) returns jsonb language plpgsql security definer set search_path=public
as $$
declare
 v_order_id uuid; v_number bigint; v_subtotal numeric(10,2):=0; v_fee numeric(10,2):=0;
 v_min numeric(10,2):=0; v_total numeric(10,2); v_item jsonb; v_product public.menu_items%rowtype;
 v_qty integer; v_name text; v_phone text;
begin
 v_name:=trim(coalesce(p_customer_name,'')); v_phone:=trim(coalesce(p_customer_phone,''));
 if length(v_name)<2 or length(v_name)>100 then raise exception 'Please enter your name (2–100 characters).'; end if;
 if length(v_phone)<7 or length(v_phone)>30 then raise exception 'Please enter a valid phone number.'; end if;
 if p_order_type not in ('delivery','pickup') then raise exception 'Invalid order type.'; end if;
 if p_order_type='delivery' and length(trim(coalesce(p_delivery_address,'')))<3 then raise exception 'Please enter a delivery address.'; end if;
 if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 or jsonb_array_length(p_items)>30 then raise exception 'Your basket is empty or has too many lines.'; end if;
 select delivery_fee,minimum_order into v_fee,v_min from public.restaurant_settings where id=1;
 if p_order_type='pickup' then v_fee:=0; end if;
 for v_item in select value from jsonb_array_elements(p_items) loop
   if (v_item->>'product_id') is null then raise exception 'Invalid menu item.'; end if;
   begin v_qty:=(v_item->>'quantity')::integer; exception when others then raise exception 'Invalid quantity.'; end;
   if v_qty<1 or v_qty>50 then raise exception 'Quantity must be between 1 and 50.'; end if;
   select * into v_product from public.menu_items where id=(v_item->>'product_id')::uuid and is_available=true;
   if not found then raise exception 'A menu item is unavailable. Please refresh your menu.'; end if;
   v_subtotal:=v_subtotal+(v_product.price*v_qty);
 end loop;
 if v_subtotal<v_min then raise exception 'Minimum order is GH₵ % before delivery.', v_min; end if;
 v_total:=v_subtotal+v_fee;
 insert into public.orders(customer_name,customer_phone,order_type,delivery_address,notes,subtotal,delivery_fee,total)
 values(v_name,v_phone,p_order_type,case when p_order_type='delivery' then trim(p_delivery_address) else null end,nullif(trim(coalesce(p_notes,'')),''),v_subtotal,v_fee,v_total)
 returning id,order_number into v_order_id,v_number;
 for v_item in select value from jsonb_array_elements(p_items) loop
   v_qty:=(v_item->>'quantity')::integer;
   select * into v_product from public.menu_items where id=(v_item->>'product_id')::uuid and is_available=true;
   insert into public.order_items(order_id,menu_item_id,item_name,quantity,unit_price)
   values(v_order_id,v_product.id,v_product.name,v_qty,v_product.price);
 end loop;
 return jsonb_build_object('id',v_order_id,'order_number',v_number,'total',v_total);
end $$;
revoke all on function public.place_order(text,text,text,text,text,jsonb) from public;
grant execute on function public.place_order(text,text,text,text,text,jsonb) to anon, authenticated;

-- Realtime event publication for the admin dashboard.
do $$ begin
  alter publication supabase_realtime add table public.orders;
exception when duplicate_object then null;
when others then
  raise notice 'If Realtime is not enabled for public.orders, enable it in Supabase Database > Publications.';
end $$;

-- Optional initial menu rows can be added through the admin dashboard after setup.
