-- Index foreign-key columns flagged by Supabase's database advisor.
-- These additive B-tree indexes support joins and parent-row updates/deletes.
create index if not exists customer_service_reviews_customer_user_id_idx
  on public.customer_service_reviews (customer_user_id);

create index if not exists inventory_stocktake_lines_item_id_idx
  on public.inventory_stocktake_lines (item_id);

create index if not exists inventory_stocktakes_completed_by_idx
  on public.inventory_stocktakes (completed_by);

create index if not exists inventory_stocktakes_started_by_idx
  on public.inventory_stocktakes (started_by);

create index if not exists manager_approvals_approved_by_idx
  on public.manager_approvals (approved_by);

create index if not exists manager_approvals_requested_by_idx
  on public.manager_approvals (requested_by);

create index if not exists order_completion_authorizations_actor_user_id_idx
  on public.order_completion_authorizations (actor_user_id);

create index if not exists order_completion_authorizations_order_id_idx
  on public.order_completion_authorizations (order_id);

create index if not exists order_items_offer_id_idx
  on public.order_items (offer_id);

create index if not exists order_status_audit_actor_id_idx
  on public.order_status_audit (actor_id);
