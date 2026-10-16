// Run with: node --experimental-strip-types --test lib/export.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unzipSync, strFromU8 } from 'fflate';
import { buildExportTable, toCsv } from './export.ts';
import { buildXlsx, columnName, excelDate } from './xlsx.ts';

const H = (h: number) => new Date(Date.UTC(2026, 9, 14, h - 8)).toISOString(); // h o'clock Singapore time
const compass = (d: number) => (d >= 202 && d < 247 ? 'SW' : 'N');

const input = {
  metricShort: 'PM2.5',
  unit: 'µg/m³',
  regions: [
    { id: 'nea-central', name: 'Central' },
    { id: 'nea-west', name: 'West' },
  ],
  points: [
    { t: H(13), device: 'nea-central', v: 139 },
    { t: H(14), device: 'nea-central', v: 206 },
    { t: H(14), device: 'nea-west', v: 284 },
    { t: H(14), device: 'nea-east', v: 195 }, // not selected, must not appear
  ],
  weather: [
    { label: 'Wind speed', unit: 'km/h', points: [{ t: H(14), device: 's', v: 7.44 }], directions: [{ t: H(14), device: 's', v: 225.4 }] },
  ],
  compass,
};

test('one column per selected region and weather value, rows sorted by time', () => {
  const t = buildExportTable(input);
  assert.deepEqual(
    t.columns.map((c) => c.header),
    ['Time (Singapore)', 'PM2.5 Central (µg/m³)', 'PM2.5 West (µg/m³)', 'Wind speed (km/h)', 'Wind from (degrees)', 'Wind from (compass)'],
  );
  assert.equal(t.rows.length, 2);
  assert.deepEqual(t.rows[0], [Date.parse(H(13)), 139, null, null, null, null]);
  assert.deepEqual(t.rows[1], [Date.parse(H(14)), 206, 284, 7.4, 225, 'SW']);
});

test('the zoom window limits the rows', () => {
  const t = buildExportTable({ ...input, window: { from: Date.parse(H(14)), to: Date.parse(H(15)) } });
  assert.equal(t.rows.length, 1);
});

test('CSV has a single header row and rounded values', () => {
  const csv = toCsv(buildExportTable(input), (t) => new Date(t).toISOString());
  const lines = csv.trim().split('\r\n');
  assert.equal(lines.length, 3);
  assert.ok(lines[0].startsWith('Time (Singapore),PM2.5 Central'));
  assert.ok(lines[2].endsWith(',206,284,7.4,225,SW'));
});

test('Excel dates are in Singapore time', () => {
  // 2026-10-14 14:00 SGT = 46309.5833… days after 1899-12-30
  assert.equal(Math.round(excelDate(Date.parse(H(14))) * 24), 46309 * 24 + 14);
  assert.equal(columnName(0), 'A');
  assert.equal(columnName(25), 'Z');
  assert.equal(columnName(26), 'AA');
});

test('the .xlsx file contains the sheets, header and values', () => {
  const bytes = buildXlsx([
    { name: 'Data', header: ['Time', 'PM2.5 <&>'], rows: [[{ time: Date.parse(H(14)) }, 206]] },
    { name: 'Info', rows: [['Source', 'NEA']] },
  ]);
  const files = unzipSync(bytes);
  assert.ok(files['[Content_Types].xml'] && files['xl/workbook.xml'] && files['xl/styles.xml']);
  const sheet = strFromU8(files['xl/worksheets/sheet1.xml']);
  assert.match(sheet, /PM2\.5 &lt;&amp;&gt;/);
  assert.match(sheet, /<c r="B2"><v>206<\/v><\/c>/);
  assert.match(sheet, /<c r="A2" s="2">/);
  assert.match(strFromU8(files['xl/workbook.xml']), /name="Info"/);
});
