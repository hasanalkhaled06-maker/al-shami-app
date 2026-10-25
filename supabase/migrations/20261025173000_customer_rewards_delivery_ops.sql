-- AL SHAMI customer rewards, notification preferences, and delivery operations.
-- Additive migration. Apply after review; no existing customer/order rows are rewritten.
begin;

alter table public.orders
  add column if not exists loyalty_discount numeric(10,2) not null default 0
    check (loyalty_discount >= 0);

create table if not exists public.customer_loyalty_settings (
  id integer primary key default 1 check (id = 1),
  enabled boolean not null default false,
  stamps_per_reward integer not null default 10 check (stamps_per_reward between 2 and 100),
  points_per_ghs integer not null default 1 check (points_per_ghs between 0 and 100),
  points_per_ghs_redeemed integer not null default 100 check (points_per_ghs_redeemed between 1 and 10000),
  stamp_reward_ghs numeric(10,2) not null default 0 check (stamp_reward_ghs between 0 and 500),
  referral_bonus_points integer not null default 100 check (referral_bonus_points between 0 and 100000),
  updated_at timestamptz not null default now()
);
insert into public.customer_loyalty_settings(id) values (1) on conflict do nothing;

create table if not exists public.customer_loyalty_ledger (
  id uuid primary key default gen_random_uuid(),
  customer_user_id uuid not null references auth.users(id) on delete cascade,
  order_id uuid references public.orders(id) on delete set null,
  entry_type text not null check (entry_type in ('points','stamp')),
  amount integer not null check (amount <> 0),
  reason text not null check (length(reason) <= 120),
  created_at timestamptz not null default now()
);
create unique index if not exists customer_loyalty_ledger_order_type_uq
  on public.customer_loyalty_ledger(customer_user_id, order_id, entry_type, reason)
  where order_id is not null;
create index if not exists customer_loyalty_ledger_customer_created_idx
  on public.customer_loyalty_ledger(customer_user_id, created_at desc);

create table if not exists public.customer_referral_codes (
  customer_user_id uuid primary key references auth.users(id) on delete cascade,
  code text not null unique check (code ~ '^[A-Z0-9]{8}$'),
  created_at timestamptz not null default now()
);
create table if not exists public.customer_referrals (
  referred_user_id uuid primary key references auth.users(id) on delete cascade,
  referrer_user_id uuid not null references auth.users(id) on delete cascade,
  referral_code text not null,
  created_at timestamptz not null default now(),
  check (referred_user_id <> referrer_user_id)
);

create table if not exists public.customer_notification_preferences (
  customer_user_id uuid primary key references auth.users(id) on delete cascade,
  order_updates boolean not null default true,
  rider_tracking boolean not null default true,
  promotions boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.customer_loyalty_settings enable row level security;
alter table public.customer_loyalty_ledger enable row level security;
alter table public.customer_referral_codes enable row level security;
alter table public.customer_referrals enable row level security;
alter table public.customer_notification_preferences enable row level security;
grant select on public.customer_loyalty_settings to authenticated;
drop policy if exists "Admins read customer loyalty settings" on public.customer_loyalty_settings;
create policy "Admins read customer loyalty settings" on public.customer_loyalty_settings
  for select to authenticated
  using (exists (select 1 from public.admin_users a where a.user_id=(select auth.uid())));
revoke all on public.customer_loyalty_settings, public.customer_loyalty_ledger,
  public.customer_referral_codes, public.customer_referrals,
  public.customer_notification_preferences from public, anon, authenticated;
grant select, insert, update on public.customer_notification_preferences to authenticated;
drop policy if exists "Customers manage own notification preferences" on public.customer_notification_preferences;
create policy "Customers manage own notification preferences"
  on public.customer_notification_preferences for all to authenticated
  using (customer_user_id = (select auth.uid()))
  with check (customer_user_id = (select auth.uid()));

create table if not exists public.delivery_rider_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  rider_user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null check (event_type in ('arrived_at_restaurant','left_restaurant','failed_attempt')),
  failure_reason text check (failure_reason in ('customer_no_answer','cannot_reach_address','customer_unavailable','unsafe_location','other')),
  note text check (note is null or length(note) <= 300),
  created_at timestamptz not null default now(),
  check ((event_type = 'failed_attempt' and failure_reason is not null) or
         (event_type <> 'failed_attempt' and failure_reason is null))
);
create unique index if not exists delivery_rider_events_once_uq
  on public.delivery_rider_events(order_id, rider_user_id, event_type)
  where event_type in ('arrived_at_restaurant','left_restaurant');
