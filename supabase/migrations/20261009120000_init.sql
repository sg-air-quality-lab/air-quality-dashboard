-- Air Quality Lab: core data model
--
-- One generic "narrow" time-series model, so new sensor types never need new tables:
--   devices       anything that measures (an NEA region, an airRohr, a CO2 sensor in a classroom)
--   metrics       what is measured (pm25_1h, psi_24h, temperature, ...)
--   observations  one row per device, metric and timestamp
--
-- Security model:
--   * The public (anon key) may only READ, and only devices marked is_public.
--   * Only the server-side secret key (collector, ingest API) may WRITE. It bypasses RLS.

-- ---------------------------------------------------------------- tables

create table if not exists public.devices (
  id          text primary key,                 -- e.g. 'nea-west', 'airrohr-14958775'
  name        text not null,                    -- display name
  kind        text not null check (kind in ('reference', 'citizen')),
  source      text not null,                    -- 'nea', 'airrohr', ...
  region      text,                             -- NEA region the device belongs to
  -- Coarsened position only (about 1 km). Never store a home address.
  lat         double precision,
  lon         double precision,
  is_public   boolean not null default true,
  meta        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create table if not exists public.metrics (
  id           text primary key,                -- e.g. 'pm25_1h'
  name         text not null,
  unit         text not null,
  description  text,
  -- Category bands for the chart, e.g. [{"from":0,"to":55,"label":"Normal"}, ...]
  bands        jsonb not null default '[]'::jsonb
);

create table if not exists public.observations (
  device_id  text not null references public.devices (id) on delete cascade,
  metric_id  text not null references public.metrics (id) on delete restrict,
  ts         timestamptz not null,
  value      double precision not null,
  primary key (device_id, metric_id, ts)
);

-- Most queries ask "metric X, between two times"
create index if not exists observations_metric_ts_idx
  on public.observations (metric_id, ts);

-- ---------------------------------------------------------------- row level security

alter table public.devices      enable row level security;
alter table public.metrics      enable row level security;
alter table public.observations enable row level security;

drop policy if exists "public devices are readable" on public.devices;
create policy "public devices are readable"
  on public.devices for select
  to anon, authenticated
  using (is_public);

drop policy if exists "metrics are readable" on public.metrics;
create policy "metrics are readable"
  on public.metrics for select
  to anon, authenticated
  using (true);

drop policy if exists "observations of public devices are readable" on public.observations;
create policy "observations of public devices are readable"
  on public.observations for select
  to anon, authenticated
  using (exists (
    select 1 from public.devices d
    where d.id = observations.device_id and d.is_public
  ));

-- New tables are not exposed automatically in this project, so grant read access explicitly.
grant usage on schema public to anon, authenticated;
grant select on public.devices, public.metrics, public.observations to anon, authenticated;

-- ---------------------------------------------------------------- query function
--
-- Returns one JSON array instead of a set of rows, so the API's default 1000-row
-- limit never cuts a long time range short.
-- p_bucket: null = raw values; otherwise averages per bucket, e.g. '1 day'.

create or replace function public.get_series(
  p_metric  text,
  p_devices text[],
  p_from    timestamptz,
  p_to      timestamptz,
  p_bucket  interval default null
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(jsonb_agg(row_to_json(s) order by s.t, s.device), '[]'::jsonb)
  from (
    select
      o.device_id as device,
      case when p_bucket is null then o.ts
           else date_bin(p_bucket, o.ts, timestamptz '2000-01-01 00:00+08') end as t,
      round(avg(o.value)::numeric, 1)::double precision as v
    from public.observations o
    where o.metric_id = p_metric
      and o.device_id = any (p_devices)
      and o.ts >= p_from
      and o.ts <= p_to
    group by 1, 2
  ) s;
$$;

grant execute on function public.get_series(text, text[], timestamptz, timestamptz, interval)
  to anon, authenticated;

-- ---------------------------------------------------------------- seed data

insert into public.metrics (id, name, unit, description, bands) values
  ('pm25_1h', 'PM2.5 (1-hour)', 'µg/m³',
   'Hourly average concentration of fine particles up to 2.5 µm.',
   '[{"from":0,"to":55,"label":"Normal"},
     {"from":55,"to":150,"label":"Elevated"},
     {"from":150,"to":250,"label":"High"},
     {"from":250,"to":500,"label":"Very high"}]'::jsonb),
  ('psi_24h', 'PSI (24-hour)', 'index',
   'Pollutant Standards Index over the last 24 hours.',
   '[{"from":0,"to":50,"label":"Good"},
     {"from":50,"to":100,"label":"Moderate"},
     {"from":100,"to":200,"label":"Unhealthy"},
     {"from":200,"to":300,"label":"Very unhealthy"},
     {"from":300,"to":500,"label":"Hazardous"}]'::jsonb),
  ('pm10', 'PM10', 'µg/m³', 'Particles up to 10 µm (citizen sensors).', '[]'::jsonb),
  ('temperature', 'Temperature', '°C', 'Air temperature (citizen sensors).', '[]'::jsonb),
  ('humidity', 'Relative humidity', '%', 'Relative humidity (citizen sensors).', '[]'::jsonb)
on conflict (id) do update
  set name = excluded.name, unit = excluded.unit,
      description = excluded.description, bands = excluded.bands;

insert into public.devices (id, name, kind, source, region, lat, lon) values
  ('nea-north',   'NEA North',   'reference', 'nea', 'north',   1.41803, 103.82),
  ('nea-south',   'NEA South',   'reference', 'nea', 'south',   1.29587, 103.82),
  ('nea-east',    'NEA East',    'reference', 'nea', 'east',    1.35735, 103.94),
  ('nea-west',    'NEA West',    'reference', 'nea', 'west',    1.35735, 103.70),
  ('nea-central', 'NEA Central', 'reference', 'nea', 'central', 1.35735, 103.82)
on conflict (id) do nothing;
