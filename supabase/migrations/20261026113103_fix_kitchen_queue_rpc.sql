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
    ) order by i.id) from public.order_items i left join public.menu_items m on m.id=i.menu_item_id where i.order_id=o.id),'[]'::jsonb)
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
  update public.orders set status=p_status,status_reason=null,updated_at=now(),status_changed_at=now() where id=p_order_id;
end $$;
revoke all on function public.update_kitchen_order(uuid,text) from public,anon;
grant execute on function public.update_kitchen_order(uuid,text) to authenticated;

create or replace function public.decide_manager_approval(p_approval_id uuid,p_approve boolean)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare a public.manager_approvals%rowtype; v_price numeric; v_old_price numeric; v_role text;
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
    select price into v_old_price from public.menu_items where id=a.entity_id for update;
    if not found then raise exception 'Menu item no longer exists'; end if;
    if v_price<=0 or v_old_price is distinct from (a.old_value->>'price')::numeric then raise exception 'Menu price changed after this request; create a new request'; end if;
    update public.menu_items set price=v_price,updated_at=now() where id=a.entity_id;
  end if;
  update public.manager_approvals set state=case when p_approve then 'approved' else 'rejected' end,approved_by=auth.uid(),decided_at=now() where id=p_approval_id;
end $$;
revoke all on function public.decide_manager_approval(uuid,boolean) from public,anon;
grant execute on function public.decide_manager_approval(uuid,boolean) to authenticated;
