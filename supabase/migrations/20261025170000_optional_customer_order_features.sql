-- AL SHAMI optional customer/order features.
-- Additive only: no existing rows are deleted or rewritten.
-- Apply manually after reviewing; this file is NOT applied to production by this commit.

alter table public.menu_items
  add column if not exists prep_minutes integer,
  add column if not exists ingredients text,
  add column if not exists portion_info text,
  add column if not exists spice_level smallint,
  add column if not exists allergens text[] not null default '{}';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'menu_items_prep_minutes_check') then
    alter table public.menu_items add constraint menu_items_prep_minutes_check
      check (prep_minutes is null or prep_minutes between 1 and 360);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'menu_items_spice_level_check') then
    alter table public.menu_items add constraint menu_items_spice_level_check
      check (spice_level is null or spice_level between 0 and 5);
  end if;
end $$;

alter table public.restaurant_settings
  add column if not exists allow_scheduled_orders boolean not null default false,
  add column if not exists schedule_min_notice_minutes integer not null default 60,
  add column if not exists schedule_max_days integer not null default 14,
  add column if not exists default_prep_minutes integer,
  add column if not exists default_delivery_minutes integer;

create table if not exists public.delivery_zones (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 100),
  center_latitude double precision not null check (center_latitude between -90 and 90),
  center_longitude double precision not null check (center_longitude between -180 and 180),
  radius_km numeric(7,2) not null check (radius_km > 0 and radius_km <= 100),
  delivery_fee numeric(10,2) not null check (delivery_fee >= 0),
  estimated_delivery_minutes integer check (estimated_delivery_minutes is null or estimated_delivery_minutes between 1 and 360),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.orders
  add column if not exists customer_user_id uuid references auth.users(id) on delete set null,
  add column if not exists requested_for timestamptz,
  add column if not exists estimated_ready_at timestamptz,
  add column if not exists delivery_zone_id uuid references public.delivery_zones(id) on delete set null;

alter table public.order_items
  add column if not exists item_note text;

