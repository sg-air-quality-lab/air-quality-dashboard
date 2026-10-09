// GET /api/series?metric=pm25_1h&devices=nea-west,nea-central&from=ISO&to=ISO
// The one "counter" in front of the database: validates the question, then asks Supabase.

import { NextResponse, type NextRequest } from 'next/server';
import { DEVICE_IDS, METRICS, type MetricId } from '@/lib/config';
import { demoEnd, getSeries, isDemoMode } from '@/lib/series';

const MAX_SPAN_DAYS = 366 * 5;

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;

  const metric = q.get('metric') as MetricId | null;
  if (!metric || !(metric in METRICS)) return bad('Unknown metric');

  const devices = (q.get('devices') ?? '').split(',').filter((d) => DEVICE_IDS.includes(d));
  if (devices.length === 0) return bad('Choose at least one region');

  let to = q.get('to') ? new Date(q.get('to')!) : new Date();
  let from = q.get('from') ? new Date(q.get('from')!) : new Date(to.getTime() - 86400_000);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to) return bad('Invalid time range');
  if ((to.getTime() - from.getTime()) / 86400_000 > MAX_SPAN_DAYS) return bad('Time range is too long (max 5 years)');

  // In demo mode, shift "now"-based ranges onto the period the sample data covers.
  if (isDemoMode() && !q.get('fixed')) {
    const end = await demoEnd();
    const span = to.getTime() - from.getTime();
    to = end;
    from = new Date(end.getTime() - span);
  }

  try {
    const result = await getSeries(metric, devices, from, to);
    return NextResponse.json(
      { metric, from: from.toISOString(), to: to.toISOString(), ...result },
      { headers: { 'cache-control': 'public, s-maxage=300, stale-while-revalidate=600' } },
    );
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: 'Could not load data. Please try again later.' }, { status: 502 });
  }
}

function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}
