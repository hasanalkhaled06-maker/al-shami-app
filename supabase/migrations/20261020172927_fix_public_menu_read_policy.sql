
drop policy if exists "read menu" on public.menu_items;
create policy "public read available menu" on public.menu_items
  for select to anon using (is_available = true);
create policy "authenticated read menu" on public.menu_items
  for select to authenticated using (is_available = true or public.is_current_user_admin());

drop policy if exists "read active offers" on public.offers;
create policy "public read active offers" on public.offers
  for select to anon using (is_active = true);
create policy "authenticated read offers" on public.offers
  for select to authenticated using (is_active = true or public.is_current_user_admin());

revoke all on function public.is_current_user_admin() from public;
revoke all on function public.is_current_user_admin() from anon;
grant execute on function public.is_current_user_admin() to authenticated;
