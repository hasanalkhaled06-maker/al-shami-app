-- Rider workflow view: only assigned active deliveries and the signed-in rider's own GPS timestamp.
create or replace function public.get_my_delivery_ops()
returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v_uid uuid:=auth.uid(); v_result jsonb;
begin
  if v_uid is null or not exists(select 1 from public.staff_profiles sp
    where sp.user_id=v_uid and sp.role='delivery_rider' and sp.is_active=true and sp.employment_status='active') then
    raise exception 'This account is not an active AL SHAMI delivery rider';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',o.id,'order_number',o.order_number,'status',o.status,
    'delivery_address',o.delivery_address,'delivery_latitude',o.delivery_latitude,
    'delivery_longitude',o.delivery_longitude,'created_at',o.created_at,
    'gps_updated_at',loc.updated_at,'arrived_at',ev.arrived_at,'left_at',ev.left_at
  ) order by o.created_at), '[]'::jsonb) into v_result
  from public.orders o left join public.delivery_rider_locations loc on loc.rider_user_id=v_uid
  left join lateral (
    select min(created_at) filter(where event_type='arrived_at_restaurant') arrived_at,
           min(created_at) filter(where event_type='left_restaurant') left_at
    from public.delivery_rider_events e where e.order_id=o.id and e.rider_user_id=v_uid
  ) ev on true
  where o.assigned_rider_user_id=v_uid and o.order_type='delivery'
    and o.status in ('accepted','preparing','ready','out_for_delivery');
  return v_result;
end $$;
revoke all on function public.get_my_delivery_ops() from public, anon;
grant execute on function public.get_my_delivery_ops() to authenticated;
