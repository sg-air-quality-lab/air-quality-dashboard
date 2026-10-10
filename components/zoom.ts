import type { ECharts } from 'echarts';

/** The visible time window of the charts (epoch ms), or null when nothing is zoomed. */
export type Zoom = { from: number; to: number } | null;

export function sameZoom(a: Zoom, b: Zoom): boolean {
  if (!a || !b) return a === b;
  return Math.abs(a.from - b.from) < 60_000 && Math.abs(a.to - b.to) < 60_000;
}

/** Read the current window from a chart's first dataZoom (all dataZooms on one axis move together). */
export function readZoom(c: ECharts): Zoom {
  const opt = c.getOption() as { dataZoom?: { start?: number; end?: number; startValue?: number; endValue?: number }[] };
  const dz = opt.dataZoom?.[0];
  if (!dz) return null;
  if ((dz.start ?? 0) <= 0.01 && (dz.end ?? 100) >= 99.99) return null;
  if (dz.startValue == null || dz.endValue == null) return null;
  return { from: Number(dz.startValue), to: Number(dz.endValue) };
}

export function applyZoom(c: ECharts, zoom: Zoom) {
  if (zoom) c.dispatchAction({ type: 'dataZoom', startValue: zoom.from, endValue: zoom.to });
  else c.dispatchAction({ type: 'dataZoom', start: 0, end: 100 });
}

/**
 * Wire a chart to the shared zoom window: user zooms are reported through onZoom,
 * and the window chosen elsewhere is applied here. Returns a function to call after every setOption.
 */
export function bindZoom(c: ECharts, get: () => { zoom: Zoom; onZoom?: (z: Zoom) => void }) {
  let applying = false;
  const report = () => {
    if (applying) return;
    get().onZoom?.(readZoom(c));
  };
  c.on('datazoom', report);
  c.on('restore', () => get().onZoom?.(null));
  return function sync() {
    const { zoom } = get();
    if (sameZoom(readZoom(c), zoom)) return;
    applying = true;
    try {
      applyZoom(c, zoom);
    } finally {
      applying = false;
    }
  };
}
