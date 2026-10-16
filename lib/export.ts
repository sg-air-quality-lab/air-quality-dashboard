// Builds the download table from what is on screen: one row per hour (or day),
// the time first, then one column per selected region, then the weather panels.
// No imports, so it can be tested directly with node.

export interface ExportPoint {
  t: string;
  device: string;
  v: number;
}

export interface ExportColumn {
  header: string;
  /** Number of decimals when writing CSV; Excel keeps the full value. */
  decimals?: number;
}

export interface ExportInput {
  /** e.g. "PM2.5" or "PSI" */
  metricShort: string;
  unit: string;
  regions: { id: string; name: string }[];
  points: ExportPoint[];
  /** Selected weather panels in display order, with their station readings. */
  weather: { label: string; unit: string; points: ExportPoint[]; directions?: ExportPoint[] }[];
  /** Only rows inside this window (epoch ms), e.g. the zoomed part of the chart. */
  window?: { from: number; to: number } | null;
  compass: (deg: number) => string;
}

export interface ExportTable {
  columns: ExportColumn[];
  /** First value is the time (epoch ms); the rest match `columns` after the time column. */
  rows: [number, ...(number | string | null)[]][];
}

export function buildExportTable(input: ExportInput): ExportTable {
  const columns: ExportColumn[] = [{ header: 'Time (Singapore)' }];
  const getters: ((t: number) => number | string | null)[] = [];

  const index = (pts: ExportPoint[], device?: string) => {
    const m = new Map<number, number>();
    for (const p of pts) if (!device || p.device === device) m.set(Date.parse(p.t), p.v);
    return m;
  };

  const times = new Set<number>();
  for (const p of input.points) times.add(Date.parse(p.t));

  for (const r of input.regions) {
    const m = index(input.points, r.id);
    columns.push({ header: `${input.metricShort} ${r.name}${input.unit ? ` (${input.unit})` : ''}`, decimals: 1 });
    getters.push((t) => m.get(t) ?? null);
  }

  for (const w of input.weather) {
    const m = index(w.points);
    for (const t of m.keys()) times.add(t);
    columns.push({ header: `${w.label} (${w.unit})`, decimals: 1 });
    getters.push((t) => (m.has(t) ? Math.round(m.get(t)! * 10) / 10 : null));
    if (w.directions) {
      const d = index(w.directions);
      columns.push({ header: 'Wind from (degrees)', decimals: 0 });
      getters.push((t) => (d.has(t) ? Math.round(d.get(t)!) : null));
      columns.push({ header: 'Wind from (compass)' });
      getters.push((t) => (d.has(t) ? input.compass(d.get(t)!) : null));
    }
  }

  const win = input.window;
  const rows = [...times]
    .filter((t) => !win || (t >= win.from && t <= win.to))
    .sort((a, b) => a - b)
    .map((t) => [t, ...getters.map((g) => g(t))] as [number, ...(number | string | null)[]])
    // Drop hours where nothing at all was measured.
    .filter((row) => row.slice(1).some((v) => v != null));

  return { columns, rows };
}

/** Comma-separated text with a single header row, so spreadsheet programs open it cleanly. */
export function toCsv(table: ExportTable, fmtTime: (t: number) => string) {
  const cell = (v: number | string | null, decimals?: number) => {
    if (v == null) return '';
    if (typeof v === 'number') return decimals == null ? String(v) : String(Number(v.toFixed(decimals)));
    return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  };
  const header = table.columns.map((c) => cell(c.header)).join(',');
  const lines = table.rows.map(([t, ...vals]) => [fmtTime(t), ...vals.map((v, i) => cell(v, table.columns[i + 1].decimals))].join(','));
  return [header, ...lines].join('\r\n') + '\r\n';
}
