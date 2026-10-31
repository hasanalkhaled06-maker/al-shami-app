begin;

create or replace function public.audit_order_status_change()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if new.status is distinct from old.status then
    new.status_changed_at:=now();
    insert into public.order_status_audit(order_id,actor_id,old_status,new_status,reason)
    values(new.id,auth.uid(),old.status,new.status,new.status_reason);
  end if;
  return new;
end $$;
revoke all on function public.audit_order_status_change() from public,anon,authenticated;
drop trigger if exists orders_status_audit_trigger on public.orders;
create trigger orders_status_audit_trigger before update of status on public.orders
for each row execute function public.audit_order_status_change();

create or replace function public.request_manager_approval(
  p_action_type text,p_entity_id uuid,p_reason text,p_old_value jsonb default '{}'::jsonb,p_new_value jsonb default '{}'::jsonb
) returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_id uuid;
begin
  if auth.uid() is null or not public.is_current_user_admin() then raise exception 'Authorised staff access required'; end if;
  if p_action_type not in ('cancel_accepted_order','change_menu_price') then raise exception 'Unsupported approval action'; end if;
  if length(trim(coalesce(p_reason,'')))<3 then raise exception 'A reason is required'; end if;
  if p_action_type='cancel_accepted_order' and not exists(select 1 from public.orders where id=p_entity_id and status='accepted') then raise exception 'Only accepted orders can be queued for cancellation'; end if;
  if p_action_type='change_menu_price' and not exists(select 1 from public.menu_items where id=p_entity_id) then raise exception 'Menu item not found'; end if;
  insert into public.manager_approvals(action_type,entity_id,requested_by,reason,old_value,new_value)
  values(p_action_type,p_entity_id,auth.uid(),left(trim(p_reason),500),coalesce(p_old_value,'{}'::jsonb),coalesce(p_new_value,'{}'::jsonb)) returning id into v_id;
  return v_id;
end $$;
revoke all on function public.request_manager_approval(text,uuid,text,jsonb,jsonb) from public,anon;
grant execute on function public.request_manager_approval(text,uuid,text,jsonb,jsonb) to authenticated;

create or replace function public.get_manager_approvals()
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v jsonb;
begin
  if auth.uid() is null or not public.is_current_user_admin() then raise exception 'Manager access required'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'action_type',a.action_type,'entity_id',a.entity_id,
    'requested_by',a.requested_by,'reason',a.reason,'old_value',a.old_value,'new_value',a.new_value,'created_at',a.created_at)
    order by a.created_at),'[]'::jsonb) into v from public.manager_approvals a where a.state='pending';
  return v;
end $$;
revoke all on function public.get_manager_approvals() from public,anon;
grant execute on function public.get_manager_approvals() to authenticated;

create or replace function public.decide_manager_approval(p_approval_id uuid,p_approve boolean)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare a public.manager_approvals%rowtype; v_price numeric;
begin
  if auth.uid() is null or not public.is_current_user_admin() then raise exception 'Manager access required'; end if;
  select * into a from public.manager_approvals where id=p_approval_id and state='pending' for update;
  if not found then raise exception 'Approval is no longer pending'; end if;
  if a.requested_by=auth.uid() then raise exception 'A different manager must decide this request'; end if;
  if p_approve and a.action_type='cancel_accepted_order' then
    update public.orders set status='rejected',status_reason=a.reason,updated_at=now() where id=a.entity_id and status='accepted';
    if not found then raise exception 'Order is no longer accepted'; end if;
  elsif p_approve and a.action_type='change_menu_price' then
    v_price:=(a.new_value->>'price')::numeric;
    if v_price<=0 then raise exception 'Invalid requested price'; end if;
    update public.menu_items set price=v_price,updated_at=now() where id=a.entity_id;
    if not found then raise exception 'Menu item no longer exists'; end if;
  end if;
  update public.manager_approvals set state=case when p_approve then 'approved' else 'rejected' end,
    approved_by=auth.uid(),decided_at=now() where id=p_approval_id;
end $$;
revoke all on function public.decide_manager_approval(uuid,boolean) from public,anon;
grant execute on function public.decide_manager_approval(uuid,boolean) to authenticated;

create or replace function public.get_sales_item_performance(p_from timestamptz,p_to timestamptz)
returns table(item_name text,units_sold bigint,gross_sales numeric,estimated_food_cost numeric,estimated_food_profit numeric)
language plpgsql stable security definer set search_path=pg_catalog,public as $$
begin
  if auth.uid() is null or not public.is_current_user_admin() then raise exception 'Admin access required'; end if;
  if p_from is null or p_to is null or p_to<=p_from or p_to-p_from>interval '366 days' then raise exception 'Choose a valid date range (up to 366 days)'; end if;
  return query
  with totals as (
    select oi.menu_item_id,coalesce(oi.item_name,m.name,'Deleted item') n,sum(oi.quantity)::bigint qty,
      sum(oi.line_total)::numeric sales,sum(oi.quantity*coalesce(rc.cost,0))::numeric food_cost
    from public.order_items oi join public.orders o on o.id=oi.order_id
    left join public.menu_items m on m.id=oi.menu_item_id
    left join lateral (select sum(r.quantity_per_item*i.unit_cost) cost from public.menu_item_recipes r join public.inventory_items i on i.id=r.inventory_item_id where r.menu_item_id=oi.menu_item_id) rc on true
    where o.status='completed' and o.completed_at>=p_from and o.completed_at<p_to
    group by oi.menu_item_id,coalesce(oi.item_name,m.name,'Deleted item')
  ) select n,qty,sales,food_cost,sales-food_cost from totals order by qty desc;
end $$;
revoke all on function public.get_sales_item_performance(timestamptz,timestamptz) from public,anon;
grant execute on function public.get_sales_item_performance(timestamptz,timestamptz) to authenticated;
commit;
