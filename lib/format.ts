import { TIME_ZONE } from './config';

const dateTime = new Intl.DateTimeFormat('en-SG', {
  timeZone: TIME_ZONE,
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const dateOnly = new Intl.DateTimeFormat('en-SG', {
  timeZone: TIME_ZONE,
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

const parts = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

export function fmtDateTime(t: number | string | Date, daily = false) {
  const d = new Date(t);
  return daily ? dateOnly.format(d) : dateTime.format(d);
}

/** "2026-10-09 05:00" in Singapore time, for CSV files. */
export function fmtIsoLocal(t: number | string | Date) {
  const p = Object.fromEntries(parts.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  const hour = p.hour === '24' ? '00' : p.hour;
  return `${p.year}-${p.month}-${p.day} ${hour}:${p.minute}`;
}

/** YYYY-MM-DD of a date in Singapore time, for <input type="date">. */
export function sgDay(t: number | Date) {
  return fmtIsoLocal(t).slice(0, 10);
}

export function fmtValue(v: number) {
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}
