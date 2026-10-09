import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateHourly, hourLabel, parseWeather } from './weather.mjs';

const T0 = Date.parse('2026-10-04T13:00:00+08:00');
const minute = 60_000;

/** One reading per minute from 13:01 to 14:00 for station S50. */
function series(fn) {
  return Array.from({ length: 60 }, (_, i) => ({ station: 'S50', t: T0 + (i + 1) * minute, value: fn(i) }));
}

test('parses v1 and v2 shapes and ignores other stations', () => {
  const v1 = { items: [{ timestamp: '2026-10-04T23:00:00+08:00', readings: [{ station_id: 'S50', value: 0.2 }, { station_id: 'S999', value: 1 }] }] };
  const v2 = { data: { readings: [{ timestamp: '2026-10-04T12:00:00+08:00', data: [{ stationId: 'S111', value: 31.7 }] }] } };
  assert.deepEqual(parseWeather(v1).map((r) => r.station), ['S50']);
  assert.deepEqual(parseWeather(v2), [{ station: 'S111', t: Date.parse('2026-10-04T12:00:00+08:00'), value: 31.7 }]);
});

test('hour labels follow NEA: 13:01 to 14:00 belongs to 14:00', () => {
  const h14 = Date.parse('2026-10-04T14:00:00+08:00');
  assert.equal(hourLabel(T0 + minute), h14);
  assert.equal(hourLabel(h14), h14);
});

test('averages temperature, sums rain, converts wind to km/h', () => {
  const rows = aggregateHourly({
    temperature: series((i) => (i < 30 ? 30 : 32)),
    rainfall: Array.from({ length: 12 }, (_, i) => ({ station: 'S50', t: T0 + (i + 1) * 5 * minute, value: 0.2 })),
    windSpeed: series(() => 10),
    windDir: series(() => 225),
  });
  const get = (m) => rows.find((r) => r.metric_id === m);
  assert.equal(get('temperature').value, 31);
  assert.equal(get('temperature').ts, new Date('2026-10-04T14:00:00+08:00').toISOString());
  assert.equal(get('rainfall').value, 2.4);
  assert.equal(get('wind_speed').value, 18.5);
  assert.equal(get('wind_dir').value, 225);
  assert.equal(get('temperature').device_id, 'nea-ws-S50');
});

test('wind direction is a vector average around north', () => {
  const rows = aggregateHourly({
    windSpeed: series(() => 5),
    windDir: series((i) => (i % 2 ? 350 : 10)),
  });
  assert.equal(rows.find((r) => r.metric_id === 'wind_dir').value, 0);
});

test('skips hours with too few readings', () => {
  const rows = aggregateHourly({ humidity: series(() => 80).slice(0, 10) });
  assert.equal(rows.length, 0);
});
