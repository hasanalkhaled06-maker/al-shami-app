-- Run once in the Supabase SQL Editor before deploying the admin photo uploader.
-- Menu images are public because customers need to load them without signing in.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'menu-images',
  'menu-images',
  true,
  8388608,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'admin upload menu photos'
  ) then
    execute $policy$
      create policy "admin upload menu photos"
      on storage.objects for insert to authenticated
      with check (
        bucket_id = 'menu-images'
        and (storage.foldername(name))[1] = 'menu-items'
        and public.is_current_user_admin()
      )
    $policy$;
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'admin delete menu photos'
  ) then
    execute $policy$
      create policy "admin delete menu photos"
      on storage.objects for delete to authenticated
      using (
        bucket_id = 'menu-images'
        and (storage.foldername(name))[1] = 'menu-items'
        and public.is_current_user_admin()
      )
    $policy$;
  end if;
end
$$;