create index if not exists delivery_rider_events_order_time_idx
  on public.delivery_rider_events(order_id, created_at);
alter table public.delivery_rider_events enable row level security;
revoke all on public.delivery_rider_events from public, anon, authenticated;

create or replace function public.record_my_delivery_event(
  p_order_id uuid, p_event_type text, p_failure_reason text default null, p_note text default null
) returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_uid uuid := auth.uid(); v_id uuid;
begin
  if v_uid is null or not exists (
    select 1 from public.staff_profiles sp where sp.user_id=v_uid and sp.role='delivery_rider'
      and sp.is_active=true and sp.employment_status='active'
  ) then raise exception 'Active delivery rider access required'; end if;
  if p_event_type not in ('arrived_at_restaurant','left_restaurant','failed_attempt') then
    raise exception 'Unsupported delivery event';
  end if;
  if not exists (select 1 from public.orders o where o.id=p_order_id
      and o.assigned_rider_user_id=v_uid and o.order_type='delivery'
      and o.status in ('accepted','preparing','ready','out_for_delivery')) then
    raise exception 'This active delivery is not assigned to you';
  end if;
  if p_event_type='failed_attempt' and p_failure_reason not in
    ('customer_no_answer','cannot_reach_address','customer_unavailable','unsafe_location','other') then
    raise exception 'Choose a valid failed-delivery reason';
  end if;
  insert into public.delivery_rider_events(order_id,rider_user_id,event_type,failure_reason,note)
  values (p_order_id,v_uid,p_event_type,p_failure_reason,nullif(left(trim(coalesce(p_note,'')),300),''))
  returning id into v_id;
  return jsonb_build_object('ok',true,'event_id',v_id,'created_at',now());
end $$;
revoke all on function public.record_my_delivery_event(uuid,text,text,text) from public, anon;
grant execute on function public.record_my_delivery_event(uuid,text,text,text) to authenticated;

create or replace function public.get_delivery_admin_ops()
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $
declare v jsonb;
begin
  if auth.uid() is null or not exists(select 1 from public.admin_users a where a.user_id=auth.uid()) then
    raise exception 'Admin access required';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'order_id',o.id,'order_number',o.order_number,'status',o.status,
    'customer_name',o.customer_name,'address',o.delivery_address,
    'zone',z.name,'started_at',o.rider_tracking_started_at,
    'gps_updated_at',loc.updated_at,'gps_stale',loc.updated_at is null or loc.updated_at < now()-interval '45 seconds',
    'arrived_at',ev.arrived_at,'left_at',ev.left_at,
    'last_failed_at',ev.last_failed_at,'last_failure_reason',ev.last_failure_reason
  ) order by o.created_at), '[]'::jsonb) into v
  from public.orders o
  left join public.delivery_zones z on z.id=o.delivery_zone_id
  left join public.delivery_rider_locations loc on loc.rider_user_id=o.assigned_rider_user_id
  left join lateral (
    select min(created_at) filter(where event_type='arrived_at_restaurant') arrived_at,
           min(created_at) filter(where event_type='left_restaurant') left_at,
           max(created_at) filter(where event_type='failed_attempt') last_failed_at,
           (array_agg(failure_reason order by created_at desc) filter(where event_type='failed_attempt'))[1] last_failure_reason
    from public.delivery_rider_events e where e.order_id=o.id
  ) ev on true
  where o.order_type='delivery' and o.status='out_for_delivery';
  return v;
end $$;
revoke all on function public.get_delivery_admin_ops() from public, anon;
grant execute on function public.get_delivery_admin_ops() to authenticated;

