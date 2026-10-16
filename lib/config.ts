// Central configuration: which devices and metrics the dashboard knows about.
// Adding a new sensor later means adding it here and in the database, nothing else.

export type MetricId = 'pm25_1h' | 'psi_24h';

export interface Band {
  from: number;
  to: number;
  label: string;
  /** Background tint for the chart (legacy; the chart now derives tints from `accent`). */
  tint: string | null;
  /** The band's colour: badges, box edges, dots, the chart line and its background. */
  accent: string;
  /** Text colour on top of `accent` (dark on yellow, white otherwise). */
  onAccent?: string;
  /** Where the band comes from, shown in the explanations. */
  source?: string;
}

// One colour language for air quality everywhere: green, yellow, orange, red, wine.
// Region colours (below) never use these hues.
export const AQ = {
  green: '#2e9e5b',
  yellow: '#e2b20c',
  orange: '#ea7a1e',
  red: '#d83a3a',
  wine: '#a3204f',
};

export interface MetricConfig {
  id: MetricId;
  label: string;
  short: string;
  unit: string;
  /** Value from which an hour counts as "above normal". */
  alertFrom: number;
  alertLabel: string;
  bands: Band[];
  explainer: string;
}

export const METRICS: Record<MetricId, MetricConfig> = {
  pm25_1h: {
    id: 'pm25_1h',
    label: 'PM2.5, 1-hour average',
    short: 'PM2.5 (1-hr)',
    unit: 'µg/m³',
    alertFrom: 55,
    alertLabel: 'Hours Elevated or worse',
    bands: [
      { from: 0, to: 15, label: 'Good', tint: null, accent: AQ.green, source: 'Within the WHO guideline (15 µg/m³ as a daily average)' },
      { from: 15, to: 55, label: 'Normal', tint: null, accent: AQ.yellow, onAccent: '#1f1f1d', source: 'NEA “Normal”, but above the WHO guideline' },
      { from: 55, to: 150, label: 'Elevated', tint: null, accent: AQ.orange, source: 'NEA band II' },
      { from: 150, to: 250, label: 'High', tint: null, accent: AQ.red, source: 'NEA band III' },
      { from: 250, to: 500, label: 'Very high', tint: null, accent: AQ.wine, source: 'NEA band IV' },
    ],
    explainer:
      'Hourly average of fine particles (≤ 2.5 µm) for each region. NEA uses this as the best guide for activities over the next few hours. Green means within the WHO guideline of 15 µg/m³; the other bands follow NEA.',
  },
  psi_24h: {
    id: 'psi_24h',
    label: 'PSI, 24-hour',
    short: 'PSI (24-hr)',
    unit: '',
    alertFrom: 100,
    alertLabel: 'Hours Unhealthy or worse',
    bands: [
      { from: 0, to: 50, label: 'Good', tint: null, accent: AQ.green },
      { from: 50, to: 100, label: 'Moderate', tint: null, accent: AQ.yellow, onAccent: '#1f1f1d' },
      { from: 100, to: 200, label: 'Unhealthy', tint: null, accent: AQ.orange },
      { from: 200, to: 300, label: 'Very unhealthy', tint: null, accent: AQ.red },
      { from: 300, to: 500, label: 'Hazardous', tint: null, accent: AQ.wine },
    ],
    explainer:
      'Pollutant Standards Index over the past 24 hours. It reacts slowly, so it lags behind sudden changes in haze.',
  },
};

export interface DeviceConfig {
  id: string;
  name: string;
  /** Series colour, light and dark mode (fixed per device, never by rank). */
  color: { light: string; dark: string };
}

// Region colours avoid the air-quality colours (green, yellow, orange, red), so a line's colour
// never looks like a band. Central, the school's region, is neutral ink.
export const DEVICES: DeviceConfig[] = [
  { id: 'nea-central', name: 'Central', color: { light: '#1f1f1d', dark: '#f2f1ec' } },
  { id: 'nea-west', name: 'West', color: { light: '#2563eb', dark: '#60a5fa' } },
  { id: 'nea-east', name: 'East', color: { light: '#7c3aed', dark: '#a78bfa' } },
  { id: 'nea-north', name: 'North', color: { light: '#0891b2', dark: '#22d3ee' } },
  { id: 'nea-south', name: 'South', color: { light: '#c026d3', dark: '#e879f9' } },
];

