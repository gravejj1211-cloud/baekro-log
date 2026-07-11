-- delete-my-surveys Edge Function runs with service_role.
-- These grants are separate from RLS and are required for Data API access.
grant usage on schema public to service_role;
grant select on table public.profiles to service_role;
grant select, delete on table public.surveys to service_role;
grant select, delete on table public.observations to service_role;
