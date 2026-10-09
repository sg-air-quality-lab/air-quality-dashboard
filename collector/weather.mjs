// NEA weather stations (data.gov.sg): wind, rain, humidity, temperature.
// Raw readings come every minute (rain: every 5 minutes). We store hourly values,
// labelled like NEA's PM2.5: the value at 14:00 covers 13:00–14:00.

import { getJson } from './nea.mjs';

/** One station per region, plus Clementi Road between West and Central. */
export const WEATHER_STATIONS = {
  S50: { name: 'Clementi Road', region: 'west' },
  S121: { name: 'Old Choa Chu Kang Road', region: 'west' },
  S111: { name: 'Scotts Road', region: 'central' },
  S06: { name: 'Paya Lebar', region: 'east' },
  S104: { name: 'Woodlands Avenue 9', region: 'north' },
  S116: { name: 'Pasir Panjang Terminal', region: 'south' },
};

export const WEATHER_ENDPOINTS = ['air-temperature', 'relative-humidity', 'rainfall', 'wind-speed', 'wind-direction'];

const V1 = 'https://api.data.gov.sg/v1/environment';
const V2 = 'https://api-open.data.gov.sg/v2/real-time/api';
const HOUR = 3600_000;
const KNOTS_TO_KMH = 1.852;

/** Minimum readings per hour before we trust the hourly value. */
const MIN_PER_HOUR = { minute: 40, fiveMinute: 10 };

/**
 * Parse a v1 or v2 weather response into { station, t (ms), value } for our stations.
 */
export function parseWeather(json) {
  const out = [];
  const v1Items = json?.items;
  if (Array.isArray(v1Items)) {
    for (const item of v1Items) {
      const t = Date.parse(item?.timestamp);
      if (Number.isNaN(t)) continue;
      for (const r of item.readings ?? []) push(r.station_id, t, r.value);
    }
  }
  const v2Readings = json?.data?.readings;
  if (Array.isArray(v2Readings)) {
    for (const item of v2Readings) {
      const t = Date.parse(item?.timestamp);
      if (Number.isNaN(t)) continue;
      for (const r of item.data ?? []) push(r.stationId, t, r.value);
    }
  }
  return out;

  function push(station, t, value) {
    if (!(station in WEATHER_STATIONS)) return;
    if (typeof value !== 'number' || !Number.isFinite(value)) return;
    out.push({ station, t, value });
  }
}

/** Hour label for a reading: 13:01–14:00 belongs to 14:00. */
export function hourLabel(t) {
  return Math.ceil(t / HOUR) * HOUR;
}

function groupByStationHour(readings) {
  const groups = new Map();
  for (const r of readings) {
    const key = `${r.station}|${hourLabel(r.t)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  return groups;
}

function row(station, label, metric, value) {
  return {
    device_id: `nea-ws-${station}`,
    metric_id: metric,
    ts: new Date(label).toISOString(),
    value: Math.round(value * 10) / 10,
  };
}

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

/**
 * Turn raw readings into hourly observation rows.
 * Incomplete hours (too few readings) are skipped; a later run fills them in.
 */
export function aggregateHourly({ temperature = [], humidity = [], rainfall = [], windSpeed = [], windDir = [] }) {
  const rows = [];

  for (const [metric, readings] of [['temperature', temperature], ['humidity', humidity]]) {
    for (const [key, rs] of groupByStationHour(readings)) {
      if (rs.length < MIN_PER_HOUR.minute) continue;
      const [station, label] = key.split('|');
      rows.push(row(station, Number(label), metric, mean(rs.map((r) => r.value))));
    }
  }

  for (const [key, rs] of groupByStationHour(rainfall)) {
    if (rs.length < MIN_PER_HOUR.fiveMinute) continue;
    const [station, label] = key.split('|');
    rows.push(row(station, Number(label), 'rainfall', rs.reduce((a, r) => a + r.value, 0)));
  }

  // Wind: average speed, and a speed-weighted vector average for the direction
  // (a plain average of 350° and 10° would wrongly give 180°).
  const dirAt = new Map(windDir.map((r) => [`${r.station}|${r.t}`, r.value]));
  for (const [key, rs] of groupByStationHour(windSpeed)) {
    if (rs.length < MIN_PER_HOUR.minute) continue;
    const [station, label] = key.split('|');
    rows.push(row(station, Number(label), 'wind_speed', mean(rs.map((r) => r.value)) * KNOTS_TO_KMH));
    let u = 0;
    let v = 0;
    let n = 0;
    for (const r of rs) {
      const deg = dirAt.get(`${r.station}|${r.t}`);
      if (deg == null) continue;
      const rad = (deg * Math.PI) / 180;
      u += r.value * Math.sin(rad);
      v += r.value * Math.cos(rad);
      n++;
    }
    if (n >= MIN_PER_HOUR.minute && (u !== 0 || v !== 0)) {
      const deg = ((Math.atan2(u, v) * 180) / Math.PI + 360) % 360;
      rows.push(row(station, Number(label), 'wind_dir', deg));
    }
  }
  return rows;
}

async function fetchEndpointDay(endpoint, date) {
  try {
    const json = await getJson(`${V1}/${endpoint}?date=${date}`);
    const readings = parseWeather(json);
    if (readings.length) return readings;
  } catch (err) {
    console.warn(`v1 failed for ${endpoint} ${date}: ${err.message}`);
  }
  const readings = [];
  let token = null;
  for (let page = 0; page < 200; page++) {
    const url = `${V2}/${endpoint}?date=${date}${token ? `&paginationToken=${encodeURIComponent(token)}` : ''}`;
    const json = await getJson(url);
    readings.push(...parseWeather(json));
    token = json?.data?.paginationToken;
    if (!token) break;
  }
  return readings;
}

/**
 * Hourly weather rows from one Singapore calendar day of raw readings.
 * Covers the hours labelled 01:00 of `date` to 00:00 of the next day;
 * the 00:00 hour of `date` comes from the previous day's readings.
 */
export async function fetchWeatherDay(date) {
  const raw = {};
  const keys = { 'air-temperature': 'temperature', 'relative-humidity': 'humidity', rainfall: 'rainfall', 'wind-speed': 'windSpeed', 'wind-direction': 'windDir' };
  for (const endpoint of WEATHER_ENDPOINTS) {
    raw[keys[endpoint]] = await fetchEndpointDay(endpoint, date);
    await new Promise((r) => setTimeout(r, 300));
  }
  return aggregateHourly(raw);
}
