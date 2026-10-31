begin;
create or replace function public.get_my_staff_role()
returns text language sql stable security definer set search_path=pg_catalog,public as $$
  select role from public.staff_profiles where user_id=auth.uid() and is_active and employment_status='active' limit 1
$$;
revoke all on function public.get_my_staff_role() from public,anon;
grant execute on function public.get_my_staff_role() to authenticated;
create or replace function public.get_cashier_queue()
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v jsonb;
begin
  if auth.uid() is null or public.get_my_staff_role() not in ('cashier','manager','owner') then raise exception 'Active cashier access required'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'order_number',o.order_number,'created_at',o.created_at,'customer_name',o.customer_name,'order_type',o.order_type,'delivery_address',o.delivery_address,'total',o.total,'status',o.status,'notes',o.notes,'items',coalesce((select jsonb_agg(jsonb_build_object('name',coalesce(i.item_name,m.name),'quantity',i.quantity,'price',i.line_total)) from public.order_items i left join public.menu_items m on m.id=i.menu_item_id where i.order_id=o.id),'[]'::jsonb)) order by o.created_at),'[]'::jsonb) into v from public.orders o where o.status in ('new','accepted','preparing','ready','out_for_delivery');
  return v;
end $$;
revoke all on function public.get_cashier_queue() from public,anon;
grant execute on function public.get_cashier_queue() to authenticated;
create or replace function public.cashier_set_order_status(p_order_id uuid,p_status text,p_reason text default null)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if auth.uid() is null or public.get_my_staff_role() not in ('cashier','manager','owner') then raise exception 'Active cashier access required'; end if;
  if p_status not in ('accepted','rejected') or length(trim(coalesce(p_reason,'')))<3 then raise exception 'Valid decision and reason required'; end if;
  perform 1 from public.orders where id=p_order_id and status='new' for update;
  if not found then raise exception 'Only new orders can be decided'; end if;
  update public.orders set status=p_status,status_reason=left(trim(p_reason),500),updated_at=now() where id=p_order_id;
end $$;
revoke all on function public.cashier_set_order_status(uuid,text,text) from public,anon;
grant execute on function public.cashier_set_order_status(uuid,text,text) to authenticated;
create or replace function public.request_manager_approval(p_action_type text,p_entity_id uuid,p_reason text,p_old_value jsonb default '{}'::jsonb,p_new_value jsonb default '{}'::jsonb)
returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_id uuid; v_role text;
begin
  v_role:=public.get_my_staff_role();
  if auth.uid() is null or (not public.is_current_user_admin() and v_role not in ('cashier','manager','owner')) then raise exception 'Authorised staff access required'; end if;
  if p_action_type not in ('cancel_accepted_order','change_menu_price') or length(trim(coalesce(p_reason,'')))<3 then raise exception 'Valid action and reason required'; end if;
  if p_action_type='cancel_accepted_order' and not exists(select 1 from public.orders where id=p_entity_id and status='accepted') then raise exception 'Only accepted orders can be queued for cancellation'; end if;
  if p_action_type='change_menu_price' and not exists(select 1 from public.menu_items where id=p_entity_id) then raise exception 'Menu item not found'; end if;
  insert into public.manager_approvals(action_type,entity_id,requested_by,reason,old_value,new_value) values(p_action_type,p_entity_id,auth.uid(),left(trim(p_reason),500),coalesce(p_old_value,'{}'::jsonb),coalesce(p_new_value,'{}'::jsonb)) returning id into v_id;
  return v_id;
end $$;
revoke all on function public.request_manager_approval(text,uuid,text,jsonb,jsonb) from public,anon;
grant execute on function public.request_manager_approval(text,uuid,text,jsonb,jsonb) to authenticated;
create or replace function public.decide_manager_approval(p_approval_id uuid,p_approve boolean)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare a public.manager_approvals%rowtype; v_price numeric; v_role text;
begin
  v_role:=public.get_my_staff_role();
  if auth.uid() is null or (not public.is_current_user_admin() and v_role not in ('manager','owner')) then raise exception 'Manager access required'; end if;
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
  update public.manager_approvals set state=case when p_approve then 'approved' else 'rejected' end,approved_by=auth.uid(),decided_at=now() where id=p_approval_id;
end $$;
revoke all on function public.decide_manager_approval(uuid,boolean) from public,anon;
grant execute on function public.decide_manager_approval(uuid,boolean) to authenticated;
create or replace function public.get_manager_approvals()
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v jsonb; v_role text;
begin
  v_role:=public.get_my_staff_role();
  if auth.uid() is null or (not public.is_current_user_admin() and v_role not in ('manager','owner')) then raise exception 'Manager access required'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'action_type',a.action_type,'entity_id',a.entity_id,'requested_by',a.requested_by,'reason',a.reason,'old_value',a.old_value,'new_value',a.new_value,'created_at',a.created_at) order by a.created_at),'[]'::jsonb) into v from public.manager_approvals a where a.state='pending';
  return v;
end $$;
revoke all on function public.get_manager_approvals() from public,anon;
grant execute on function public.get_manager_approvals() to authenticated;
commit;
