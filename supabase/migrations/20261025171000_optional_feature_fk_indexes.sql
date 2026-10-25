-- Supporting indexes for the optional customer/order feature foreign keys.
create index if not exists orders_customer_user_id_idx
  on public.orders(customer_user_id) where customer_user_id is not null;
create index if not exists orders_delivery_zone_id_idx
  on public.orders(delivery_zone_id) where delivery_zone_id is not null;
create index if not exists menu_reviews_customer_user_id_idx
  on public.menu_reviews(customer_user_id);
