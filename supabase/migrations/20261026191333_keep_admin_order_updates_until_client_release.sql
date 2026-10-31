-- The currently published admin UI still uses a direct order UPDATE for its status picker. Preserve that RLS-limited capability until the new client is released. The transition trigger still rejects skips and early completion.
grant update on table public.orders to authenticated;
