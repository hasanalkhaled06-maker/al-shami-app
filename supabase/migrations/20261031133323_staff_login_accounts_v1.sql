-- Track the service-only username mapping used by staff sign-in.
-- Password verification remains in Supabase Auth; this table stores no passwords.
create table if not exists public.staff_login_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint staff_login_accounts_username_format
    check (username = lower(username) and username ~ '^[a-z0-9][a-z0-9._-]{2,29}$')
);

create unique index if not exists staff_login_accounts_username_lower_uidx
  on public.staff_login_accounts (lower(username));

alter table public.staff_login_accounts enable row level security;
revoke all on table public.staff_login_accounts from public, anon, authenticated;
grant select, insert, update, delete on table public.staff_login_accounts to service_role;
