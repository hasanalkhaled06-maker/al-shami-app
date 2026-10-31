alter table public.restaurant_settings add column if not exists stock_categories text[] not null default '{}'::text[];
comment on column public.restaurant_settings.stock_categories is 'User-managed stock category names displayed in Operations > Stock.';