create or replace function public.get_delivery_duration_report(p_from timestamptz, p_to timestamptz)
returns table(zone_name text, completed_deliveries bigint, avg_minutes numeric, fastest_minutes numeric, slowest_minutes numeric)
language plpgsql stable security definer set search_path = pg_catalog, public as $$
begin
  if auth.uid() is null or not exists(select 1 from public.admin_users a where a.user_id=auth.uid()) then
    raise exception 'Admin access required';
  end if;
  if p_from is null or p_to is null or p_to <= p_from or p_to-p_from > interval '366 days' then
    raise exception 'Choose a valid report range up to 366 days';
  end if;
  return query
  select coalesce(z.name,'Other / no zone'),count(*)::bigint,
    round(avg(extract(epoch from (o.completed_at-o.rider_tracking_started_at))/60)::numeric,1),
    round(min(extract(epoch from (o.completed_at-o.rider_tracking_started_at))/60)::numeric,1),
    round(max(extract(epoch from (o.completed_at-o.rider_tracking_started_at))/60)::numeric,1)
  from public.orders o left join public.delivery_zones z on z.id=o.delivery_zone_id
  where o.order_type='delivery' and o.status='completed'
    and o.completed_at between p_from and p_to and o.rider_tracking_started_at is not null
  group by coalesce(z.name,'Other / no zone') order by 1;
end $$;
revoke all on function public.get_delivery_duration_report(timestamptz,timestamptz) from public, anon;
grant execute on function public.get_delivery_duration_report(timestamptz,timestamptz) to authenticated;

create or replace function public.ensure_my_referral_code()
returns text language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_uid uuid:=auth.uid(); v_code text;
begin
  if v_uid is null then raise exception 'Sign in required'; end if;
  select code into v_code from public.customer_referral_codes where customer_user_id=v_uid;
  if v_code is null then
    v_code:=upper(substr(encode(gen_random_bytes(8),'hex'),1,8));
    insert into public.customer_referral_codes(customer_user_id,code) values(v_uid,v_code)
    on conflict(customer_user_id) do update set code=excluded.code returning code into v_code;
  end if;
  return v_code;
end $$;
revoke all on function public.ensure_my_referral_code() from public, anon;
grant execute on function public.ensure_my_referral_code() to authenticated;

