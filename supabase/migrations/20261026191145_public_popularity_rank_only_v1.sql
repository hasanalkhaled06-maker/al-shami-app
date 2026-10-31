-- The public menu only needs relative popularity for sorting. Do not expose exact item sales totals through a public SECURITY DEFINER RPC.
create or replace function public.get_public_menu_popularity()
returns table(menu_item_id uuid, order_count bigint)
language sql
stable
security definer
set search_path = ''
as $function$
  select ranked.menu_item_id,
         pg_catalog.dense_rank() over (order by ranked.item_quantity desc)::bigint as order_count
  from (
    select oi.menu_item_id,
           pg_catalog.sum(oi.quantity)::bigint as item_quantity
    from public.order_items as oi
    join public.orders as o on o.id = oi.order_id
    where oi.menu_item_id is not null
      and o.status <> 'rejected'
    group by oi.menu_item_id
  ) as ranked;
$function$;
comment on function public.get_public_menu_popularity() is 'Public relative popularity ranks for menu sorting; order_count contains a rank, not sales totals.';
