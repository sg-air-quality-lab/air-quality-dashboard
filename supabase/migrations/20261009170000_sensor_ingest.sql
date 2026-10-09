-- Citizen sensors (e.g. airRohr) deliver their own readings through the website.
--
-- Security model:
--   * Each sensor has a login and a password. Only a SHA-256 hash of the password is stored.
--   * The website calls ingest_reading() with the read-only publishable key. The function
--     checks the password itself and can only add readings for that one sensor.
--   * Passwords are set by the owner in the SQL editor with set_device_token(); the
--     public API can neither read the hashes nor call set_device_token().
--
-- Storage: raw readings (every ~2.5 minutes) are kept for 30 days; hourly averages forever.
-- Hourly values use the NEA convention: the value at 14:00 covers 13:00–14:00.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.device_tokens (
  login       text primary key,                                   -- e.g. 'airrohr-14958775'
  device_id   text not null references public.devices (id) on delete cascade,
  token_hash  text not null,                                      -- sha256 hex of the password
  created_at  timestamptz not null default now()
);

alter table public.device_tokens enable row level security;     -- no policies: invisible to the public API
revoke all on public.device_tokens from anon, authenticated;

insert into public.metrics (id, name, unit, description, bands) values
  ('pm25_raw', 'PM2.5 (raw)', 'µg/m³', 'Single sensor reading, kept for 30 days.', '[]'::jsonb),
  ('pm10_raw', 'PM10 (raw)', 'µg/m³', 'Single sensor reading, kept for 30 days.', '[]'::jsonb),
  ('temperature_raw', 'Temperature (raw)', '°C', 'Single sensor reading, kept for 30 days.', '[]'::jsonb),
  ('humidity_raw', 'Relative humidity (raw)', '%', 'Single sensor reading, kept for 30 days.', '[]'::jsonb)
on conflict (id) do nothing;

update public.metrics set description = 'Particles up to 10 µm, hourly average.' where id = 'pm10';

-- Owner-only: set or replace a sensor password. Run in the Supabase SQL editor.
create or replace function public.set_device_token(p_device text, p_login text, p_password text)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if length(p_password) < 16 then
    raise exception 'Password too short: use at least 16 characters';
  end if;
  insert into public.device_tokens (login, device_id, token_hash)
  values (p_login, p_device, encode(digest(p_password, 'sha256'), 'hex'))
  on conflict (login) do update set device_id = excluded.device_id, token_hash = excluded.token_hash, created_at = now();
  return 'Password saved for ' || p_login;
end;
$$;

revoke all on function public.set_device_token(text, text, text) from public, anon, authenticated;

-- Called by the website for every delivery from a sensor.
-- p_values: {"pm25": 18.3, "pm10": 36.2, "temperature": 29.1, "humidity": 82.7}
create or replace function public.ingest_reading(p_login text, p_password text, p_values jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_device  text;
  v_hash    text;
  v_now     timestamptz := date_trunc('second', now());
  v_label   timestamptz := date_trunc('hour', now()) + interval '1 hour';
  v_key     text;
  v_value   double precision;
  v_stored  int := 0;
  v_limits  jsonb := '{"pm25":[0,1000],"pm10":[0,2000],"temperature":[-10,70],"humidity":[0,100]}';
  v_hourly  jsonb := '{"pm25":"pm25_1h","pm10":"pm10","temperature":"temperature","humidity":"humidity"}';
begin
  select device_id, token_hash into v_device, v_hash from public.device_tokens where login = p_login;
  if v_hash is null or v_hash <> encode(digest(coalesce(p_password, ''), 'sha256'), 'hex') then
    raise exception 'unauthorized' using errcode = '28000';
  end if;

  for v_key in select jsonb_object_keys(p_values) loop
    continue when not (v_limits ? v_key);
    begin
      v_value := (p_values ->> v_key)::double precision;
    exception when others then
      continue;
    end;
    continue when v_value is null
      or v_value < (v_limits -> v_key ->> 0)::double precision
      or v_value > (v_limits -> v_key ->> 1)::double precision;

    insert into public.observations (device_id, metric_id, ts, value)
    values (v_device, v_key || '_raw', v_now, v_value)
    on conflict (device_id, metric_id, ts) do update set value = excluded.value;

    -- Keep the hourly average of the current hour up to date.
    insert into public.observations (device_id, metric_id, ts, value)
    select v_device, v_hourly ->> v_key, v_label, round(avg(o.value)::numeric, 1)::double precision
    from public.observations o
    where o.device_id = v_device and o.metric_id = v_key || '_raw'
      and o.ts > v_label - interval '1 hour' and o.ts <= v_label
    on conflict (device_id, metric_id, ts) do update set value = excluded.value;

    v_stored := v_stored + 1;
  end loop;

  delete from public.observations
  where device_id = v_device
    and metric_id in ('pm25_raw', 'pm10_raw', 'temperature_raw', 'humidity_raw')
    and ts < now() - interval '30 days';

  return jsonb_build_object('stored', v_stored);
end;
$$;

revoke all on function public.ingest_reading(text, text, jsonb) from public;
grant execute on function public.ingest_reading(text, text, jsonb) to anon, authenticated;
