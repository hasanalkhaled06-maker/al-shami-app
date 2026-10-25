-- AL SHAMI customer service review setup.
-- Additive and create-only: this script is not applied automatically.
begin;

create table if not exists public.customer_service_reviews (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  customer_user_id uuid not null references auth.users(id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  review_text text check (review_text is null or length(review_text) <= 1000),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at timestamptz not null default now(),
  unique (order_id, customer_user_id)
);

alter table public.customer_service_reviews enable row level security;
revoke all on public.customer_service_reviews from public, anon, authenticated;
grant select on public.customer_service_reviews to authenticated;
drop policy if exists "Admins read customer service reviews" on public.customer_service_reviews;
create policy "Admins read customer service reviews"
  on public.customer_service_reviews for select to authenticated
  using (exists (
    select 1 from public.admin_users a where a.user_id = (select auth.uid())
  ));

create or replace function public.submit_customer_service_review(
  p_order_id uuid,
  p_rating smallint,
  p_review_text text default null
) returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_review_id uuid;
begin
  if v_user_id is null then raise exception 'Sign in to review the service'; end if;
  if p_rating is null or p_rating not between 1 and 5 then raise exception 'Rating must be from 1 to 5'; end if;
  if p_review_text is not null and length(p_review_text) > 1000 then raise exception 'Review is too long'; end if;
  if not exists (
    select 1 from public.orders o
    where o.id = p_order_id
      and o.customer_user_id = v_user_id
      and o.status = 'completed'
  ) then
    raise exception 'Only a completed order you placed can be reviewed';
  end if;

  insert into public.customer_service_reviews(order_id, customer_user_id, rating, review_text)
  values (p_order_id, v_user_id, p_rating, nullif(trim(p_review_text), ''))
  on conflict (order_id, customer_user_id) do update
    set rating = excluded.rating,
        review_text = excluded.review_text,
        status = 'pending'
  returning id into v_review_id;

  return v_review_id;
end;
$$;

revoke all on function public.submit_customer_service_review(uuid, smallint, text) from public, anon;
grant execute on function public.submit_customer_service_review(uuid, smallint, text) to authenticated;

commit;