create table if not exists public.menu_reviews (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  menu_item_id uuid not null references public.menu_items(id) on delete cascade,
  customer_user_id uuid not null references auth.users(id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  review_text text check (review_text is null or length(review_text) <= 1000),
  photo_url text check (photo_url is null or photo_url ~ '^https://'),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at timestamptz not null default now(),
  unique (order_id, menu_item_id, customer_user_id)
);

create index if not exists menu_reviews_approved_item_created_idx
  on public.menu_reviews(menu_item_id, created_at desc) where status = 'approved';

alter table public.delivery_zones enable row level security;
alter table public.menu_reviews enable row level security;

drop policy if exists "Public can read active delivery zones" on public.delivery_zones;
create policy "Public can read active delivery zones" on public.delivery_zones
  for select to anon, authenticated using (is_active);

drop policy if exists "Admins manage delivery zones" on public.delivery_zones;
create policy "Admins manage delivery zones" on public.delivery_zones
  for all to authenticated
  using (exists (select 1 from public.admin_users a where a.user_id = (select auth.uid())))
  with check (exists (select 1 from public.admin_users a where a.user_id = (select auth.uid())));

drop policy if exists "Public can read approved menu reviews" on public.menu_reviews;
create policy "Public can read approved menu reviews" on public.menu_reviews
  for select to anon, authenticated using (status = 'approved');

drop policy if exists "Admins read all menu reviews" on public.menu_reviews;
create policy "Admins read all menu reviews" on public.menu_reviews
  for select to authenticated
  using (exists (select 1 from public.admin_users a where a.user_id = (select auth.uid())));

drop policy if exists "Admins moderate menu reviews" on public.menu_reviews;
create policy "Admins moderate menu reviews" on public.menu_reviews
  for update to authenticated
  using (exists (select 1 from public.admin_users a where a.user_id = (select auth.uid())))
  with check (exists (select 1 from public.admin_users a where a.user_id = (select auth.uid())));

revoke all on public.menu_reviews from anon, authenticated;
grant select on public.menu_reviews to anon, authenticated;
grant update on public.menu_reviews to authenticated;
revoke all on public.delivery_zones from anon, authenticated;
grant select on public.delivery_zones to anon, authenticated;
grant insert, update, delete on public.delivery_zones to authenticated;

create or replace function public.place_order_with_options(
  p_customer_name text,
  p_customer_phone text,
  p_order_type text,
  p_delivery_address text,
  p_notes text,
  p_items jsonb,
  p_delivery_latitude double precision,
  p_delivery_longitude double precision,
  p_requested_for timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_result jsonb;
  v_order_id uuid;
  v_zone public.delivery_zones%rowtype;
  v_zone_found boolean := false;
  v_settings public.restaurant_settings%rowtype;
  v_fee numeric(10,2);
  v_prep integer;
  v_delivery_minutes integer;
  v_eta timestamptz;
  v_requested timestamptz := p_requested_for;
  v_item jsonb;
begin
  if v_user_id is null then
    raise exception 'Sign in before placing an order';
  end if;

  select * into v_settings from public.restaurant_settings where id = 1;
  if not found then raise exception 'Restaurant settings are unavailable'; end if;

  if v_requested is not null then
    if not v_settings.allow_scheduled_orders then
      raise exception 'Scheduled orders are not available right now';
    end if;
    if v_requested < now() + make_interval(mins => v_settings.schedule_min_notice_minutes)
       or v_requested > now() + make_interval(days => v_settings.schedule_max_days) then
      raise exception 'Choose a time within the available scheduling window';
    end if;
  end if;

  if p_order_type = 'delivery' then
    select z.* into v_zone
    from public.delivery_zones z
    where z.is_active
      and 6371 * acos(least(1, greatest(-1,
        sin(radians(p_delivery_latitude)) * sin(radians(z.center_latitude)) +
        cos(radians(p_delivery_latitude)) * cos(radians(z.center_latitude)) *
        cos(radians(z.center_longitude - p_delivery_longitude))
      ))) <= z.radius_km
    order by z.radius_km asc
    limit 1;
    v_zone_found := found;
    if not v_zone_found and exists (select 1 from public.delivery_zones where is_active) then
      raise exception 'This location is outside the active delivery zones';
    end if;
  end if;

  v_result := public.place_order_with_location(
    p_customer_name, p_customer_phone, p_order_type, p_delivery_address,
    p_notes, p_items, p_delivery_latitude, p_delivery_longitude
  );
  v_order_id := (v_result->>'id')::uuid;

  if p_order_type = 'delivery' and v_zone_found then
    v_fee := v_zone.delivery_fee;
  else
    v_fee := case when p_order_type = 'pickup' then 0 else coalesce(v_settings.delivery_fee, 0) end;
  end if;

  select max(m.prep_minutes) into v_prep
  from jsonb_array_elements(p_items) i
  join public.menu_items m on m.id = (i->>'product_id')::uuid;

  if v_requested is null then v_requested := now(); end if;
  v_delivery_minutes := case
    when p_order_type = 'pickup' then 0
    else coalesce(v_zone.estimated_delivery_minutes, v_settings.default_delivery_minutes)
  end;
  if coalesce(v_prep, v_settings.default_prep_minutes) is not null
     and v_delivery_minutes is not null then
    v_eta := v_requested + make_interval(mins =>
      coalesce(v_prep, v_settings.default_prep_minutes) + v_delivery_minutes
    );
  end if;

  update public.orders
  set customer_user_id = v_user_id,
      requested_for = p_requested_for,
      delivery_zone_id = case when v_zone_found then v_zone.id else null end,
      delivery_fee = v_fee,
      total = subtotal + v_fee,
      estimated_ready_at = v_eta
  where id = v_order_id;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    update public.order_items
    set item_note = nullif(left(trim(coalesce(v_item->>'item_note','')), 500), '')
    where order_id = v_order_id
      and menu_item_id = (v_item->>'product_id')::uuid;
  end loop;

  return v_result || jsonb_build_object(
    'delivery_fee', v_fee,
    'requested_for', p_requested_for,
    'estimated_ready_at', v_eta,
    'delivery_zone', case when v_zone_found then v_zone.name else null end
  );
end;
$$;

revoke all on function public.place_order_with_options(text,text,text,text,text,jsonb,double precision,double precision,timestamptz) from public, anon;
grant execute on function public.place_order_with_options(text,text,text,text,text,jsonb,double precision,double precision,timestamptz) to authenticated;

create or replace function public.submit_menu_review(
  p_order_id uuid,
  p_menu_item_id uuid,
  p_rating smallint,
  p_review_text text default null,
  p_photo_url text default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_review_id uuid;
begin
  if v_user_id is null then raise exception 'Sign in to review an order'; end if;
  if p_rating not between 1 and 5 then raise exception 'Rating must be from 1 to 5'; end if;
  if p_photo_url is not null and p_photo_url !~ '^https://' then
    raise exception 'Review photo must use HTTPS';
  end if;
  if not exists (
    select 1 from public.orders o
    join public.order_items oi on oi.order_id = o.id and oi.menu_item_id = p_menu_item_id
    where o.id = p_order_id and o.status = 'completed' and o.customer_user_id = v_user_id
  ) then
    raise exception 'Only a completed order you placed can be reviewed';
  end if;

  insert into public.menu_reviews(order_id, menu_item_id, customer_user_id, rating, review_text, photo_url)
  values (p_order_id, p_menu_item_id, v_user_id, p_rating, nullif(trim(p_review_text), ''), nullif(trim(p_photo_url), ''))
  returning id into v_review_id;
  return v_review_id;
end;
$$;

revoke all on function public.submit_menu_review(uuid,uuid,smallint,text,text) from public, anon;
grant execute on function public.submit_menu_review(uuid,uuid,smallint,text,text) to authenticated;

-- For customer photo uploads, create a private Storage bucket named
-- "al-shami-review-photos" in Supabase Storage. This migration stores HTTPS URLs
-- so text/photo reviews work before a bucket is configured.