export const DEVICE_IDS = DEVICES.map((d) => d.id);

// ---------------------------------------------------------------- weather

export type WeatherView = 'wind' | 'rainfall' | 'humidity' | 'temperature';
export type WeatherMetricId = 'wind_speed' | 'wind_dir' | 'rainfall' | 'humidity' | 'temperature';

export const WEATHER_VIEWS: { id: WeatherView; label: string; metric: WeatherMetricId; unit: string; title: string }[] = [
  { id: 'wind', label: 'Wind', metric: 'wind_speed', unit: 'km/h', title: 'Wind speed and direction' },
  { id: 'rainfall', label: 'Rain', metric: 'rainfall', unit: 'mm', title: 'Rainfall per hour' },
  { id: 'humidity', label: 'Humidity', metric: 'humidity', unit: '%', title: 'Relative humidity' },
  { id: 'temperature', label: 'Temperature', metric: 'temperature', unit: '°C', title: 'Air temperature' },
];

/** Order of the optional weather panels under the main chart, and the default selection. */
export const PANEL_ORDER: WeatherView[] = ['humidity', 'rainfall', 'wind', 'temperature'];
export const DEFAULT_PANELS: WeatherView[] = []; // clean start: weather only on request

/** NEA's advice for healthy people, by 24-hour PSI band (haze.gov.sg). */
export const PSI_ADVICE: Record<string, string> = {
  Good: 'Normal activities.',
  Moderate: 'Normal activities.',
  Unhealthy: 'Reduce prolonged or strenuous outdoor physical exertion.',
  'Very unhealthy': 'Avoid prolonged or strenuous outdoor physical exertion.',
  Hazardous: 'Minimise outdoor activity.',
};

export const WEATHER_STATIONS = [
  { id: 'nea-ws-S50', name: 'Clementi Road', region: 'West / Central' },
  { id: 'nea-ws-S121', name: 'Old Choa Chu Kang Rd', region: 'West' },
  { id: 'nea-ws-S111', name: 'Scotts Road', region: 'Central' },
  { id: 'nea-ws-S06', name: 'Paya Lebar', region: 'East' },
  { id: 'nea-ws-S104', name: 'Woodlands', region: 'North' },
  { id: 'nea-ws-S116', name: 'Pasir Panjang', region: 'South' },
];

/** Weather series colour: deliberately not one of the region colours. */
export const WEATHER_COLOR = { light: '#4a3aa7', dark: '#9085e9' };

export const ALL_METRIC_IDS: string[] = [...Object.keys(METRICS), 'wind_speed', 'wind_dir', 'rainfall', 'humidity', 'temperature'];
export const ALL_DEVICE_IDS: string[] = [...DEVICE_IDS, ...WEATHER_STATIONS.map((s) => s.id)];

/** Citizen sensors are not listed publicly; they are opened with an unlisted link (?sensor=citizen-…). */
export const CITIZEN_ID = /^citizen-[a-z0-9]{8,}$/;
export const isKnownDevice = (id: string) => ALL_DEVICE_IDS.includes(id) || CITIZEN_ID.test(id);

export const MY_SENSOR_COLOR = { light: '#008300', dark: '#3fae3f' };

/** "SW" for 225°, the direction the wind comes from. */
export function compass(deg: number) {
  const names = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return names[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}

export const RANGE_PRESETS = [
  { id: '24h', label: '24 h', hours: 24 },
  { id: '3d', label: '3 days', hours: 72 },
  { id: '7d', label: '7 days', hours: 168 },
  { id: '30d', label: '30 days', hours: 720 },
  { id: '90d', label: '90 days', hours: 2160 },
] as const;

export type RangePresetId = (typeof RANGE_PRESETS)[number]['id'];

/** Longer ranges are averaged per day so the chart stays fast. */
export const RAW_LIMIT_DAYS = 92;

export const TIME_ZONE = 'Asia/Singapore';
