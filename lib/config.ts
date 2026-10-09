// Central configuration: which devices and metrics the dashboard knows about.
// Adding a new sensor later means adding it here and in the database, nothing else.

export type MetricId = 'pm25_1h' | 'psi_24h';

export interface Band {
  from: number;
  to: number;
  label: string;
  /** Background tint for the chart. Status colours, never series colours. */
  tint: string | null;
}

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
    alertLabel: 'Hours above 55',
    bands: [
      { from: 0, to: 55, label: 'Normal', tint: null },
      { from: 55, to: 150, label: 'Elevated', tint: 'rgba(250, 178, 25, 0.10)' },
      { from: 150, to: 250, label: 'High', tint: 'rgba(236, 131, 90, 0.14)' },
      { from: 250, to: 500, label: 'Very high', tint: 'rgba(208, 59, 59, 0.14)' },
    ],
    explainer:
      'Hourly average of fine particles (≤ 2.5 µm) for each region. NEA uses this as the best guide for activities over the next few hours.',
  },
  psi_24h: {
    id: 'psi_24h',
    label: 'PSI, 24-hour',
    short: 'PSI (24-hr)',
    unit: '',
    alertFrom: 100,
    alertLabel: 'Hours above 100',
    bands: [
      { from: 0, to: 50, label: 'Good', tint: null },
      { from: 50, to: 100, label: 'Moderate', tint: 'rgba(250, 178, 25, 0.07)' },
      { from: 100, to: 200, label: 'Unhealthy', tint: 'rgba(236, 131, 90, 0.14)' },
      { from: 200, to: 300, label: 'Very unhealthy', tint: 'rgba(208, 59, 59, 0.14)' },
      { from: 300, to: 500, label: 'Hazardous', tint: 'rgba(208, 59, 59, 0.26)' },
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

export const DEVICES: DeviceConfig[] = [
  { id: 'nea-west', name: 'West', color: { light: '#2a78d6', dark: '#3987e5' } },
  { id: 'nea-central', name: 'Central', color: { light: '#eb6834', dark: '#d95926' } },
  { id: 'nea-east', name: 'East', color: { light: '#1baf7a', dark: '#199e70' } },
  { id: 'nea-north', name: 'North', color: { light: '#eda100', dark: '#c98500' } },
  { id: 'nea-south', name: 'South', color: { light: '#e87ba4', dark: '#d55181' } },
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
