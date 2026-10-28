-- Add a free-form stock category while preserving all existing stock balances and movement history.
alter table public.inventory_items
  add column if not exists category text not null default 'Other';

alter table public.inventory_items
  drop constraint if exists inventory_items_category_length_check;

alter table public.inventory_items
  add constraint inventory_items_category_length_check
  check (length(trim(category)) between 1 and 80);

create index if not exists inventory_items_category_name_idx
  on public.inventory_items (lower(category), name);

comment on column public.inventory_items.category is
  'User-defined stock grouping such as Drinks, Chicken, or Disposable.';
