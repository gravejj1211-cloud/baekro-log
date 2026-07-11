create table if not exists public.survey_settings (
  id text primary key,
  zones jsonb not null default '[]'::jsonb,
  habitat_options jsonb not null default '[]'::jsonb,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.survey_settings
  add column if not exists habitat_options jsonb not null default '[]'::jsonb;

alter table public.survey_settings enable row level security;

drop policy if exists survey_settings_select on public.survey_settings;
create policy survey_settings_select on public.survey_settings
  for select to authenticated using (true);

drop policy if exists survey_settings_manage_owner on public.survey_settings;
create policy survey_settings_manage_owner on public.survey_settings
  for all to authenticated
  using (private.is_owner_teacher())
  with check (private.is_owner_teacher());

grant select, insert, update, delete on public.survey_settings to authenticated;
