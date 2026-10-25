-- Cover foreign keys added by the rewards and delivery operations migrations.
create index if not exists customer_loyalty_ledger_order_id_idx
  on public.customer_loyalty_ledger(order_id);
create index if not exists customer_referrals_referrer_user_id_idx
  on public.customer_referrals(referrer_user_id);
create index if not exists delivery_rider_events_rider_user_id_idx
  on public.delivery_rider_events(rider_user_id);
