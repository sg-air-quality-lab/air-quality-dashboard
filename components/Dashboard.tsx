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
  MY_SENSOR_COLOR,
  type MetricId,
  type RangePresetId,
  type WeatherView,
} from '@/lib/config';
import { fmtDateTime, fmtIsoLocal, fmtValue, sgDay } from '@/lib/format';

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
  devices: DEVICES.map((d) => d.id),
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

function readUrl(): State {
  if (typeof window === 'undefined') return DEFAULT_STATE;
  const q = new URLSearchParams(window.location.search);
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

function writeUrl(s: State) {
  const q = new URLSearchParams();
  q.set('metric', s.metric);
  q.set('regions', s.devices.map((d) => d.replace('nea-', '')).join(','));
  if (s.range.preset === 'custom') {
    q.set('from', s.range.from);
    q.set('to', s.range.to);
  } else q.set('range', s.range.preset);
  q.set('panels', s.panels.join(',') || 'none');
  q.set('station', s.station.replace('nea-ws-', ''));
  if (s.sensor) q.set('sensor', s.sensor);
  window.history.replaceState(null, '', `?${q.toString()}`);
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
    setState(readUrl());
    setReady(true);
  }, []);

  useEffect(() => {
    if (ready) writeUrl(state);
  }, [state, ready]);

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

  const status = useMemo(() => {
    if (!now?.pm.length) return null;
    const latestOf = (pts: Point[]) => {
      const t = Math.max(...pts.map((p) => Date.parse(p.t)));
      const top = pts.filter((p) => Date.parse(p.t) === t).sort((a, b) => b.v - a.v)[0];
      return { t, v: top.v, where: DEVICES.find((d) => d.id === top.device)?.name ?? top.device };
    };
    const band = (bands: { from: number; to: number; label: string; accent: string }[], v: number) =>
      bands.find((b) => v >= b.from && v < b.to) ?? bands[bands.length - 1];
    const pm = latestOf(now.pm);
    const psi = now.psi.length ? latestOf(now.psi) : null;
    return {
      pm: { ...pm, band: band(METRICS.pm25_1h.bands, pm.v) },
      psi: psi ? { ...psi, band: band(METRICS.psi_24h.bands, psi.v) } : null,
    };
  }, [now]);

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
    for (const p of pts) {
      if (p.v > peak.v) peak = p;
      sum += p.v;
      if (p.v > metric.alertFrom) above.add(p.t);
    }
    return {
      latest: { value: latest.v, where: name(latest.device), when: fmtDateTime(latestT, daily), t: latestT },
      peak: peak ? { value: peak.v, where: name(peak.device), when: fmtDateTime(peak.t, daily) } : null,
      mean: pts.length ? sum / pts.length : null,
      above: above.size,
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

  const downloadCsv = useCallback(() => {
    const header = ['time_sgt', ...selectedDevices.map((d) => d.name.toLowerCase())];
    const lines = [...table]
      .reverse()
      .map(([t, vals]) => [fmtIsoLocal(t), ...selectedDevices.map((d) => vals[d.id] ?? '')].join(','));
    const csv = [`# ${metric.label} (${metric.unit || 'index'}). Source: NEA via data.gov.sg`, header.join(','), ...lines].join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `singapore-${state.metric}-${fmtIsoLocal(Date.now()).slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [table, selectedDevices, metric, state.metric]);

  const copyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard not available */
    }
  }, []);

  function toggleDevice(id: string) {
    setState((s) => {
      const has = s.devices.includes(id);
      if (has && s.devices.length === 1) return s; // keep at least one region
      return { ...s, devices: has ? s.devices.filter((d) => d !== id) : [...s.devices, id] };
    });
  }

  const today = sgDay(Date.now());
  const custom = state.range.preset === 'custom' ? state.range : null;

  return (
    <main className="page">
      <header className="header">
        <p className="eyebrow">Air Quality Lab · Singapore</p>
        <h1>How is the air today?</h1>
        <p className="lede">Official readings from the National Environment Agency for all five regions, with the weather that explains them.</p>
      </header>

      {data?.demo && (
        <div className="notice" role="status">
          Demo mode: showing a small sample of real NEA readings (West and Central, 7–9 Oct 2026). The live database is not connected yet.
        </div>
      )}

      {status && (
        <section className="status" aria-label="Right now" style={{ ['--accent-band' as string]: (status.psi ?? status.pm).band.accent }}>
          <div className="status-row">
            <div>
              <p className="status-kicker">Right now · PM2.5, last hour</p>
              <p className="status-value">
                <span className="badge" style={{ background: status.pm.band.accent }}>{status.pm.band.label}</span>
                <b>{fmtValue(status.pm.v)}</b> <span className="unit">µg/m³</span>
              </p>
              <p className="status-sub">Highest of the 5 regions: {status.pm.where}</p>
            </div>
            {status.psi && (
              <div>
                <p className="status-kicker">Last 24 hours · PSI</p>
                <p className="status-value">
                  <span className="badge" style={{ background: status.psi.band.accent }}>{status.psi.band.label}</span>
                  <b>{fmtValue(status.psi.v)}</b>
                </p>
                <p className="status-sub">Highest of the 5 regions: {status.psi.where}</p>
              </div>
            )}
          </div>
          {status.psi && (
            <p className="status-advice">
              <b>NEA advice for healthy people:</b> {PSI_ADVICE[status.psi.band.label]} Elderly people, children, pregnant women and people with heart or lung
              conditions should take more care.{' '}
              <a href="https://www.haze.gov.sg" target="_blank" rel="noreferrer">
                Full advisory
              </a>
            </p>
          )}
          <p className="status-foot">
            Latest NEA reading {fmtDateTime(status.pm.t)} · updated every hour
          </p>
        </section>
      )}

      <section className="controls" aria-label="What and when">
        <div className="segmented" role="radiogroup" aria-label="Measure">
          {Object.values(METRICS).map((m) => (
            <button
              key={m.id}
              role="radio"
              aria-checked={state.metric === m.id}
              className={state.metric === m.id ? 'on' : ''}
              onClick={() => setState((s) => ({ ...s, metric: m.id }))}
            >
              {m.short}
            </button>
          ))}
        </div>

        <div className="segmented" role="radiogroup" aria-label="Time range">
          {RANGE_PRESETS.map((p) => (
            <button
              key={p.id}
              role="radio"
              aria-checked={state.range.preset === p.id}
              className={state.range.preset === p.id ? 'on' : ''}
              onClick={() => setState((s) => ({ ...s, range: { preset: p.id } }))}
            >
              {p.label}
            </button>
          ))}
          <button
            role="radio"
            aria-checked={!!custom}
            className={custom ? 'on' : ''}
            onClick={() =>
              setState((s) => ({
                ...s,
                range: { preset: 'custom', from: sgDay(Date.now() - 6 * 86400_000), to: today },
              }))
            }
          >
            Custom
          </button>
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
      </section>

      <section className="card chart-card" aria-busy={loading} aria-label="Chart">
        <div className="chart-head">
          <div className="chips" role="group" aria-label="Regions (tap to show or hide)">
            {DEVICES.map((d) => {
              const on = state.devices.includes(d.id);
              return (
                <button key={d.id} className={`chip ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => toggleDevice(d.id)}>
                  <span className="swatch" style={{ background: dark ? d.color.dark : d.color.light }} aria-hidden />
                  {d.name}
                </button>
              );
            })}
            {state.sensor && state.metric === 'pm25_1h' && (
              <span className="chip on" title="Your own sensor, uncalibrated. Only visible with this link.">
                <span className="swatch dashed" style={{ borderColor: dark ? MY_SENSOR_COLOR.dark : MY_SENSOR_COLOR.light }} aria-hidden />
                My sensor
              </span>
            )}
          </div>
          <button className="ghost" onClick={() => setZoom(null)} disabled={!zoom}>
            Reset zoom
          </button>
        </div>

        {!data?.demo && (
          <div className="panel-bar">
            <span className="panel-bar-label">Weather below:</span>
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
        <div className="chart-notes">
          <p>Drag across any panel to zoom in · scroll to zoom · move the slider · tap a region to show or hide it</p>
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

      <section className="summary" aria-label="Summary of this period">
        <h2 className="summary-title">
          Summary <span>{windowLabel}</span>
        </h2>
        <div className="tiles tiles-3">
          <Tile label="Peak" value={stats?.peak?.value} unit={metric.unit} sub={stats?.peak ? `${stats.peak.where} · ${stats.peak.when}` : ''} metricBands={metric.bands} />
          <Tile label="Average" value={stats?.mean != null ? Math.round(stats.mean * 10) / 10 : undefined} unit={metric.unit} sub="All selected regions" />
          <Tile
            label={daily ? `Days averaging above ${metric.alertFrom}` : metric.alertLabel}
            value={stats?.above}
            unit={daily ? 'days' : 'hours'}
            sub={`Above ${metric.alertFrom} in any selected region`}
          />
        </div>
      </section>

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
        <button onClick={downloadCsv} disabled={!table.length}>
          Download CSV
        </button>
        <button onClick={copyLink}>{copied ? 'Link copied' : 'Copy link to this view'}</button>
      </section>

      <section className="card about">
        <h2>Reading the chart</h2>
        <p>{metric.explainer}</p>
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
