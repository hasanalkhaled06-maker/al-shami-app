
    create table if not exists public.customer_profiles (
      user_id uuid primary key references auth.users(id) on delete cascade,
      phone_e164 text not null,
      full_name text not null,
      created_at timestamptz not null default now(),
      constraint customer_profiles_phone_e164_format
        check (phone_e164 ~ '^\+233[0-9]{9}$')
    );

    create unique index if not exists customer_profiles_phone_e164_unique_idx
      on public.customer_profiles (phone_e164);

    alter table public.customer_profiles enable row level security;
    grant select, insert on public.customer_profiles to authenticated;

    do $$
    begin
      if not exists (
        select 1 from pg_policies
        where schemaname = 'public' and tablename = 'customer_profiles'
          and policyname = 'Customers can view their own profile'
      ) then
        create policy "Customers can view their own profile"
          on public.customer_profiles for select to authenticated
          using ((select auth.uid()) = user_id);
      end if;

      if not exists (
        select 1 from pg_policies
        where schemaname = 'public' and tablename = 'customer_profiles'
          and policyname = 'Customers can register their own profile'
      ) then
        create policy "Customers can register their own profile"
          on public.customer_profiles for insert to authenticated
          with check ((select auth.uid()) = user_id);
      end if;
    end $$;
