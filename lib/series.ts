// Server-side data access. The browser never talks to the database directly.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { RAW_LIMIT_DAYS, type MetricId } from './config';

export interface Point {
  t: string;
  device: string;
  v: number;
}

export interface SeriesResult {
  points: Point[];
  bucket: 'raw' | '1 day';
  demo: boolean;
}

export function isDemoMode() {
  return !process.env.SUPABASE_URL || !process.env.SUPABASE_PUBLISHABLE_KEY;
}

export async function getSeries(
  metric: MetricId,
  devices: string[],
  from: Date,
  to: Date,
): Promise<SeriesResult> {
  const spanDays = (to.getTime() - from.getTime()) / 86400_000;
  const bucket = spanDays > RAW_LIMIT_DAYS ? '1 day' : 'raw';

  if (isDemoMode()) return { points: await demoPoints(metric, devices, from, to), bucket: 'raw', demo: true };

  const url = process.env.SUPABASE_URL!.replace(/\/$/, '');
  const key = process.env.SUPABASE_PUBLISHABLE_KEY!;
  const headers: Record<string, string> = { apikey: key, 'content-type': 'application/json' };
  if (key.startsWith('eyJ')) headers.authorization = `Bearer ${key}`; // legacy anon key

  const res = await fetch(`${url}/rest/v1/rpc/get_series`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      p_metric: metric,
      p_devices: devices,
      p_from: from.toISOString(),
      p_to: to.toISOString(),
      p_bucket: bucket === 'raw' ? null : bucket,
    }),
    next: { revalidate: 300 },
  });
  if (!res.ok) throw new Error(`Database query failed (${res.status})`);
  const points = (await res.json()) as Point[];
  return { points, bucket, demo: false };
}

async function demoPoints(metric: MetricId, devices: string[], from: Date, to: Date): Promise<Point[]> {
  const file = await readFile(path.join(process.cwd(), 'data', 'demo.json'), 'utf8');
  const all = JSON.parse(file).points as (Point & { metric: string })[];
  return all
    .filter((p) => p.metric === metric && devices.includes(p.device))
    .filter((p) => {
      const t = Date.parse(p.t);
      return t >= from.getTime() && t <= to.getTime();
    })
    .map(({ t, device, v }) => ({ t, device, v }));
}

/** Latest timestamp in the demo file, so demo ranges end where the data ends. */
export async function demoEnd(): Promise<Date> {
  const file = await readFile(path.join(process.cwd(), 'data', 'demo.json'), 'utf8');
  const pts = JSON.parse(file).points as Point[];
  return new Date(Math.max(...pts.map((p) => Date.parse(p.t))));
}
