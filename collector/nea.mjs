// Fetching and parsing official NEA readings from data.gov.sg.
// Pure helpers live here so they can be tested without network access.

export const REGIONS = ['north', 'south', 'east', 'west', 'central'];

export const NEA_METRICS = {
  pm25_1h: { endpoint: 'pm25', readingKey: 'pm25_one_hourly' },
  psi_24h: { endpoint: 'psi', readingKey: 'psi_twenty_four_hourly' },
};

const V1 = 'https://api.data.gov.sg/v1/environment';
const V2 = 'https://api-open.data.gov.sg/v2/real-time/api';

/** Singapore calendar date (YYYY-MM-DD) for a JS Date. */
export function sgDate(d) {
  return new Date(d.getTime() + 8 * 3600_000).toISOString().slice(0, 10);
}

/** All calendar dates from `from` to `to` inclusive (YYYY-MM-DD strings). */
export function dateRange(from, to) {
  const out = [];
  const end = new Date(`${to}T00:00:00Z`);
  for (let d = new Date(`${from}T00:00:00Z`); d <= end; d = new Date(d.getTime() + 86400_000)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

/**
 * Turn an API response (v1 or v2 shape) into observation rows.
 * Unknown regions (e.g. "national") and non-numeric values are skipped.
 */
export function parseReadings(json, metricId) {
  const { readingKey } = NEA_METRICS[metricId];
  const items = json?.items ?? json?.data?.items ?? [];
  const rows = [];
  for (const item of items) {
    const readings = item?.readings?.[readingKey];
    const ts = item?.timestamp;
    if (!readings || !ts || Number.isNaN(Date.parse(ts))) continue;
    for (const region of REGIONS) {
      const value = readings[region];
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) continue;
      rows.push({ device_id: `nea-${region}`, metric_id: metricId, ts, value });
    }
  }
  return rows;
}

/** Remove duplicate (device, metric, ts) rows, keeping the last one. */
export function dedupe(rows) {
  const map = new Map();
  for (const r of rows) map.set(`${r.device_id}|${r.metric_id}|${new Date(r.ts).toISOString()}`, r);
  return [...map.values()];
}

async function getJson(url, { retries = 3 } = {}) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { accept: 'application/json' } });
    if (res.ok) return res.json();
    if ((res.status === 429 || res.status >= 500) && attempt < retries) {
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      continue;
    }
    throw new Error(`${res.status} ${res.statusText} for ${url}`);
  }
}

/** Fetch one day of one metric. Tries the v1 API first, then v2 (with pagination). */
export async function fetchDay(metricId, date) {
  const { endpoint } = NEA_METRICS[metricId];
  try {
    const json = await getJson(`${V1}/${endpoint}?date=${date}`);
    const rows = parseReadings(json, metricId);
    if (rows.length) return rows;
  } catch (err) {
    console.warn(`v1 failed for ${metricId} ${date}: ${err.message}`);
  }
  const rows = [];
  let token = null;
  for (let page = 0; page < 50; page++) {
    const url = `${V2}/${endpoint}?date=${date}${token ? `&paginationToken=${encodeURIComponent(token)}` : ''}`;
    const json = await getJson(url);
    rows.push(...parseReadings(json, metricId));
    token = json?.data?.paginationToken;
    if (!token) break;
  }
  return rows;
}
