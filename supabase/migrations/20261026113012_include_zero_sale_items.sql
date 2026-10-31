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
  )
  select coalesce(m.name,t.n),coalesce(t.qty,0),coalesce(t.sales,0),coalesce(t.food_cost,0),coalesce(t.sales,0)-coalesce(t.food_cost,0)
  from public.menu_items m full join totals t on t.menu_item_id=m.id
  order by coalesce(t.qty,0) desc,coalesce(m.name,t.n);
end $$;
revoke all on function public.get_sales_item_performance(timestamptz,timestamptz) from public,anon;
grant execute on function public.get_sales_item_performance(timestamptz,timestamptz) to authenticated;
