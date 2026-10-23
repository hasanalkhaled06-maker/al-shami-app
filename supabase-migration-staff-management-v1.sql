-- AL SHAMI employee management v1
-- Adds detailed employee records and a private bucket for employee documents.
alter table public.staff_profiles
  add column if not exists email text,
  add column if not exists date_of_birth date,
  add column if not exists nationality text,
  add column if not exists address text,
  add column if not exists emergency_contact_name text,
  add column if not exists emergency_contact_phone text,
  add column if not exists id_type text,
  add column if not exists id_number text,
  add column if not exists id_expiry_date date,
  add column if not exists photo_path text,
  add column if not exists id_document_path text,
  add column if not exists contract_path text,
  add column if not exists position_title text,
  add column if not exists department text,
  add column if not exists employment_type text not null default 'full_time',
  add column if not exists employment_status text not null default 'active',
  add column if not exists start_date date,
  add column if not exists end_date date,
  add column if not exists salary_amount numeric(12,2),
  add column if not exists salary_frequency text not null default 'monthly',
  add column if not exists payment_method text,
  add column if not exists job_description text,
  add column if not exists notes text;

alter table public.staff_profiles
  drop constraint if exists staff_profiles_salary_amount_check;
alter table public.staff_profiles
  add constraint staff_profiles_salary_amount_check
  check (salary_amount is null or salary_amount >= 0);

alter table public.staff_profiles
  drop constraint if exists staff_profiles_employment_type_check;
alter table public.staff_profiles
  add constraint staff_profiles_employment_type_check
  check (employment_type in ('full_time','part_time','temporary','casual','contract'));

alter table public.staff_profiles
  drop constraint if exists staff_profiles_employment_status_check;
alter table public.staff_profiles
  add constraint staff_profiles_employment_status_check
  check (employment_status in ('active','on_leave','suspended','terminated'));

alter table public.staff_profiles
  drop constraint if exists staff_profiles_salary_frequency_check;
alter table public.staff_profiles
  add constraint staff_profiles_salary_frequency_check
  check (salary_frequency in ('hourly','daily','weekly','monthly'));

alter table public.staff_profiles
  drop constraint if exists staff_profiles_payment_method_check;
alter table public.staff_profiles
  add constraint staff_profiles_payment_method_check
  check (payment_method is null or payment_method in ('cash','mobile_money','bank','other'));

create index if not exists staff_profiles_status_name_idx
  on public.staff_profiles (employment_status, full_name);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('staff-private', 'staff-private', false, 10485760, array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do update set public = false, file_size_limit = 10485760,
  allowed_mime_types = array['image/jpeg','image/png','image/webp','application/pdf'];

drop policy if exists "admin manage staff private files" on storage.objects;
create policy "admin manage staff private files"
on storage.objects for all to authenticated
using (bucket_id = 'staff-private' and public.is_current_user_admin())
with check (bucket_id = 'staff-private' and public.is_current_user_admin());
