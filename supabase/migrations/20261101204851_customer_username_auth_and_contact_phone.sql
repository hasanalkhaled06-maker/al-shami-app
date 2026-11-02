-- Customer usernames are aliases for Supabase Auth users; passwords remain in Auth.
create table if not exists public.customer_login_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  created_at timestamptz not null default now(),
  constraint customer_login_accounts_username_format
    check (username = lower(username) and username ~ '^[a-z0-9][a-z0-9._-]{2,29}$')
);

alter table public.customer_login_accounts enable row level security;
revoke all on public.customer_login_accounts from anon, authenticated;

create or replace function public.register_customer_account()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_meta jsonb := new.raw_user_meta_data;
  v_phone text;
  v_name text;
  v_username text;
begin
  -- Staff and rider identities are provisioned by private admin functions and use
  -- reserved synthetic domains. Every other newly created Auth user must reserve a customer phone.
  if new.email like '%@staff.alshamiapp.xyz' and coalesce(v_meta ->> 'staff_username', '') <> '' then
    return new;
  end if;
  if new.email like '%@auth.alshamiapp.xyz' and coalesce(v_meta ->> 'requested_role', '') = 'delivery_rider' then
    return new;
  end if;

  v_phone := regexp_replace(coalesce(v_meta ->> 'contact_phone', ''), '[^0-9+]', '', 'g');
  if v_phone ~ '^0[0-9]{9}$' then v_phone := '+233' || substring(v_phone from 2); end if;
  if v_phone ~ '^233[0-9]{9}$' then v_phone := '+' || v_phone; end if;
  if v_phone !~ '^[+]233[0-9]{9}$' then
    raise exception 'A valid Ghana contact phone is required.' using errcode = '23514';
  end if;
  v_name := left(trim(coalesce(v_meta ->> 'full_name', 'Customer')), 120);
  if length(v_name) < 2 then raise exception 'A valid customer name is required.' using errcode = '23514'; end if;

  insert into public.customer_profiles (user_id, phone_e164, full_name)
  values (new.id, v_phone, v_name);

  v_username := lower(trim(coalesce(v_meta ->> 'customer_username', '')));
  if v_username <> '' then
    if v_username !~ '^[a-z0-9][a-z0-9._-]{2,29}$' then
      raise exception 'Username format is invalid.' using errcode = '23514';
    end if;
    insert into public.customer_login_accounts (user_id, username) values (new.id, v_username);
  end if;
  return new;
end;
$$;

revoke all on function public.register_customer_account() from public, anon, authenticated;
drop trigger if exists register_customer_account_after_auth_insert on auth.users;
create trigger register_customer_account_after_auth_insert
  after insert on auth.users
  for each row execute function public.register_customer_account();

drop policy if exists "Admins can view customer profiles" on public.customer_profiles;
create policy "Admins can view customer profiles"
  on public.customer_profiles for select to authenticated
  using (public.is_current_user_admin());
