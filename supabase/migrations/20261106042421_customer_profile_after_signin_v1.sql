-- Customer profile details are collected and inserted only after authentication.
-- Keep the Auth user signup for email confirmation, but do not reserve profile data pre-login.
create or replace function public.register_customer_account()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_meta jsonb := new.raw_user_meta_data;
  v_username text;
begin
  if new.email like '%@staff.alshamiapp.xyz' and coalesce(v_meta ->> 'staff_username', '') <> '' then
    return new;
  end if;
  if new.email like '%@auth.alshamiapp.xyz' and coalesce(v_meta ->> 'requested_role', '') = 'delivery_rider' then
    return new;
  end if;

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

-- Remove only orphaned profiles belonging to customers who have never confirmed
-- their email and have no order history. Keep their Auth account/password so a
-- corrected email can be used for a fresh signup with the same phone.
delete from public.customer_profiles p
using auth.users u
where p.user_id = u.id
  and u.email_confirmed_at is null
  and u.raw_user_meta_data ->> 'customer_account' = 'true'
  and not exists (select 1 from public.orders o where o.customer_user_id = u.id);

-- Clear any remaining pre-login profile fields from unfinished customer signups.
update auth.users u
set raw_user_meta_data = coalesce(u.raw_user_meta_data, '{}'::jsonb)
  - 'full_name' - 'contact_phone' - 'phone_e164' - 'phone'
where u.email_confirmed_at is null
  and u.raw_user_meta_data ->> 'customer_account' = 'true'
  and not exists (select 1 from public.orders o where o.customer_user_id = u.id);