create or replace function public.apply_my_referral_code(p_code text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_uid uuid:=auth.uid(); v_referrer uuid;
begin
  if v_uid is null then raise exception 'Sign in required'; end if;
  if exists(select 1 from public.orders where customer_user_id=v_uid) then
    raise exception 'Referral codes must be applied before your first order';
  end if;
  select customer_user_id into v_referrer from public.customer_referral_codes
    where code=upper(trim(coalesce(p_code,'')));
  if v_referrer is null or v_referrer=v_uid then raise exception 'Referral code is invalid'; end if;
  insert into public.customer_referrals(referred_user_id,referrer_user_id,referral_code)
  values(v_uid,v_referrer,upper(trim(p_code))) on conflict(referred_user_id) do nothing;
  if not found then raise exception 'A referral code was already applied to this account'; end if;
  return jsonb_build_object('ok',true);
end $$;
revoke all on function public.apply_my_referral_code(text) from public, anon;
grant execute on function public.apply_my_referral_code(text) to authenticated;

create or replace function public.get_my_loyalty_summary()
returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v_uid uuid:=auth.uid(); v_points bigint; v_stamps bigint; v_set public.customer_loyalty_settings%rowtype; v_code text;
begin
  if v_uid is null then raise exception 'Sign in required'; end if;
  select * into v_set from public.customer_loyalty_settings where id=1;
  select coalesce(sum(amount),0) into v_points from public.customer_loyalty_ledger
    where customer_user_id=v_uid and entry_type='points';
  select coalesce(sum(amount),0) into v_stamps from public.customer_loyalty_ledger
    where customer_user_id=v_uid and entry_type='stamp';
  v_code:=public.ensure_my_referral_code();
  return jsonb_build_object('enabled',v_set.enabled,'points',v_points,'stamps',v_stamps,
    'stamps_per_reward',v_set.stamps_per_reward,'points_per_ghs',v_set.points_per_ghs,
    'points_per_ghs_redeemed',v_set.points_per_ghs_redeemed,
    'stamp_reward_ghs',v_set.stamp_reward_ghs,
    'referral_bonus_points',v_set.referral_bonus_points,'referral_code',v_code);
end $$;
revoke all on function public.get_my_loyalty_summary() from public, anon;
grant execute on function public.get_my_loyalty_summary() to authenticated;

create or replace function public.admin_update_loyalty_settings(
  p_enabled boolean, p_stamps_per_reward integer, p_points_per_ghs integer,
  p_points_per_ghs_redeemed integer, p_referral_bonus_points integer, p_stamp_reward_ghs numeric
) returns void language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if auth.uid() is null or not exists(select 1 from public.admin_users where user_id=auth.uid()) then
    raise exception 'Admin access required';
  end if;
  update public.customer_loyalty_settings set enabled=p_enabled, stamps_per_reward=p_stamps_per_reward,
    points_per_ghs=p_points_per_ghs, points_per_ghs_redeemed=p_points_per_ghs_redeemed,
    referral_bonus_points=p_referral_bonus_points, stamp_reward_ghs=p_stamp_reward_ghs, updated_at=now() where id=1;
end $$;
revoke all on function public.admin_update_loyalty_settings(boolean,integer,integer,integer,integer,numeric) from public, anon;
grant execute on function public.admin_update_loyalty_settings(boolean,integer,integer,integer,integer) to authenticated;

create or replace function public.al_shami_award_customer_loyalty()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_cfg public.customer_loyalty_settings%rowtype; v_points integer;
begin
  if new.status='completed' and (tg_op='INSERT' or old.status is distinct from new.status)
     and new.customer_user_id is not null then
    select * into v_cfg from public.customer_loyalty_settings where id=1;
    if coalesce(v_cfg.enabled,false) then
      v_points:=floor(greatest(0,new.subtotal)*v_cfg.points_per_ghs)::integer;
      if v_points>0 then
        insert into public.customer_loyalty_ledger(customer_user_id,order_id,entry_type,amount,reason)
        values(new.customer_user_id,new.id,'points',v_points,'completed_order')
        on conflict do nothing;
      end if;
      insert into public.customer_loyalty_ledger(customer_user_id,order_id,entry_type,amount,reason)
      values(new.customer_user_id,new.id,'stamp',1,'completed_order')
      on conflict do nothing;
      if v_cfg.referral_bonus_points>0 then
        insert into public.customer_loyalty_ledger(customer_user_id,order_id,entry_type,amount,reason)
        select r.referrer_user_id,new.id,'points',v_cfg.referral_bonus_points,'referral_completed_order'
        from public.customer_referrals r where r.referred_user_id=new.customer_user_id
          and not exists(select 1 from public.customer_loyalty_ledger l
            where l.customer_user_id=r.referrer_user_id and l.order_id=new.id and l.reason='referral_completed_order')
        on conflict do nothing;
      end if;
    end if;
  end if;
  return new;
end $$;
revoke all on function public.al_shami_award_customer_loyalty() from public, anon, authenticated;
drop trigger if exists al_shami_award_customer_loyalty on public.orders;
create trigger al_shami_award_customer_loyalty after insert or update of status on public.orders
for each row execute function public.al_shami_award_customer_loyalty();

create or replace function public.place_order_with_rewards(
  p_customer_name text, p_customer_phone text, p_order_type text, p_delivery_address text,
  p_notes text, p_items jsonb, p_delivery_latitude double precision, p_delivery_longitude double precision,
  p_requested_for timestamptz default null, p_points_to_redeem integer default 0,
  p_redeem_stamp_reward boolean default false, p_referral_code text default null
) returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_uid uuid:=auth.uid(); v_result jsonb; v_id uuid; v_subtotal numeric; v_balance bigint;
  v_cfg public.customer_loyalty_settings%rowtype; v_use integer:=0; v_discount numeric:=0; v_stamp_discount numeric:=0; v_referrer uuid;
begin
  if v_uid is null then raise exception 'Sign in required'; end if;
  if coalesce(p_points_to_redeem,0)<0 then raise exception 'Points to redeem cannot be negative'; end if;
  select * into v_cfg from public.customer_loyalty_settings where id=1;
  if coalesce(p_referral_code,'')<>'' then
    if exists(select 1 from public.orders where customer_user_id=v_uid) then
      raise exception 'Referral codes must be applied before your first order';
    end if;
    select customer_user_id into v_referrer from public.customer_referral_codes
      where code=upper(trim(p_referral_code)) and customer_user_id<>v_uid;
    if v_referrer is null then raise exception 'Referral code is invalid'; end if;
    insert into public.customer_referrals(referred_user_id,referrer_user_id,referral_code)
    values(v_uid,v_referrer,upper(trim(p_referral_code))) on conflict do nothing;
    if not found then raise exception 'A referral code was already applied'; end if;
  end if;
  v_result:=public.place_order_with_options(p_customer_name,p_customer_phone,p_order_type,
    p_delivery_address,p_notes,p_items,p_delivery_latitude,p_delivery_longitude,p_requested_for);
  v_id:=(v_result->>'id')::uuid;
  if coalesce(p_points_to_redeem,0)>0 then
    if not coalesce(v_cfg.enabled,false) then raise exception 'Loyalty rewards are not enabled'; end if;
    select coalesce(sum(amount),0) into v_balance from public.customer_loyalty_ledger
      where customer_user_id=v_uid and entry_type='points';
    select subtotal into v_subtotal from public.orders where id=v_id and customer_user_id=v_uid;
    v_use:=least(p_points_to_redeem,v_balance::integer,
      floor(v_subtotal*v_cfg.points_per_ghs_redeemed)::integer);
    if v_use<=0 then raise exception 'No redeemable points available'; end if;
    v_discount:=round(v_use::numeric/v_cfg.points_per_ghs_redeemed,2);
    insert into public.customer_loyalty_ledger(customer_user_id,order_id,entry_type,amount,reason)
      values(v_uid,v_id,'points',-v_use,'order_redemption');
    update public.orders set loyalty_discount=v_discount,total=greatest(0,total-v_discount) where id=v_id;
  end if;
  if coalesce(p_redeem_stamp_reward,false) then
    if not coalesce(v_cfg.enabled,false) then raise exception 'Loyalty rewards are not enabled'; end if;
    select coalesce(sum(amount),0) into v_balance from public.customer_loyalty_ledger
      where customer_user_id=v_uid and entry_type='stamp';
    if v_balance < v_cfg.stamps_per_reward or v_cfg.stamp_reward_ghs <= 0 then
      raise exception 'No stamp reward is available yet';
    end if;
    select subtotal into v_subtotal from public.orders where id=v_id and customer_user_id=v_uid;
    v_stamp_discount:=least(v_subtotal,v_cfg.stamp_reward_ghs);
    insert into public.customer_loyalty_ledger(customer_user_id,order_id,entry_type,amount,reason)
      values(v_uid,v_id,'stamp',-v_cfg.stamps_per_reward,'stamp_reward_redemption');
    update public.orders set loyalty_discount=loyalty_discount+v_stamp_discount,
      total=greatest(0,total-v_stamp_discount) where id=v_id;
  end if;
  return v_result||jsonb_build_object('loyalty_discount',v_discount+v_stamp_discount,
    'points_redeemed',v_use,'stamps_redeemed',case when p_redeem_stamp_reward then v_cfg.stamps_per_reward else 0 end);
end $$;
revoke all on function public.place_order_with_rewards(text,text,text,text,text,jsonb,double precision,double precision,timestamptz,integer,boolean,text) from public, anon;
grant execute on function public.place_order_with_rewards(text,text,text,text,text,jsonb,double precision,double precision,timestamptz,integer,text) to authenticated;

-- The admin aggregates delivery operation info without exposing rider GPS coordinates.
commit;
