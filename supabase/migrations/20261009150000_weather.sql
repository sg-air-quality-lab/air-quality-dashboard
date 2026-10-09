-- NEA weather stations: wind, rain, humidity, temperature (hourly values).

insert into public.metrics (id, name, unit, description, bands) values
  ('wind_speed', 'Wind speed', 'km/h', 'Average wind speed over the hour.', '[]'::jsonb),
  ('wind_dir', 'Wind direction', '°', 'Direction the wind blows FROM (0 = north, 90 = east, 180 = south, 270 = west), averaged over the hour.', '[]'::jsonb),
  ('rainfall', 'Rainfall', 'mm', 'Total rain in the hour.', '[]'::jsonb)
on conflict (id) do update
  set name = excluded.name, unit = excluded.unit, description = excluded.description;

update public.metrics set description = 'Air temperature, hourly average.' where id = 'temperature';
update public.metrics set description = 'Relative humidity, hourly average.' where id = 'humidity';

insert into public.devices (id, name, kind, source, region, lat, lon) values
  ('nea-ws-S50',  'Clementi Road',          'reference', 'nea-weather', 'west',    1.3318, 103.7762),
  ('nea-ws-S121', 'Old Choa Chu Kang Road', 'reference', 'nea-weather', 'west',    1.3738, 103.7217),
  ('nea-ws-S111', 'Scotts Road',            'reference', 'nea-weather', 'central', 1.3106, 103.8365),
  ('nea-ws-S06',  'Paya Lebar',             'reference', 'nea-weather', 'east',    1.3570, 103.9040),
  ('nea-ws-S104', 'Woodlands Avenue 9',     'reference', 'nea-weather', 'north',   1.4439, 103.7854),
  ('nea-ws-S116', 'Pasir Panjang Terminal', 'reference', 'nea-weather', 'south',   1.2824, 103.7545)
on conflict (id) do nothing;
