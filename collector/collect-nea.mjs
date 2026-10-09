#!/usr/bin/env node
// Collects official NEA readings and stores them in Supabase.
//
//   node collector/collect-nea.mjs                         -> yesterday and today (hourly job)
//   node collector/collect-nea.mjs 2026-09-01 2026-10-09   -> backfill a date range
//
// Needs SUPABASE_URL and SUPABASE_SECRET_KEY (server-side key, never in the browser).

import { NEA_METRICS, dateRange, dedupe, fetchDay, sgDate } from './nea.mjs';

const url = process.env.SUPABASE_URL?.replace(/\/$/, '');
const key = process.env.SUPABASE_SECRET_KEY;
if (!url || !key) {
  console.error('Missing SUPABASE_URL or SUPABASE_SECRET_KEY.');
  process.exit(1);
}

const now = new Date();
const [from = sgDate(new Date(now.getTime() - 86400_000)), to = sgDate(now)] = process.argv.slice(2);
if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
  console.error(`Invalid date range: ${from} .. ${to}`);
  process.exit(1);
}

function authHeaders() {
  const h = { apikey: key };
  // Legacy JWT keys also go in the Authorization header; new sb_secret_ keys do not.
  if (key.startsWith('eyJ')) h.authorization = `Bearer ${key}`;
  return h;
}

async function upsert(rows) {
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const res = await fetch(`${url}/rest/v1/observations?on_conflict=device_id,metric_id,ts`, {
      method: 'POST',
      headers: {
        ...authHeaders(),
        'content-type': 'application/json',
        prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(chunk),
    });
    if (!res.ok) throw new Error(`Supabase upsert failed: ${res.status} ${await res.text()}`);
  }
}

let stored = 0;
let failures = 0;
const dates = dateRange(from, to);
console.log(`Collecting ${Object.keys(NEA_METRICS).join(', ')} for ${from} .. ${to} (${dates.length} days)`);

for (const date of dates) {
  for (const metricId of Object.keys(NEA_METRICS)) {
    try {
      const rows = dedupe(await fetchDay(metricId, date));
      if (rows.length) await upsert(rows);
      stored += rows.length;
      console.log(`  ${date} ${metricId}: ${rows.length} values`);
    } catch (err) {
      failures++;
      console.error(`  ${date} ${metricId}: FAILED - ${err.message}`);
    }
    await new Promise((r) => setTimeout(r, 300)); // be gentle with the public API
  }
}

console.log(`Done: ${stored} values stored, ${failures} failed requests.`);
if (stored === 0 && failures > 0) process.exit(1);
