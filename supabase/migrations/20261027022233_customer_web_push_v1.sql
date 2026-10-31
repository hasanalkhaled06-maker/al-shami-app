
create table if not exists public.customer_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  customer_user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh_key text not null,
  auth_key text not null,
  language text not null default 'en' check (language in ('en','ar','tw')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists customer_push_subscriptions_user_idx
  on public.customer_push_subscriptions (customer_user_id);

alter table public.customer_push_subscriptions enable row level security;
revoke all on table public.customer_push_subscriptions from public, anon, authenticated;
grant select, insert, update, delete on table public.customer_push_subscriptions to authenticated;
create policy "Customers manage own push subscriptions"
  on public.customer_push_subscriptions for all to authenticated
  using (customer_user_id = (select auth.uid()))
  with check (customer_user_id = (select auth.uid()));

create table if not exists public.customer_push_vapid_keys (
  id boolean primary key default true check (id is true),
  public_key text not null,
  private_key text not null,
  subject text not null default 'mailto:hasanalkhaled06@gmail.com',
  created_at timestamptz not null default now()
);

alter table public.customer_push_vapid_keys enable row level security;
revoke all on table public.customer_push_vapid_keys from public, anon, authenticated;
grant select, insert, update, delete on table public.customer_push_vapid_keys to service_role;
create policy "Only server manages push signing keys"
  on public.customer_push_vapid_keys for all to service_role
  using (true) with check (true);
