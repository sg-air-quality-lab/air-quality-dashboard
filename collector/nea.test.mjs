import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dateRange, dedupe, hasMidnight, parseReadings, sgDate } from './nea.mjs';

const v1 = {
  items: [
    {
      timestamp: '2026-10-08T21:00:00+08:00',
      readings: { pm25_one_hourly: { north: 83, south: 108, west: 120, east: 95, central: 151 } },
    },
  ],
};

const v2 = {
  code: 0,
  data: {
    items: [
      {
        timestamp: '2026-10-09T05:00:00+08:00',
        readings: { psi_twenty_four_hourly: { west: 154, east: 120, central: 142, south: 98, north: 101, national: 154 } },
      },
    ],
  },
};

test('parses v1 PM2.5 response into one row per region', () => {
  const rows = parseReadings(v1, 'pm25_1h');
  assert.equal(rows.length, 5);
  assert.deepEqual(rows.find((r) => r.device_id === 'nea-central'), {
    device_id: 'nea-central', metric_id: 'pm25_1h', ts: '2026-10-08T21:00:00+08:00', value: 151,
  });
});

test('parses v2 PSI response and skips the national value', () => {
  const rows = parseReadings(v2, 'psi_24h');
  assert.equal(rows.length, 5);
  assert.ok(rows.every((r) => r.device_id.startsWith('nea-') && r.device_id !== 'nea-national'));
});

test('skips missing and invalid values', () => {
  const json = { items: [{ timestamp: '2026-10-08T22:00:00+08:00', readings: { pm25_one_hourly: { west: null, east: -1, north: 'x', south: 40 } } }] };
  assert.deepEqual(parseReadings(json, 'pm25_1h').map((r) => r.device_id), ['nea-south']);
});

test('dedupe treats equal instants in different zones as the same row', () => {
  const rows = dedupe([
    { device_id: 'nea-west', metric_id: 'pm25_1h', ts: '2026-10-08T21:00:00+08:00', value: 1 },
    { device_id: 'nea-west', metric_id: 'pm25_1h', ts: '2026-10-08T13:00:00Z', value: 2 },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].value, 2);
});

test('date helpers use Singapore dates', () => {
  assert.equal(sgDate(new Date('2026-10-08T17:30:00Z')), '2026-10-09');
  assert.deepEqual(dateRange('2026-09-30', '2026-10-02'), ['2026-09-30', '2026-10-01', '2026-10-02']);
});

test('detects whether the 00:00 reading of a day is present', () => {
  const rows = [{ ts: '2026-10-08T01:00:00+08:00' }];
  assert.equal(hasMidnight(rows, '2026-10-08'), false);
  assert.equal(hasMidnight([...rows, { ts: '2026-10-07T16:00:00Z' }], '2026-10-08'), true);
});
