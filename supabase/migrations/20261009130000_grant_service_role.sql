-- New tables are not exposed automatically in this project, so the server-side
-- secret key (role service_role, used by the collector) needs explicit write access.
-- The public roles (anon, authenticated) stay read-only.

grant select, insert, update, delete on public.devices, public.metrics, public.observations to service_role;
grant execute on function public.get_series(text, text[], timestamptz, timestamptz, interval) to service_role;
