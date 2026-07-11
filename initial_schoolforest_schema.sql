create schema if not exists private;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  login_id text unique,
  name text not null default '',
  role text not null default 'student' check (role in ('owner_teacher','collaborating_teacher','student')),
  class_name text not null default '',
  approval_status text not null default 'pending' check (approval_status in ('pending','approved','rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.applications (
  id uuid primary key default gen_random_uuid(),
  login_id text not null,
  name text not null,
  email text,
  class_name text not null default '',
  requested_role text not null default 'student' check (requested_role in ('student','collaborating_teacher')),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  auth_user_id uuid references auth.users(id) on delete set null,
  note text not null default '',
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null
);

create table if not exists public.surveys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  participant_name text not null default '',
  class_name text not null default '',
  zone_name text not null default '',
  start_time timestamptz,
  end_time timestamptz,
  distance_m numeric not null default 0,
  start_lat numeric,
  start_lon numeric,
  end_lat numeric,
  end_lon numeric,
  route jsonb not null default '[]'::jsonb,
  reflection text not null default '',
  status text not null default 'draft' check (status in ('draft','submitted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.observations (
  id uuid primary key default gen_random_uuid(),
  survey_id uuid not null references public.surveys(id) on delete cascade,
  species text not null,
  count integer not null default 1 check (count > 0),
  observed_at timestamptz,
  latitude numeric,
  longitude numeric,
  accuracy_m numeric,
  location_method text not null default 'gps',
  note text not null default '',
  photo_path text,
  created_at timestamptz not null default now()
);

create index if not exists profiles_role_idx on public.profiles(role);
create index if not exists profiles_class_name_idx on public.profiles(class_name);
create index if not exists applications_status_idx on public.applications(status);
create index if not exists surveys_user_id_idx on public.surveys(user_id);
create index if not exists surveys_class_name_idx on public.surveys(class_name);
create index if not exists surveys_created_at_idx on public.surveys(created_at desc);
create index if not exists observations_survey_id_idx on public.observations(survey_id);
create index if not exists observations_species_idx on public.observations(species);

create or replace function private.is_owner_teacher()
returns boolean language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'owner_teacher' and approval_status = 'approved'
  );
$$;

create or replace function private.is_teacher()
returns boolean language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and role in ('owner_teacher','collaborating_teacher')
      and approval_status = 'approved'
  );
$$;

create or replace function private.handle_new_user()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, login_id, name, class_name, approval_status)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'login_id', split_part(coalesce(new.email, ''), '@', 1)),
    coalesce(new.raw_user_meta_data ->> 'name', ''),
    coalesce(new.raw_user_meta_data ->> 'class_name', ''),
    'pending'
  ) on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute procedure private.handle_new_user();

alter table public.profiles enable row level security;
alter table public.applications enable row level security;
alter table public.surveys enable row level security;
alter table public.observations enable row level security;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
using (id = auth.uid() or private.is_teacher());

drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles for insert to authenticated
with check (id = auth.uid() and role = 'student' and approval_status = 'pending');

drop policy if exists profiles_manage_owner on public.profiles;
create policy profiles_manage_owner on public.profiles for all to authenticated
using (private.is_owner_teacher()) with check (private.is_owner_teacher());

drop policy if exists applications_insert_public on public.applications;
create policy applications_insert_public on public.applications for insert to anon, authenticated
with check (status = 'pending'
  and requested_role in ('student','collaborating_teacher')
  and auth_user_id is null
  and reviewed_at is null
  and reviewed_by is null);

drop policy if exists applications_select_owner on public.applications;
create policy applications_select_owner on public.applications for select to authenticated
using (private.is_owner_teacher());

drop policy if exists applications_manage_owner on public.applications;
create policy applications_manage_owner on public.applications for update to authenticated
using (private.is_owner_teacher()) with check (private.is_owner_teacher());

drop policy if exists applications_delete_owner on public.applications;
create policy applications_delete_owner on public.applications for delete to authenticated
using (private.is_owner_teacher());

drop policy if exists surveys_select on public.surveys;
create policy surveys_select on public.surveys for select to authenticated
using (user_id = auth.uid() or private.is_teacher());

drop policy if exists surveys_insert on public.surveys;
create policy surveys_insert on public.surveys for insert to authenticated
with check (user_id = auth.uid());

drop policy if exists surveys_update_self on public.surveys;
create policy surveys_update_self on public.surveys for update to authenticated
using (user_id = auth.uid() and status = 'draft')
with check (user_id = auth.uid() and status in ('draft','submitted'));

drop policy if exists surveys_manage_owner on public.surveys;
create policy surveys_manage_owner on public.surveys for all to authenticated
using (private.is_owner_teacher()) with check (private.is_owner_teacher());

drop policy if exists surveys_delete_self on public.surveys;
create policy surveys_delete_self on public.surveys for delete to authenticated
using (user_id = auth.uid() and status = 'draft');

drop policy if exists observations_select on public.observations;
create policy observations_select on public.observations for select to authenticated
using (exists (select 1 from public.surveys s where s.id = survey_id
  and (s.user_id = auth.uid() or private.is_teacher())));

drop policy if exists observations_insert on public.observations;
create policy observations_insert on public.observations for insert to authenticated
with check (exists (select 1 from public.surveys s where s.id = survey_id
  and (s.user_id = auth.uid() or private.is_teacher())));

drop policy if exists observations_update on public.observations;
create policy observations_update on public.observations for update to authenticated
using (exists (select 1 from public.surveys s where s.id = survey_id
  and (s.user_id = auth.uid() or private.is_owner_teacher())))
with check (exists (select 1 from public.surveys s where s.id = survey_id
  and (s.user_id = auth.uid() or private.is_owner_teacher())));

drop policy if exists observations_delete on public.observations;
create policy observations_delete on public.observations for delete to authenticated
using (exists (select 1 from public.surveys s where s.id = survey_id
  and (s.user_id = auth.uid() or private.is_owner_teacher())));

grant usage on schema private to authenticated;
grant execute on function private.is_owner_teacher() to authenticated;
grant execute on function private.is_teacher() to authenticated;

insert into storage.buckets (id, name, public)
values ('observation-photos', 'observation-photos', false)
on conflict (id) do nothing;

drop policy if exists observation_photos_select on storage.objects;
create policy observation_photos_select on storage.objects for select to authenticated
using (bucket_id = 'observation-photos'
  and (private.is_teacher() or (storage.foldername(name))[1] = auth.uid()::text));

drop policy if exists observation_photos_insert on storage.objects;
create policy observation_photos_insert on storage.objects for insert to authenticated
with check (bucket_id = 'observation-photos'
  and ((storage.foldername(name))[1] = auth.uid()::text or private.is_owner_teacher()));

drop policy if exists observation_photos_update on storage.objects;
create policy observation_photos_update on storage.objects for update to authenticated
using (bucket_id = 'observation-photos'
  and (private.is_teacher() or (storage.foldername(name))[1] = auth.uid()::text))
with check (bucket_id = 'observation-photos'
  and (private.is_teacher() or (storage.foldername(name))[1] = auth.uid()::text));

drop policy if exists observation_photos_delete on storage.objects;
create policy observation_photos_delete on storage.objects for delete to authenticated
using (bucket_id = 'observation-photos'
  and (private.is_teacher() or (storage.foldername(name))[1] = auth.uid()::text));
