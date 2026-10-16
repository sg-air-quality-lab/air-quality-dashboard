'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Meteogram, { type ChartSeries, type Panel } from './Meteogram';
import CalibrationChart, { type CalibrationPoint } from './CalibrationChart';
import { sameZoom, type Zoom } from './zoom';
import {
  DEFAULT_PANELS,
  DEVICES,
  METRICS,
  PANEL_ORDER,
  PSI_ADVICE,
  RANGE_PRESETS,
  WEATHER_COLOR,
  WEATHER_STATIONS,
  WEATHER_VIEWS,
  CITIZEN_ID,
  compass,
  MY_SENSOR_COLOR,
  type MetricId,
  type RangePresetId,
  type WeatherView,
} from '@/lib/config';
import { fmtDateTime, fmtIsoLocal, fmtTime, fmtValue, sgDay } from '@/lib/format';
import { buildExportTable, toCsv } from '@/lib/export';
import { buildXlsx, type Cell } from '@/lib/xlsx';

interface Point {
  t: string;
  device: string;
  v: number;
}

interface ApiResult {
  points: Point[];
  bucket: 'raw' | '1 day';
  demo: boolean;
  from: string;
  to: string;
  error?: string;
}

type Range = { preset: RangePresetId } | { preset: 'custom'; from: string; to: string };

interface State {
  metric: MetricId;
  devices: string[];
  range: Range;
  /** Weather panels under the main chart, in PANEL_ORDER. */
  panels: WeatherView[];
  station: string;
  /** Unlisted citizen sensor, only present when opened with ?sensor=… */
  sensor: string | null;
}

const DEFAULT_STATE: State = {
  metric: 'pm25_1h',
  devices: ['nea-central'], // the school's region; tap others to compare
  range: { preset: '3d' },
  panels: DEFAULT_PANELS,
  station: 'nea-ws-S50',
  sensor: null,
};

/** Sorted [time, value] pairs with a null inserted where readings are missing, so lines break instead of bridging. */
function withGaps(points: Point[], device: string, step: number): [number, number | null][] {
  const pts = points
    .filter((p) => p.device === device)
    .map((p) => [Date.parse(p.t), p.v] as [number, number])
    .sort((a, b) => a[0] - b[0]);
  const out: [number, number | null][] = [];
  pts.forEach((p, i) => {
    if (i > 0 && p[0] - pts[i - 1][0] > step * 1.5) out.push([pts[i - 1][0] + step, null]);
    out.push(p);
  });
  return out;
}

// The app always opens in its clean default view (Central, 3 days, no weather), even from an old
// bookmark or home-screen icon. Only links made with "Copy link to this view" (marked view=1)
// open a specific view. The private ?sensor= link is always honoured.
function readUrl(): State {
  if (typeof window === 'undefined') return DEFAULT_STATE;
  const q = new URLSearchParams(window.location.search);
  const sensorOnly = CITIZEN_ID.test(q.get('sensor') ?? '') ? q.get('sensor') : null;
  if (q.get('view') !== '1') return { ...DEFAULT_STATE, sensor: sensorOnly };
  const metric = (q.get('metric') as MetricId) in METRICS ? (q.get('metric') as MetricId) : DEFAULT_STATE.metric;
  const regions = (q.get('regions') ?? '')
    .split(',')
    .map((r) => `nea-${r}`)
    .filter((id) => DEVICES.some((d) => d.id === id));
  const from = q.get('from');
  const to = q.get('to');
  const preset = q.get('range');
  let range: Range = DEFAULT_STATE.range;
  if (from && to && /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to)) range = { preset: 'custom', from, to };
  else if (RANGE_PRESETS.some((p) => p.id === preset)) range = { preset: preset as RangePresetId };
  // `panels=humidity,wind`; older links used a single `weather=…`.
  const rawPanels = q.has('panels') ? (q.get('panels') ?? '').split(',') : q.has('weather') ? [q.get('weather') ?? ''] : null;
  const panels = rawPanels ? PANEL_ORDER.filter((id) => rawPanels.includes(id)) : DEFAULT_STATE.panels;
  const station = WEATHER_STATIONS.some((w) => w.id === `nea-ws-${q.get('station')}`) ? `nea-ws-${q.get('station')}` : DEFAULT_STATE.station;
  const sensor = CITIZEN_ID.test(q.get('sensor') ?? '') ? q.get('sensor') : null;
  return { metric, devices: regions.length ? regions : DEFAULT_STATE.devices, range, panels, station, sensor };
}

