'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import AirChart, { type ChartSeries } from './AirChart';
import { DEVICES, METRICS, RANGE_PRESETS, type MetricId, type RangePresetId } from '@/lib/config';
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
}

const DEFAULT_STATE: State = {
  metric: 'pm25_1h',
  devices: DEVICES.map((d) => d.id),
  range: { preset: '3d' },
};

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
  return { metric, devices: regions.length ? regions : DEFAULT_STATE.devices, range };
}

function writeUrl(s: State) {
  const q = new URLSearchParams();
  q.set('metric', s.metric);
  q.set('regions', s.devices.map((d) => d.replace('nea-', '')).join(','));
  if (s.range.preset === 'custom') {
    q.set('from', s.range.from);
    q.set('to', s.range.to);
  } else q.set('range', s.range.preset);
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
  const [resetKey, setResetKey] = useState(0);
  const [copied, setCopied] = useState(false);
  const dark = useDarkMode();

  useEffect(() => {
    setState(readUrl());
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    writeUrl(state);
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    fetch(`/api/series?metric=${state.metric}&devices=${state.devices.join(',')}&${rangeToQuery(state.range)}`, {
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
  }, [state, ready]);

  const metric = METRICS[state.metric];
  const daily = data?.bucket === '1 day';

  const chartSeries: ChartSeries[] = useMemo(() => {
    if (!data) return [];
    const step = daily ? 86400_000 : 3600_000;
    return DEVICES.filter((d) => state.devices.includes(d.id)).map((d) => {
      const pts = data.points
        .filter((p) => p.device === d.id)
        .map((p) => [Date.parse(p.t), p.v] as [number, number])
        .sort((a, b) => a[0] - b[0]);
      // Insert a gap marker where readings are missing, so the line breaks instead of bridging.
      const out: [number, number | null][] = [];
      pts.forEach((p, i) => {
        if (i > 0 && p[0] - pts[i - 1][0] > step * 1.5) out.push([pts[i - 1][0] + step, null]);
        out.push(p);
      });
      return { id: d.id, name: d.name, color: dark ? d.color.dark : d.color.light, data: out };
    });
  }, [data, state.devices, dark, daily]);

  const stats = useMemo(() => {
    const pts = data?.points ?? [];
    if (!pts.length) return null;
    const name = (id: string) => DEVICES.find((d) => d.id === id)?.name ?? id;
    let peak = pts[0];
    let sum = 0;
    let latestT = 0;
    const above = new Set<string>();
    for (const p of pts) {
      if (p.v > peak.v) peak = p;
      sum += p.v;
      latestT = Math.max(latestT, Date.parse(p.t));
      if (p.v > metric.alertFrom) above.add(p.t);
    }
    const latest = pts.filter((p) => Date.parse(p.t) === latestT).sort((a, b) => b.v - a.v)[0];
    return {
      latest: { value: latest.v, where: name(latest.device), when: fmtDateTime(latestT, daily) },
      peak: { value: peak.v, where: name(peak.device), when: fmtDateTime(peak.t, daily) },
      mean: sum / pts.length,
      above: above.size,
    };
  }, [data, metric, daily]);

  const table = useMemo(() => {
    if (!data) return [];
    const byT = new Map<string, Record<string, number>>();
    for (const p of data.points) {
      const key = new Date(p.t).toISOString();
      byT.set(key, { ...(byT.get(key) ?? {}), [p.device]: p.v });
    }
    return [...byT.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [data]);

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
        <p className="lede">Official hourly readings from the National Environment Agency, by region. Zoom in on any day, compare regions, download the data.</p>
      </header>

      {data?.demo && (
        <div className="notice" role="status">
          Demo mode: showing a small sample of real NEA readings (West and Central, 7–9 Oct 2026). The live database is not connected yet.
        </div>
      )}

      <section className="controls" aria-label="Filters">
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

        <div className="chips" role="group" aria-label="Regions">
          {DEVICES.map((d) => {
            const on = state.devices.includes(d.id);
            return (
              <button key={d.id} className={`chip ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => toggleDevice(d.id)}>
                <span className="swatch" style={{ background: dark ? d.color.dark : d.color.light }} aria-hidden />
                {d.name}
              </button>
            );
          })}
        </div>
      </section>

      <section className="tiles" aria-label="Summary">
        <Tile label={daily ? 'Latest day' : 'Latest hour, highest region'} value={stats?.latest.value} unit={metric.unit} sub={stats ? `${stats.latest.where} · ${stats.latest.when}` : ''} metricBands={metric.bands} />
        <Tile label="Peak in this period" value={stats?.peak.value} unit={metric.unit} sub={stats ? `${stats.peak.where} · ${stats.peak.when}` : ''} metricBands={metric.bands} />
        <Tile label="Average" value={stats ? Math.round(stats.mean * 10) / 10 : undefined} unit={metric.unit} sub="All selected regions" metricBands={metric.bands} />
        <Tile
          label={daily ? `Days averaging above ${metric.alertFrom}` : metric.alertLabel}
          value={stats?.above}
          unit={daily ? 'days' : 'hours'}
          sub="In any selected region"
        />
      </section>

      <section className="card chart-card" aria-busy={loading}>
        <div className="chart-head">
          <div>
            <h2>{metric.label}</h2>
            <p className="hint">Drag across the chart to zoom into a period · scroll to zoom · move the slider below</p>
          </div>
          <button className="ghost" onClick={() => setResetKey((k) => k + 1)}>
            Reset zoom
          </button>
        </div>
        {error ? (
          <div className="empty">{error}</div>
        ) : data && !data.points.length && !loading ? (
          <div className="empty">No readings for this period yet.</div>
        ) : (
          <AirChart series={chartSeries} metric={metric} daily={daily} dark={dark} resetKey={resetKey} />
        )}
        {loading && <div className="loading" aria-hidden />}
        {daily && <p className="hint">Long period: values are daily averages.</p>}
      </section>

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
        <p className="muted">Each region value is an average of several NEA monitoring stations, so conditions in your street can differ.</p>
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
