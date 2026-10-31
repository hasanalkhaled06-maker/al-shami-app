-- Enforce order ownership and valid order progression in the database.
-- Existing orders are left untouched; all changes below affect future writes.

create table if not exists public.order_completion_authorizations (
  transaction_id bigint not null,
  order_id uuid not null references public.orders(id) on delete cascade,
  actor_user_id uuid not null references auth.users(id) on delete cascade,
  primary key (transaction_id, order_id)
);

alter table public.order_completion_authorizations enable row level security;
revoke all on table public.order_completion_authorizations from public, anon, authenticated, service_role;

create or replace function public.al_shami_order_transition_allowed(
  p_order_type text,
  p_from_status text,
  p_to_status text,
  p_receipt_authorized boolean
)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $function$
  select case
    when p_from_status = p_to_status then true
    when p_to_status = 'completed' then coalesce(p_receipt_authorized, false)
      and ((p_order_type = 'pickup' and p_from_status = 'ready')
        or (p_order_type = 'delivery' and p_from_status = 'out_for_delivery'))
    when p_from_status = 'new' then p_to_status in ('accepted', 'rejected')
    when p_from_status = 'accepted' then p_to_status = 'preparing'
    when p_from_status = 'preparing' then p_to_status = 'ready'
    when p_from_status = 'ready' then p_order_type = 'delivery' and p_to_status = 'out_for_delivery'
    else false
  end;
$function$;
revoke all on function public.al_shami_order_transition_allowed(text, text, text, boolean)
  from public, anon, authenticated, service_role;

create or replace function public.enforce_al_shami_order_status_transition()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_receipt_authorized boolean := false;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  if new.status = 'completed' then
    delete from public.order_completion_authorizations a
    where a.transaction_id = txid_current()
      and a.order_id = old.id
      and a.actor_user_id = auth.uid();
    v_receipt_authorized := found;
  end if;

  if not public.al_shami_order_transition_allowed(
    old.order_type, old.status, new.status, v_receipt_authorized
  ) then
    raise exception 'Invalid order status transition: % to %', old.status, new.status
      using errcode = 'check_violation';
  end if;

  return new;
end;
$function$;
revoke all on function public.enforce_al_shami_order_status_transition() from public, anon, authenticated, service_role;

drop trigger if exists orders_status_transition_guard on public.orders;
create trigger orders_status_transition_guard
before update of status on public.orders
for each row execute function public.enforce_al_shami_order_status_transition();

create or replace function public.bind_order_to_authenticated_customer()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is not null then
    if new.customer_user_id is not null and new.customer_user_id <> v_user_id then
      raise exception 'An order must belong to the signed-in customer';
    end if;
    new.customer_user_id := v_user_id;
  end if;
  return new;
end;
$function$;
revoke all on function public.bind_order_to_authenticated_customer() from public, anon, authenticated, service_role;

drop trigger if exists orders_bind_authenticated_customer on public.orders;
create trigger orders_bind_authenticated_customer
before insert on public.orders
for each row execute function public.bind_order_to_authenticated_customer();

create or replace function public.admin_transition_order_status(
  p_order_id uuid,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_order public.orders%rowtype;
begin
  if auth.uid() is null or not public.is_current_user_admin() then
    raise exception 'Active administrator access required';
  end if;

  select * into v_order
  from public.orders
  where id = p_order_id
  for update;
  if not found then raise exception 'Order not found'; end if;

  if not public.al_shami_order_transition_allowed(
    v_order.order_type, v_order.status, p_status, false
  ) then
    raise exception 'This order cannot move from % to %', v_order.status, p_status
      using errcode = 'check_violation';
  end if;

  update public.orders
  set status = p_status, status_reason = null, updated_at = now()
  where id = p_order_id;
end;
$function$;
revoke all on function public.admin_transition_order_status(uuid, text) from public, anon;
grant execute on function public.admin_transition_order_status(uuid, text) to authenticated;

create or replace function public.confirm_customer_receipt(
  p_order_number bigint,
  p_receipt_code text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_order public.orders%rowtype;
begin
  if auth.uid() is null or not public.is_current_user_admin() then
    raise exception 'Not authorized';
  end if;

  select * into v_order
  from public.orders
  where order_number = p_order_number
    and receipt_code = trim(p_receipt_code)
  for update;

  if not found then raise exception 'Incorrect order number or receipt code'; end if;
  if v_order.status = 'completed' then raise exception 'Order already completed'; end if;
  if v_order.status = 'rejected' then raise exception 'Rejected orders cannot be completed'; end if;
  if not ((v_order.order_type = 'pickup' and v_order.status = 'ready')
       or (v_order.order_type = 'delivery' and v_order.status = 'out_for_delivery')) then
    raise exception 'Confirm receipt only after the order is ready for handoff';
  end if;

  insert into public.order_completion_authorizations(transaction_id, order_id, actor_user_id)
  values (txid_current(), v_order.id, auth.uid());

  update public.orders
  set status = 'completed', completed_at = now(), updated_at = now()
  where id = v_order.id;

  return jsonb_build_object('order_number', p_order_number, 'status', 'completed');
end;
$function$;
revoke all on function public.confirm_customer_receipt(bigint, text) from public, anon;
grant execute on function public.confirm_customer_receipt(bigint, text) to authenticated;

-- Clients only need to read order records directly for the staff dashboard.
-- Customer order creation, status changes, and deletion all use guarded RPCs.
revoke all on table public.orders, public.order_items from public, anon;
revoke insert, update, delete, truncate, references, trigger
  on table public.orders, public.order_items from authenticated;
grant select on table public.orders, public.order_items to authenticated;