/** A link that opens exactly this view. */
function shareUrl(s: State) {
  const q = new URLSearchParams();
  q.set('view', '1');
  q.set('metric', s.metric);
  q.set('regions', s.devices.map((d) => d.replace('nea-', '')).join(','));
  if (s.range.preset === 'custom') {
    q.set('from', s.range.from);
    q.set('to', s.range.to);
  } else q.set('range', s.range.preset);
  q.set('panels', s.panels.join(',') || 'none');
  q.set('station', s.station.replace('nea-ws-', ''));
  if (s.sensor) q.set('sensor', s.sensor);
  return `${window.location.origin}${window.location.pathname}?${q.toString()}`;
}

/** Keep the address bar clean, so bookmarks and home-screen icons open the default view. */
function cleanAddressBar(sensor: string | null) {
  const clean = sensor ? `?sensor=${sensor}` : window.location.pathname;
  if (window.location.search !== (sensor ? `?sensor=${sensor}` : '')) window.history.replaceState(null, '', clean);
}

function rangeToQuery(r: Range): string {
  if (r.preset === 'custom') {
    const from = new Date(`${r.from}T00:00:00+08:00`);
    const to = new Date(`${r.to}T23:59:59+08:00`);
    return `from=${from.toISOString()}&to=${to.toISOString()}&fixed=1`;
  }
  const hours = RANGE_PRESETS.find((p) => p.id === r.preset)!.hours;
  const to = new Date();
  const from = new Date(to.getTime() - hours * 3600_000);
  return `from=${from.toISOString()}&to=${to.toISOString()}`;
}

function useDarkMode() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    setDark(mq.matches);
    const on = (e: MediaQueryListEvent) => setDark(e.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return dark;
}

