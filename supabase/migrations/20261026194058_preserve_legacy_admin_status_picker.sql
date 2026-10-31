begin;

-- Keep the published owner dashboard working until the updated frontend is released.
-- RLS still permits order updates only to admins; staff have no UPDATE policy.
-- The role-specific staff RPCs remain the only route for staff status changes.
grant update (status, updated_at) on table public.orders to authenticated;

commit;
