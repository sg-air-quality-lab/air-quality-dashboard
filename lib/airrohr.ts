// Translating airRohr / Sensor.Community firmware deliveries into our measures.

export interface AirRohrPayload {
  esp8266id?: string;
  software_version?: string;
  sensordatavalues?: { value_type?: string; value?: string | number }[];
}

/** Which firmware field becomes which of our measures. First match wins. */
const FIELD_MAP: Record<string, string[]> = {
  pm25: ['SDS_P2', 'PMS_P2', 'SPS30_P2', 'HPM_P2', 'SEN5X_P2'],
  pm10: ['SDS_P1', 'PMS_P1', 'SPS30_P1', 'HPM_P1', 'SEN5X_P1'],
  temperature: ['temperature', 'BME280_temperature', 'SHT3X_temperature', 'BMP280_temperature'],
  humidity: ['humidity', 'BME280_humidity', 'SHT3X_humidity'],
};

export function mapAirRohr(payload: AirRohrPayload): Record<string, number> {
  const raw = new Map<string, number>();
  for (const item of payload.sensordatavalues ?? []) {
    if (!item?.value_type) continue;
    const v = typeof item.value === 'number' ? item.value : Number.parseFloat(String(item.value ?? ''));
    if (Number.isFinite(v)) raw.set(item.value_type, v);
  }
  const out: Record<string, number> = {};
  for (const [measure, fields] of Object.entries(FIELD_MAP)) {
    const field = fields.find((f) => raw.has(f));
    if (field) out[measure] = raw.get(field)!;
  }
  return out;
}

/** Login and password from an HTTP Basic Authorization header. */
export function parseBasicAuth(header: string | null): { login: string; password: string } | null {
  if (!header?.startsWith('Basic ')) return null;
  try {
    const decoded = Buffer.from(header.slice(6).trim(), 'base64').toString('utf8');
    const i = decoded.indexOf(':');
    if (i <= 0) return null;
    return { login: decoded.slice(0, i), password: decoded.slice(i + 1) };
  } catch {
    return null;
  }
}