export default function Dashboard() {
  const [state, setState] = useState<State>(DEFAULT_STATE);
  const [ready, setReady] = useState(false);
  const [data, setData] = useState<ApiResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState<Zoom>(null);
  const onZoom = useCallback((z: Zoom) => setZoom((prev) => (sameZoom(prev, z) ? prev : z)), []);
  const [copied, setCopied] = useState(false);
  const [weatherData, setWeatherData] = useState<{ byMetric: Record<string, Point[]>; key: string } | null>(null);
  const [now, setNow] = useState<{ pm: Point[]; psi: Point[] } | null>(null);
  const [weatherError, setWeatherError] = useState<string | null>(null);
  const [calibration, setCalibration] = useState<CalibrationPoint[] | null>(null);
  const dark = useDarkMode();

  useEffect(() => {
    const initial = readUrl();
    setState(initial);
    setReady(true);
    cleanAddressBar(initial.sensor);
  }, []);

  // A new period starts unzoomed.
  useEffect(() => setZoom(null), [state.range]);

  useEffect(() => {
    if (!ready) return;
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    const devices = state.sensor && state.metric === 'pm25_1h' ? [...state.devices, state.sensor] : state.devices;
    fetch(`/api/series?metric=${state.metric}&devices=${devices.join(',')}&${rangeToQuery(state.range)}`, {
      signal: ctrl.signal,
    })
      .then(async (r) => {
        const json = (await r.json()) as ApiResult;
        if (!r.ok) throw new Error(json.error ?? 'Could not load data');
        setData(json);
      })
      .catch((e: Error) => {
        if (e.name !== 'AbortError') setError(e.message);
      })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.metric, state.devices, state.range, state.sensor, ready]);

  // Weather panels for exactly the same time window as the main chart.
  useEffect(() => {
    if (!data || data.demo || !state.panels.length) return;
    const metrics = state.panels.map((id) => WEATHER_VIEWS.find((w) => w.id === id)!.metric as string);
    if (state.panels.includes('wind')) metrics.push('wind_dir');
    const ctrl = new AbortController();
    const q = (metric: string) =>
      fetch(`/api/series?metric=${metric}&devices=${state.station}&from=${data.from}&to=${data.to}&fixed=1`, { signal: ctrl.signal }).then(
        async (r) => {
          const json = (await r.json()) as ApiResult;
          if (!r.ok) throw new Error(json.error ?? 'Could not load weather data');
          return [metric, json.points] as const;
        },
      );
    setWeatherError(null);
    Promise.all(metrics.map(q))
      .then((pairs) => setWeatherData({ byMetric: Object.fromEntries(pairs), key: `${data.from}|${state.station}` }))
      .catch((e: Error) => {
        if (e.name !== 'AbortError') setWeatherError(e.message);
      });
    return () => ctrl.abort();
  }, [data, state.panels, state.station]);

  // "Right now": latest PM2.5 and 24-hour PSI for all regions, independent of the chart settings.
  useEffect(() => {
    const load = () => {
      const to = new Date();
      const from = new Date(to.getTime() - 6 * 3600_000);
      const q = (metric: string) =>
        fetch(`/api/series?metric=${metric}&devices=${DEVICES.map((d) => d.id).join(',')}&from=${from.toISOString()}&to=${to.toISOString()}`)
          .then((r) => r.json() as Promise<ApiResult>)
          .then((j) => j.points ?? []);
      Promise.all([q('pm25_1h'), q('psi_24h')])
        .then(([pm, psi]) => setNow({ pm, psi }))
        .catch(() => setNow(null));
    };
    load();
    const id = setInterval(load, 10 * 60_000);
    return () => clearInterval(id);
  }, []);

  // Calibration: always the last 14 days, own sensor vs the mean of NEA West and Central.
  useEffect(() => {
    if (!state.sensor) return;
    const ctrl = new AbortController();
    const to = new Date();
    const from = new Date(to.getTime() - 14 * 86400_000);
    const q = (metric: string, devices: string) =>
      fetch(`/api/series?metric=${metric}&devices=${devices}&from=${from.toISOString()}&to=${to.toISOString()}&fixed=1`, {
        signal: ctrl.signal,
      }).then((r) => r.json() as Promise<ApiResult>);
    Promise.all([q('pm25_1h', `nea-west,nea-central,${state.sensor}`), q('humidity', state.sensor)])
      .then(([pm, hum]) => {
        const byT = new Map<number, { nea: number[]; mine?: number; hum?: number }>();
        const slot = (t: string) => {
          const k = Date.parse(t);
          if (!byT.has(k)) byT.set(k, { nea: [] });
          return byT.get(k)!;
        };
        for (const p of pm.points ?? []) {
          if (p.device === state.sensor) slot(p.t).mine = p.v;
          else slot(p.t).nea.push(p.v);
        }
        for (const p of hum.points ?? []) slot(p.t).hum = p.v;
        const pts: CalibrationPoint[] = [];
        for (const [t, s] of byT) {
          if (s.mine == null || s.hum == null || !s.nea.length) continue;
          const ref = s.nea.reduce((a, b) => a + b, 0) / s.nea.length;
          if (ref < 10) continue; // tiny reference values make the ratio meaningless
          pts.push({ t, humidity: s.hum, ratio: Math.round((s.mine / ref) * 100) / 100 });
        }
        setCalibration(pts.sort((a, b) => a.t - b.t));
      })
      .catch(() => setCalibration([]));
    return () => ctrl.abort();
  }, [state.sensor]);

  const calibrationSummary = useMemo(() => {
    if (!calibration?.length) return null;
    const median = (xs: number[]) => {
      if (!xs.length) return null;
      const s = [...xs].sort((a, b) => a - b);
      const m = Math.floor(s.length / 2);
      return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
    };
    return {
      all: median(calibration.map((p) => p.ratio)),
      dry: median(calibration.filter((p) => p.humidity < 75).map((p) => p.ratio)),
      humid: median(calibration.filter((p) => p.humidity >= 85).map((p) => p.ratio)),
      hours: calibration.length,
    };
  }, [calibration]);

  const metric = METRICS[state.metric];
  const daily = data?.bucket === '1 day';

  const step = daily ? 86400_000 : 3600_000;
  const xMin = data ? Date.parse(data.from) : undefined;
  const xMax = data ? Date.parse(data.to) : undefined;

  const chartSeries: ChartSeries[] = useMemo(() => {
    if (!data) return [];
    const series: ChartSeries[] = DEVICES.filter((d) => state.devices.includes(d.id)).map((d) => ({
      id: d.id,
      name: d.name,
      color: dark ? d.color.dark : d.color.light,
      data: withGaps(data.points, d.id, step),
    }));
    if (state.sensor && data.points.some((p) => p.device === state.sensor)) {
      series.push({
        id: state.sensor,
        name: 'My sensor (uncalibrated)',
        color: dark ? MY_SENSOR_COLOR.dark : MY_SENSOR_COLOR.light,
        data: withGaps(data.points, state.sensor, step),
        dashed: true,
      });
    }
    return series;
  }, [data, state.devices, state.sensor, dark, step]);

  // Only the official NEA values count for the summary, table and CSV.
  const neaPoints = useMemo(() => (data?.points ?? []).filter((p) => p.device.startsWith('nea-')), [data]);

  const weatherStation = WEATHER_STATIONS.find((w) => w.id === state.station)!;
  const panels: Panel[] = useMemo(() => {
    if (!data || data.demo || !weatherData) return [];
    return state.panels.flatMap((id) => {
      const view = WEATHER_VIEWS.find((w) => w.id === id)!;
      const pts = weatherData.byMetric[view.metric];
      if (!pts) return [];
      return [
        {
          id,
          name: view.label,
          unit: view.unit,
          values: withGaps(pts, state.station, step),
          directions: id === 'wind' ? (weatherData.byMetric.wind_dir ?? []).map((p) => [Date.parse(p.t), p.v] as [number, number]) : undefined,
        },
      ];
    });
  }, [data, weatherData, state.panels, state.station, step]);

  // The "now" boxes describe one region: the only selected one, otherwise Central (the school's region).
  const focusId = state.devices.length === 1 ? state.devices[0] : state.devices.includes('nea-central') ? 'nea-central' : state.devices[0];
  const focusName = DEVICES.find((d) => d.id === focusId)?.name ?? focusId;

  const status = useMemo(() => {
    if (!now?.pm.length) return null;
    const band = (bands: { from: number; to: number; label: string; accent: string }[], v: number) =>
      bands.find((b) => v >= b.from && v < b.to) ?? bands[bands.length - 1];
    const name = (id: string) => DEVICES.find((d) => d.id === id)?.name ?? id;
    const summarise = (pts: Point[], bands: { from: number; to: number; label: string; accent: string }[]) => {
      if (!pts.length) return null;
      const t = Math.max(...pts.map((p) => Date.parse(p.t)));
      const atT = pts.filter((p) => Date.parse(p.t) === t);
      const top = [...atT].sort((x, y) => y.v - x.v)[0];
      const mine = atT.find((p) => p.device === focusId);
      const before = pts.find((p) => p.device === focusId && Date.parse(p.t) === t - 3600_000);
      const v = mine?.v ?? top.v;
      return {
        t,
        v,
        band: band(bands, v),
        where: mine ? name(focusId) : name(top.device),
        change: mine && before ? Math.round((mine.v - before.v) * 10) / 10 : null,
        highest: { v: top.v, where: name(top.device) },
        perRegion: Object.fromEntries(atT.map((p) => [p.device, p.v])) as Record<string, number>,
      };
    };
    const pm = summarise(now.pm, METRICS.pm25_1h.bands)!;
    const psi = summarise(now.psi, METRICS.psi_24h.bands);
    return {
      pm,
      psi,
      regions: { pm25_1h: pm.perRegion, psi_24h: psi?.perRegion ?? {} } as Record<MetricId, Record<string, number>>,
    };
  }, [now, focusId]);

  function togglePanel(id: WeatherView) {
    setState((s) => ({
      ...s,
      panels: PANEL_ORDER.filter((p) => (p === id ? !s.panels.includes(id) : s.panels.includes(p))),
    }));
  }

  const stats = useMemo(() => {
    if (!neaPoints.length) return null;
    const name = (id: string) => DEVICES.find((d) => d.id === id)?.name ?? id;
    // "Latest" always means now; the other numbers follow the zoomed window.
    let latestT = 0;
    for (const p of neaPoints) latestT = Math.max(latestT, Date.parse(p.t));
    const latest = neaPoints.filter((p) => Date.parse(p.t) === latestT).sort((a, b) => b.v - a.v)[0];
    const pts = zoom ? neaPoints.filter((p) => Date.parse(p.t) >= zoom.from && Date.parse(p.t) <= zoom.to) : neaPoints;
    let peak = pts[0];
    let sum = 0;
    const above = new Set<string>();
    const slots = new Set<string>();
    for (const p of pts) {
      if (p.v > peak.v) peak = p;
      sum += p.v;
      slots.add(p.t);
      if (p.v > metric.alertFrom) above.add(p.t);
    }
    return {
      latest: { value: latest.v, where: name(latest.device), when: fmtDateTime(latestT, daily), t: latestT },
      peak: peak ? { value: peak.v, where: name(peak.device), when: fmtDateTime(peak.t, daily) } : null,
      mean: pts.length ? sum / pts.length : null,
      above: above.size,
      slots: slots.size,
    };
  }, [neaPoints, metric, daily, zoom]);

  const hour = (t: number) => Math.round(t / 3600_000) * 3600_000;
  const windowLabel = zoom
    ? `${fmtDateTime(hour(zoom.from), daily)} – ${fmtDateTime(hour(zoom.to), daily)} (zoomed in)`
    : data
      ? `${fmtDateTime(hour(Date.parse(data.from)), daily)} – ${fmtDateTime(hour(Date.parse(data.to)), daily)}`
      : '';

  const table = useMemo(() => {
    const byT = new Map<string, Record<string, number>>();
    for (const p of neaPoints) {
      const key = new Date(p.t).toISOString();
      byT.set(key, { ...(byT.get(key) ?? {}), [p.device]: p.v });
    }
    return [...byT.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [neaPoints]);

  const selectedDevices = DEVICES.filter((d) => state.devices.includes(d.id));

  // The download contains exactly what is on screen: selected regions, weather panels and the visible time window.
  const exportTable = useCallback(() => {
    const weatherReady = !!weatherData && !data?.demo && weatherData.key === `${data?.from}|${state.station}`;
    const weather = weatherReady
      ? PANEL_ORDER.filter((id) => state.panels.includes(id)).flatMap((id) => {
          const view = WEATHER_VIEWS.find((w) => w.id === id)!;
          const points = weatherData!.byMetric[view.metric];
          if (!points) return [];
          const label = id === 'wind' ? 'Wind speed' : view.title.replace(' per hour', '');
          return [{ label, unit: view.unit, points, directions: id === 'wind' ? weatherData!.byMetric.wind_dir : undefined }];
        })
      : [];
    return buildExportTable({
      metricShort: state.metric === 'psi_24h' ? 'PSI' : 'PM2.5',
      unit: metric.unit,
      regions: selectedDevices.map((d) => ({ id: d.id, name: d.name })),
      points: neaPoints,
      weather,
      window: zoom,
      compass,
    });
  }, [weatherData, data, state.station, state.panels, state.metric, metric.unit, selectedDevices, neaPoints, zoom]);

  const saveFile = (blob: Blob, ext: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `singapore-air-quality-${fmtIsoLocal(Date.now()).slice(0, 10)}.${ext}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const downloadExcel = useCallback(() => {
    const t = exportTable();
    const dataRows: Cell[][] = t.rows.map(([time, ...vals]) => [{ time }, ...vals]);
    const info: Cell[][] = [
      ['Singapore air quality: data export'],
      [],
      ['Values', `${metric.label}${metric.unit ? ` (${metric.unit})` : ''}`],
      ['Regions', selectedDevices.map((d) => d.name).join(', ')],
      ...(t.columns.length > selectedDevices.length + 1 ? [['Weather station', weatherStation.name] as Cell[]] : []),
      ['Period', windowLabel],
      ['Times', daily ? 'Singapore time, daily averages' : 'Singapore time, hourly values. Empty cells: no reading.'],
      ['Created', fmtIsoLocal(Date.now())],
      ['Link to this view', shareUrl(state)],
      [],
      ['Source', 'Contains information from the National Environment Agency (NEA), accessed via data.gov.sg, licensed under the Singapore Open Data Licence.'],
    ];
    const bytes = buildXlsx([
      { name: 'Data', header: t.columns.map((c) => c.header), rows: dataRows, widths: t.columns.map((c, i) => (i === 0 ? 18 : Math.max(12, c.header.length + 2))) },
      { name: 'Info', rows: info, widths: [20, 100] },
    ]);
    saveFile(new Blob([bytes as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'xlsx');
  }, [exportTable, metric, selectedDevices, weatherStation, windowLabel, daily, state]);

  const downloadCsv = useCallback(() => {
    // The byte-order mark tells Excel the file is UTF-8, so µg/m³ and °C show correctly.
    const csv = '﻿' + toCsv(exportTable(), (t) => fmtIsoLocal(t));
    saveFile(new Blob([csv], { type: 'text/csv;charset=utf-8' }), 'csv');
  }, [exportTable]);

  const copyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(shareUrl(state));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard not available */
    }
  }, [state]);

  function toggleDevice(id: string) {
    setState((s) => {
      const has = s.devices.includes(id);
      if (has && s.devices.length === 1) return s; // keep at least one region
      return { ...s, devices: has ? s.devices.filter((d) => d !== id) : [...s.devices, id] };
    });
  }

  const today = sgDay(Date.now());
  const custom = state.range.preset === 'custom' ? state.range : null;
  const periodLabel = zoom ? 'zoomed' : custom ? `${custom.from.slice(5).replace('-', '.')}–${custom.to.slice(5).replace('-', '.')}` : `last ${RANGE_PRESETS.find((p) => p.id === state.range.preset)?.label ?? ''}`;

  return (
    <main className="page">
      <header className="topbar">
        <div>
          <p className="eyebrow">Air Quality Lab · Singapore</p>
          <h1>How is the air today?</h1>
        </div>
        {status && <p className="updated">Updated {fmtTime(status.pm.t)}</p>}
      </header>

      {data?.demo && (
        <div className="notice" role="status">
          Demo mode: showing a small sample of real NEA readings (West and Central, 7–9 Oct 2026). The live database is not connected yet.
        </div>
      )}

      <div className="glance">
        <section className="now" aria-label="At a glance">
          <div className="now-tiles">
            <NowTile
              kicker="PM2.5 · now"
              value={status?.pm.v}
              unit="µg/m³"
              band={status?.pm.band}
              change={status?.pm.change}
              sub={status ? subFor(status.pm, focusName) : 'Loading…'}
              selected={state.metric === 'pm25_1h'}
              onSelect={() => setState((s) => ({ ...s, metric: 'pm25_1h' }))}
            />
            <NowTile
              kicker="PSI · 24 hours"
              value={status?.psi?.v}
              band={status?.psi?.band}
              change={status?.psi?.change}
              sub={status?.psi ? subFor(status.psi, focusName) : status ? 'No reading' : 'Loading…'}
              selected={state.metric === 'psi_24h'}
              onSelect={() => setState((s) => ({ ...s, metric: 'psi_24h' }))}
            />
            <PeriodTile
              kicker={`Peak · ${periodLabel}`}
              value={stats?.peak?.value}
              unit={metric.unit}
              band={stats?.peak ? metric.bands.find((x) => stats.peak!.value >= x.from && stats.peak!.value < x.to) : undefined}
              lines={stats?.peak ? [(selectedDevices.length > 1 ? `${stats.peak.where} · ` : '') + stats.peak.when.replace(/^[A-Za-z]{3}, /, '')] : []}
            />
            <PeriodTile
              kicker={`Average · ${periodLabel}`}
              value={stats?.mean != null ? Math.round(stats.mean * 10) / 10 : undefined}
              unit={metric.unit}
              lines={
                stats
                  ? [
                      `Above ${metric.alertFrom}: ${stats.above} of ${stats.slots} ${daily ? 'days' : 'h'}`,
                      ...(selectedDevices.length > 1 ? [`${selectedDevices.length} regions together`] : []),
                    ]
                  : []
              }
            />
          </div>
        </section>

        <section className="card chart-card" aria-busy={loading} aria-label="Chart">
          <div className="chart-top">
            <h2>{state.metric === 'psi_24h' ? 'PSI, 24-hour' : 'PM2.5, hourly'}</h2>
            <div className="segmented range" role="radiogroup" aria-label="Time range">
              {RANGE_PRESETS.map((p) => (
                <button
                  key={p.id}
                  role="radio"
                  aria-checked={state.range.preset === p.id}
                  aria-label={p.label}
                  className={state.range.preset === p.id ? 'on' : ''}
                  onClick={() => setState((s) => ({ ...s, range: { preset: p.id } }))}
                >
                  {p.id}
                </button>
              ))}
              <button
                role="radio"
                aria-checked={!!custom}
                aria-label="Choose dates"
                className={custom ? 'on' : ''}
                onClick={() =>
                  setState((s) => ({
                    ...s,
                    range: { preset: 'custom', from: sgDay(Date.now() - 6 * 86400_000), to: today },
                  }))
                }
              >
                Dates
              </button>
            </div>
          </div>

          {custom && (
            <div className="dates">
              <label>
                From
                <input
                  type="date"
                  value={custom.from}
                  max={custom.to}
                  onChange={(e) => e.target.value && setState((s) => ({ ...s, range: { ...custom, from: e.target.value } }))}
                />
              </label>
              <label>
                To
                <input
                  type="date"
                  value={custom.to}
                  min={custom.from}
                  max={today}
                  onChange={(e) => e.target.value && setState((s) => ({ ...s, range: { ...custom, to: e.target.value } }))}
                />
              </label>
            </div>
          )}

          <div className="regions" role="group" aria-label="Regions (tap to show or hide)">
            {DEVICES.map((d) => {
              const on = state.devices.includes(d.id);
              const v = status?.regions[state.metric]?.[d.id];
              return (
                <button key={d.id} className={`region ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => toggleDevice(d.id)}>
                  <span className="swatch" style={{ background: dark ? d.color.dark : d.color.light }} aria-hidden />
                  <span className="region-name">{d.name}</span>
                  <span className="region-value">{v != null ? fmtValue(v) : '–'}</span>
                </button>
              );
            })}
            {state.sensor && state.metric === 'pm25_1h' && (
              <span className="region on" title="Your own sensor, uncalibrated. Only visible with this link.">
                <span className="swatch dashed" style={{ borderColor: dark ? MY_SENSOR_COLOR.dark : MY_SENSOR_COLOR.light }} aria-hidden />
                <span className="region-name">My sensor</span>
                <span className="region-value">raw</span>
              </span>
            )}
          </div>

          {error ? (
            <div className="empty">{error}</div>
          ) : data && !data.points.length && !loading ? (
            <div className="empty">No readings for this period yet.</div>
          ) : (
            <Meteogram
              series={chartSeries}
              metric={metric}
              panels={panels}
              weatherColor={dark ? WEATHER_COLOR.dark : WEATHER_COLOR.light}
              daily={daily}
              dark={dark}
              xMin={xMin}
              xMax={xMax}
              zoom={zoom}
              onZoom={onZoom}
            />
          )}
          {loading && <div className="loading" aria-hidden />}
          {zoom && (
            <button className="ghost reset-zoom" onClick={() => setZoom(null)}>
              Show whole period
            </button>
          )}

          {!data?.demo && (
            <div className="panel-bar">
              <span className="panel-bar-label">Weather:</span>
              <div className="chips" role="group" aria-label="Weather panels">
                {PANEL_ORDER.map((id) => {
                  const view = WEATHER_VIEWS.find((w) => w.id === id)!;
                  const on = state.panels.includes(id);
                  return (
                    <button key={id} className={`chip small ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => togglePanel(id)}>
                      {on ? '✓ ' : '+ '}
                      {view.label}
                    </button>
                  );
                })}
              </div>
              {state.panels.length > 0 && (
                <label className="select">
                  Station
                  <select value={state.station} onChange={(e) => setState((s) => ({ ...s, station: e.target.value }))}>
                    {WEATHER_STATIONS.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name} ({w.region})
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          )}

          <div className="chart-notes">
            <p>Tap or hover for values · drag the slider to zoom · tap a region to show or hide it</p>
            {daily && <p>Long period: values are daily averages.</p>}
            {weatherError && <p>Weather: {weatherError}</p>}
            {state.panels.length > 0 && !data?.demo && (
              <p>
                Weather from NEA station {weatherStation.name}.{state.panels.includes('wind') && !daily ? ' Arrows show where the wind blows to (up = north).' : ''} A gap
                means the station sent no data.
              </p>
            )}
          </div>
        </section>
      </div>


      {state.sensor && (
        <section className="card chart-card" aria-label="My sensor calibration">
          <div className="chart-head">
            <div>
              <h2>My sensor compared with NEA</h2>
              <p className="hint">
                Last 14 days, hour by hour: your sensor divided by the average of NEA West and Central. This view is not linked from the
                public page.
              </p>
            </div>
          </div>
          {calibration == null ? (
            <div className="empty small">Loading…</div>
          ) : calibration.length < 6 ? (
            <div className="empty small">Not enough data yet. After about a day of readings from your sensor, the comparison appears here.</div>
          ) : (
            <>
              <div className="tiles tiles-3">
                <Tile label="Overall" value={calibrationSummary?.all ?? undefined} unit="× NEA" sub={`${calibrationSummary?.hours} hours compared`} />
                <Tile
                  label="When humidity is below 75%"
                  value={calibrationSummary?.dry ?? undefined}
                  unit="× NEA"
                  sub={calibrationSummary?.dry == null ? 'No dry hours yet' : 'Drier air'}
                />
                <Tile
                  label="When humidity is 85% or more"
                  value={calibrationSummary?.humid ?? undefined}
                  unit="× NEA"
                  sub={calibrationSummary?.humid == null ? 'No humid hours yet' : 'Humid air'}
                />
              </div>
              <CalibrationChart points={calibration} color={dark ? MY_SENSOR_COLOR.dark : MY_SENSOR_COLOR.light} dark={dark} />
              <p className="hint">
                1× means your sensor agrees with NEA. If the dots rise to the right, humidity makes your sensor read too high: water makes
                the particles swell.
              </p>
            </>
          )}
        </section>
      )}

      <section className="actions">
        <p className="actions-note">The download contains the regions and weather panels shown above, for the time window you see.</p>
        <button className="primary" onClick={downloadExcel} disabled={!table.length}>
          Download for Excel
        </button>
        <button onClick={downloadCsv} disabled={!table.length}>
          CSV
        </button>
        <button onClick={copyLink}>{copied ? 'Link copied' : 'Copy link to this view'}</button>
      </section>

      <section className="card about">
        <h2>About this page</h2>
          {status?.psi && (
          <p className="advice">
            <b>NEA advice:</b> {PSI_ADVICE[status.psi.band.label]}{' '}
            <a href="https://www.haze.gov.sg" target="_blank" rel="noreferrer">
              More
            </a>
          </p>
        )}
        <p>Official readings from the National Environment Agency for all five regions, with the weather that explains them. {metric.explainer}</p>
        <ul className="bands">
          {metric.bands.map((b) => (
            <li key={b.label}>
              <span className="band-swatch" style={{ background: b.tint ?? 'transparent' }} aria-hidden />
              <b>{b.label}</b> {b.to === 500 ? `above ${b.from}` : `${b.from}–${b.to}`}
            </li>
          ))}
        </ul>
        <p className="muted">Each region value comes from NEA's monitoring in that part of Singapore, so conditions in your street can differ.</p>
      </section>

      <details className="card table-card">
        <summary>Show the data as a table</summary>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Time (SGT)</th>
                {selectedDevices.map((d) => (
                  <th key={d.id} scope="col">{d.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.slice(0, 240).map(([t, vals]) => (
                <tr key={t}>
                  <td>{fmtDateTime(t, daily)}</td>
                  {selectedDevices.map((d) => (
                    <td key={d.id}>{vals[d.id] != null ? fmtValue(vals[d.id]) : '–'}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {table.length > 240 && <p className="muted">Showing the latest 240 rows. Download the CSV for everything.</p>}
        </div>
      </details>

      <footer className="footer">
        <p>
          Contains information from the National Environment Agency, accessed via{' '}
          <a href="https://data.gov.sg" target="_blank" rel="noreferrer">data.gov.sg</a>, licensed under the{' '}
          <a href="https://data.gov.sg/open-data-licence" target="_blank" rel="noreferrer">Singapore Open Data Licence</a>.
        </p>
        <p>
          Open source ·{' '}
          <a href="https://github.com/sg-air-quality-lab/air-quality-dashboard" target="_blank" rel="noreferrer">
            Code on GitHub
          </a>{' '}
          · For health advice, follow NEA and MOH guidance.
        </p>
      </footer>
    </main>
  );
}

function NowTile({
  kicker,
  value,
  unit,
  band,
  sub,
  selected,
  onSelect,
  change,
}: {
  kicker: string;
  value?: number;
  unit?: string;
  band?: { label: string; accent: string };
  change?: number | null;
  sub: string;
  selected: boolean;
  onSelect: () => void;
}) {
  const trend = change == null ? null : change > 0 ? `↑ +${fmtValue(change)}` : change < 0 ? `↓ −${fmtValue(-change)}` : '→ 0';
  return (
    <button
      className={`now-tile ${selected ? 'on' : ''}`}
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      style={{ ['--band' as string]: band?.accent ?? 'var(--ring)' }}
    >
      <span className="now-kicker">{kicker}</span>
      <span className="now-value">
        {value != null ? fmtValue(value) : '–'}
        {value != null && unit && <span className="now-unit"> {unit}</span>}
      </span>
      <span className="now-line">
        {band && <span className="badge" style={{ background: band.accent }}>{band.label}</span>}
        {trend && (
          <span className="trend" title="Change since the hour before">
            {trend}
          </span>
        )}
      </span>
      <span className="now-sub">{sub}</span>
    </button>
  );
}

function PeriodTile({
  kicker,
  value,
  unit,
  band,
  lines,
}: {
  kicker: string;
  value?: number;
  unit?: string;
  band?: { label: string; accent: string };
  lines: string[];
}) {
  return (
    <div className="now-tile period" style={{ ['--band' as string]: band?.accent ?? 'var(--ring)' }}>
      <span className="now-kicker">{kicker}</span>
      <span className="now-value">
        {value != null ? fmtValue(value) : '–'}
        {value != null && unit && <span className="now-unit"> {unit}</span>}
      </span>
      {lines.map((l, i) => (
        <span key={l} className="now-sub">
          {i === 0 && band && <span className="tag">{band.label}</span>}
          {l}
        </span>
      ))}
    </div>
  );
}

/** "Central" or "Central · highest: East 160" when another region is higher. */
function subFor(x: { where: string; highest: { v: number; where: string } }, focus: string) {
  return x.where === x.highest.where ? `${x.where} (highest region)` : `${focus} · highest: ${x.highest.where} ${fmtValue(x.highest.v)}`;
}

function Tile({
  label,
  value,
  unit,
  sub,
  metricBands,
}: {
  label: string;
  value?: number;
  unit: string;
  sub: string;
  metricBands?: { from: number; to: number; label: string }[];
}) {
  const band = value != null && metricBands ? metricBands.find((b) => value >= b.from && value < b.to)?.label : undefined;
  return (
    <div className="tile">
      <p className="tile-label">{label}</p>
      <p className="tile-value">
        {value != null ? fmtValue(value) : '–'}
        {value != null && unit && <span className="tile-unit"> {unit}</span>}
      </p>
      <p className="tile-sub">
        {band && <span className="tag">{band}</span>}
        {sub}
      </p>
    </div>
  );
}
