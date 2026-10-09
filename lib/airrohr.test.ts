// Run with: node --experimental-strip-types --test lib/airrohr.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapAirRohr, parseBasicAuth } from './airrohr.ts';

test('maps an airRohr delivery with SDS011 and DHT22', () => {
  const values = mapAirRohr({
    esp8266id: '14958775',
    sensordatavalues: [
      { value_type: 'SDS_P1', value: '194.20' },
      { value_type: 'SDS_P2', value: '154.00' },
      { value_type: 'temperature', value: '29.20' },
      { value_type: 'humidity', value: '82.70' },
      { value_type: 'samples', value: '5013' },
      { value_type: 'signal', value: '-69' },
    ],
  });
  assert.deepEqual(values, { pm25: 154, pm10: 194.2, temperature: 29.2, humidity: 82.7 });
});

test('ignores broken values', () => {
  assert.deepEqual(mapAirRohr({ sensordatavalues: [{ value_type: 'SDS_P2', value: 'nan' }] }), {});
});

test('reads Basic auth', () => {
  const header = 'Basic ' + Buffer.from('airrohr-14958775:pa:ss').toString('base64');
  assert.deepEqual(parseBasicAuth(header), { login: 'airrohr-14958775', password: 'pa:ss' });
  assert.equal(parseBasicAuth('Bearer x'), null);
});
