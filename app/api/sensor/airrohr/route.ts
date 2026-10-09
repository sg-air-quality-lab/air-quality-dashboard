// POST /api/sensor/airrohr — the "mailbox" for airRohr sensors ("Send data to custom API").
// The sensor sends its readings with a login and password (HTTP Basic auth).
// The database checks the password and stores the values; this route only translates.

import { NextResponse, type NextRequest } from 'next/server';
import { mapAirRohr, parseBasicAuth, type AirRohrPayload } from '@/lib/airrohr';

export async function POST(req: NextRequest) {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, '');
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return NextResponse.json({ error: 'Not configured' }, { status: 503 });

  const auth = parseBasicAuth(req.headers.get('authorization'));
  if (!auth) return NextResponse.json({ error: 'Login required' }, { status: 401 });

  let payload: AirRohrPayload;
  try {
    payload = (await req.json()) as AirRohrPayload;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const values = mapAirRohr(payload);
  if (!Object.keys(values).length) return NextResponse.json({ stored: 0 });

  const headers: Record<string, string> = { apikey: key, 'content-type': 'application/json' };
  if (key.startsWith('eyJ')) headers.authorization = `Bearer ${key}`;

  const res = await fetch(`${url}/rest/v1/rpc/ingest_reading`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ p_login: auth.login, p_password: auth.password, p_values: values }),
    cache: 'no-store',
  });

  if (!res.ok) {
    const text = await res.text();
    if (text.includes('unauthorized')) return NextResponse.json({ error: 'Wrong login or password' }, { status: 401 });
    console.error('ingest failed', res.status, text);
    return NextResponse.json({ error: 'Could not store readings' }, { status: 502 });
  }
  return NextResponse.json(await res.json());
}
