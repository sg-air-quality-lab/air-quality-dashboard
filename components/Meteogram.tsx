'use client';

// One chart, several stacked panels on a shared time axis (a "meteogram"):
// PM2.5 or PSI on top, optional weather panels below. One crosshair runs through
// all panels, one tooltip lists every value at that moment, one slider zooms everything.

import { useEffect, useRef } from 'react';
import type { ECharts, EChartsOption } from 'echarts';
import { compass, type MetricConfig, type WeatherView } from '@/lib/config';
import { fmtDateTime, fmtValue } from '@/lib/format';
import { bindZoom, type Zoom } from './zoom';

export interface ChartSeries {
  id: string;
  name: string;
  color: string;
  data: [number, number | null][];
  /** Dashed line, used for uncalibrated citizen sensors. */
  dashed?: boolean;
}

export interface Panel {
  id: WeatherView;
  /** Short name shown in the tooltip, e.g. "Humidity". */
  name: string;
  unit: string;
  values: [number, number | null][];
  /** Wind direction in degrees (where the wind comes FROM), wind panel only. */
  directions?: [number, number][];
}

interface Props {
  series: ChartSeries[];
  metric: MetricConfig;
  panels: Panel[];
  weatherColor: string;
  daily: boolean;
  dark: boolean;
  xMin?: number;
  xMax?: number;
  zoom: Zoom;
  onZoom: (z: Zoom) => void;
}

const INK = {
  light: { muted: '#898781', secondary: '#52514e', primary: '#0b0b0b', grid: '#e1e0d9', axis: '#c3c2b7', surface: '#fcfcfb' },
  dark: { muted: '#898781', secondary: '#c3c2b7', primary: '#ffffff', grid: '#2c2c2a', axis: '#383835', surface: '#1a1a19' },
};

// Layout in pixels (top to bottom).
const TOP = 30;
const MAIN_H = 300;
const GAP = 30; // room for the next panel's name
const PANEL_H = 96;
const BOTTOM = 72; // time labels + slider

export function meteogramHeight(panelCount: number) {
  return TOP + MAIN_H + panelCount * (GAP + PANEL_H) + BOTTOM;
}

export default function Meteogram(props: Props) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<ECharts | null>(null);
  const renderRef = useRef<() => void>(() => {});
  renderRef.current = render;
  const latest = useRef({ zoom: props.zoom, onZoom: props.onZoom });
  latest.current = { zoom: props.zoom, onZoom: props.onZoom };
  const syncZoom = useRef<() => void>(() => {});

  useEffect(() => {
    let disposed = false;
    let observer: ResizeObserver | null = null;
    import('echarts').then((echarts) => {
      if (disposed || !el.current) return;
      chart.current = echarts.init(el.current, undefined, { renderer: 'canvas' });
      syncZoom.current = bindZoom(chart.current, () => latest.current);
      let wasWide = (el.current.clientWidth ?? 800) >= 560;
      observer = new ResizeObserver(() => {
        chart.current?.resize();
        // Band labels and margins depend on the width: redraw only when the layout changes.
        const wide = (el.current?.clientWidth ?? 800) >= 560;
        if (wide !== wasWide) {
          wasWide = wide;
          renderRef.current();
        }
      });
      observer.observe(el.current);
      renderRef.current();
    });
    return () => {
      disposed = true;
      observer?.disconnect();
      chart.current?.dispose();
      chart.current = null;
    };
  }, []);

  useEffect(() => {
    renderRef.current();
  }, [props.series, props.metric, props.panels, props.weatherColor, props.daily, props.dark, props.xMin, props.xMax]);

  useEffect(() => {
    syncZoom.current();
  }, [props.zoom]);

  function render() {
    const c = chart.current;
    if (!c) return;
    const { series, metric, panels, weatherColor, daily, dark, xMin, xMax } = props;
    const ink = dark ? INK.dark : INK.light;
    const wide = (el.current?.clientWidth ?? 800) >= 560;
    const left = 48;
    const right = wide ? 92 : 14;

    // ---- main panel: y range ends on the next band edge, so you can see which band you are in
    let dataMax = 0;
    for (const s of series) for (const [, v] of s.data) if (v != null && v > dataMax) dataMax = v;
    const edges = metric.bands.map((b) => b.to);
    const yMax = edges.find((e) => e >= dataMax * 1.05) ?? Math.ceil((dataMax * 1.1) / 50) * 50;
    const bandAreas = metric.bands
      .filter((b) => b.from < yMax)
      .map((b) => [
        {
          yAxis: b.from,
          itemStyle: { color: b.tint ?? 'rgba(0,0,0,0)' },
          label: { show: wide, position: 'right', distance: 8, color: ink.muted, fontSize: 11, formatter: b.label },
        },
        { yAxis: Math.min(b.to, yMax) },
      ]);

    const n = panels.length + 1;
    const all = Array.from({ length: n }, (_, i) => i);
    const gridTop = (i: number) => (i === 0 ? TOP : TOP + MAIN_H + (i - 1) * (GAP + PANEL_H) + GAP);

    const grids = all.map((i) => ({ left, right, top: gridTop(i), height: i === 0 ? MAIN_H : PANEL_H }));

    const xAxes = all.map((i) => ({
      type: 'time' as const,
      gridIndex: i,
      min: xMin,
      max: xMax,
      axisLine: { lineStyle: { color: ink.axis } },
      axisTick: { show: false },
      splitNumber: wide ? undefined : 4,
      axisLabel: { show: i === n - 1, color: ink.muted, fontSize: 11, hideOverlap: true },
      splitLine: { show: false },
      axisPointer: {
        show: true,
        type: 'line' as const,
        snap: true,
        lineStyle: { color: dark ? '#9a988f' : '#6f6d66', type: 'dashed' as const, width: 1 },
        label: { show: i === n - 1 },
      },
    }));

    const axisName = (text: string) => ({
      name: text,
      nameLocation: 'end' as const,
      nameGap: 10,
      nameTextStyle: { color: ink.secondary, fontSize: 12, fontWeight: 600 as const, align: 'left' as const },
    });

    const yAxes = [
      {
        type: 'value' as const,
        gridIndex: 0,
        min: 0,
        max: yMax,
        ...axisName(metric.unit ? `${metric.short.replace(/ \(.*\)/, '')} · ${metric.unit}` : metric.short),
        axisLabel: { color: ink.muted, fontSize: 11 },
        splitLine: { lineStyle: { color: ink.grid, width: 1 } },
      },
      ...panels.map((p, k) => ({
        type: 'value' as const,
        gridIndex: k + 1,
        ...axisName(`${p.name} · ${p.unit}`),
        min: p.id === 'rainfall' || p.id === 'wind' ? 0 : undefined,
        scale: p.id === 'humidity' || p.id === 'temperature',
        splitNumber: 2,
        axisLabel: { color: ink.muted, fontSize: 11 },
        splitLine: { lineStyle: { color: ink.grid, width: 1 } },
      })),
    ];

    // ---- wind arrows: every 3rd hour for up to a week, fewer for longer periods
    const span = (xMax ?? 0) - (xMin ?? 0);
    const days = span / 86400_000;
    // Hours between two arrows; narrow screens get fewer.
    const every = (days > 21 ? 24 : days > 7 ? 6 : days > 2 ? 3 : 2) * (wide ? 1 : 2);
    const dirMaps = new Map(panels.map((p) => [p.id, new Map(p.directions ?? [])]));

    const panelSeries = panels.flatMap((p, k) => {
      const idx = k + 1;
      const base =
        p.id === 'rainfall'
          ? {
              id: `panel-${p.id}`,
              name: p.name,
              type: 'bar' as const,
              xAxisIndex: idx,
              yAxisIndex: idx,
              data: p.values,
              barMaxWidth: 8,
              itemStyle: { color: weatherColor, borderRadius: [2, 2, 0, 0] },
            }
          : {
              id: `panel-${p.id}`,
              name: p.name,
              type: 'line' as const,
              xAxisIndex: idx,
              yAxisIndex: idx,
              data: p.values,
              showSymbol: false,
              connectNulls: false,
              lineStyle: { width: 1.75, color: weatherColor },
              itemStyle: { color: weatherColor },
            };
      if (p.id !== 'wind' || daily) return [base];
      const dirs = dirMaps.get('wind')!;
      const arrows = p.values
        .filter(([t, v]) => v != null && dirs.has(t) && ((new Date(t).getUTCHours() + 8) % 24) % every === 0)
        .map(([t, v]) => ({ value: [t, v as number], symbolRotate: (180 - (dirs.get(t) as number) + 360) % 360 }));
      return [
        base,
        {
          id: 'arrows-wind',
          type: 'scatter' as const,
          xAxisIndex: idx,
          yAxisIndex: idx,
          data: arrows,
          symbol: 'arrow',
          symbolSize: [8, 12],
          itemStyle: { color: ink.secondary },
          silent: true,
          z: 3,
        },
      ];
    });

    const panelUnit = new Map(panels.map((p) => [`panel-${p.id}`, p]));

    const option: EChartsOption = {
      animation: false,
      backgroundColor: 'transparent',
      textStyle: { fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif' },
      grid: grids,
      axisPointer: {
        link: [{ xAxisIndex: 'all' }],
        lineStyle: { color: ink.muted, type: 'dashed', width: 1 },
        label: { backgroundColor: ink.secondary, color: ink.surface, fontSize: 11, formatter: (p) => fmtDateTime(p.value as number, daily) },
      },
      toolbox: {
        right: 8,
        top: -4,
        itemSize: 15,
        iconStyle: { borderColor: ink.muted },
        emphasis: { iconStyle: { borderColor: ink.primary } },
        feature: {
          dataZoom: { yAxisIndex: 'none', title: { zoom: 'Drag to zoom', back: 'Undo zoom' } },
          restore: { title: 'Reset' },
          saveAsImage: { title: 'Save as image', name: 'air-quality', backgroundColor: ink.surface },
        },
      },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'line', lineStyle: { color: ink.muted, type: 'dashed', width: 1 } },
        backgroundColor: ink.surface,
        borderColor: ink.grid,
        textStyle: { color: ink.primary, fontSize: 12 },
        confine: true,
        formatter: (params) => {
          const list = (Array.isArray(params) ? params : [params]) as unknown as {
            value: [number, number | null];
            seriesId: string;
            seriesName: string;
            color: string;
          }[];
          if (!list.length) return '';
          const t = list[0].value[0];
          const row = (left: string, right: string) =>
            `<div style="display:flex;gap:14px;align-items:center;justify-content:space-between">${left}<span>${right}</span></div>`;
          const swatch = (color: string, dashed = false) =>
            `<span style="display:inline-block;width:10px;height:0;border-top:3px ${dashed ? 'dotted' : 'solid'} ${color};margin-right:6px;vertical-align:middle"></span>`;
          const main = list
            .filter((p) => !p.seriesId.startsWith('panel-') && !p.seriesId.startsWith('arrows-') && p.value[1] != null)
            .sort((a, b) => (b.value[1] ?? 0) - (a.value[1] ?? 0))
            .map((p) => {
              const v = p.value[1] as number;
              const band = metric.bands.find((b) => v >= b.from && v < b.to)?.label ?? '';
              const dashed = series.find((s) => s.id === p.seriesId)?.dashed;
              return row(`<span>${swatch(p.color, dashed)}${p.seriesName}</span>`, `<b>${fmtValue(v)}</b> <span style="color:${ink.muted}">${band}</span>`);
            })
            .join('');
          const weather = list
            .filter((p) => p.seriesId.startsWith('panel-'))
            .map((p) => {
              const panel = panelUnit.get(p.seriesId)!;
              if (p.value[1] == null) return row(`<span style="color:${ink.muted}">${panel.name}</span>`, `<span style="color:${ink.muted}">no data</span>`);
              const dir = panel.id === 'wind' && !daily ? dirMaps.get('wind')?.get(t) : undefined;
              const extra = dir != null ? ` <span style="color:${ink.muted}">from ${compass(dir)}</span>` : '';
              return row(`<span style="color:${ink.secondary}">${panel.name}</span>`, `<b>${fmtValue(p.value[1])}</b> ${panel.unit}${extra}`);
            })
            .join('');
          const divider = weather ? `<div style="border-top:1px solid ${ink.grid};margin:6px 0"></div>` : '';
          return `<div style="margin-bottom:6px;color:${ink.secondary}">${fmtDateTime(t, daily)}${daily ? ' (daily average)' : ''}</div>${main || '<i>No data</i>'}${divider}${weather}`;
        },
      },
      xAxis: xAxes,
      yAxis: yAxes,
      dataZoom: [
        { type: 'inside', xAxisIndex: all, zoomOnMouseWheel: true, moveOnMouseMove: false, moveOnMouseWheel: false },
        {
          type: 'slider',
          xAxisIndex: all,
          height: 26,
          bottom: 8,
          left,
          right,
          borderColor: ink.grid,
          fillerColor: dark ? 'rgba(57,135,229,0.18)' : 'rgba(42,120,214,0.12)',
          handleStyle: { color: ink.surface, borderColor: ink.axis },
          moveHandleStyle: { color: ink.axis },
          dataBackground: { lineStyle: { color: ink.axis }, areaStyle: { color: ink.grid } },
          textStyle: { color: ink.muted, fontSize: 10 },
          labelFormatter: (v: number) => (Number.isFinite(v) ? fmtDateTime(v, daily) : ''),
        },
      ],
      series: [
        ...series.map((s, i) => ({
          id: s.id,
          name: s.name,
          type: 'line' as const,
          xAxisIndex: 0,
          yAxisIndex: 0,
          data: s.data,
          showSymbol: false,
          symbolSize: 8,
          connectNulls: false,
          lineStyle: { width: 2, color: s.color, type: s.dashed ? ('dashed' as const) : ('solid' as const) },
          itemStyle: { color: s.color },
          markArea: i === 0 ? { silent: true, data: bandAreas as never } : undefined,
        })),
        ...panelSeries,
      ],
    };

    c.setOption(option, { notMerge: true });
    syncZoom.current();
    // Mouse: drag a box to zoom. Touch screens: dragging keeps scrolling the page.
    const touch = window.matchMedia('(pointer: coarse)').matches;
    c.dispatchAction({ type: 'takeGlobalCursor', key: 'dataZoomSelect', dataZoomSelectActive: !touch });
  }

  return (
    <div
      ref={el}
      className="meteogram"
      style={{ height: meteogramHeight(props.panels.length) }}
      role="img"
      aria-label={`${props.metric.label}${props.panels.length ? ' with ' + props.panels.map((p) => p.name.toLowerCase()).join(', ') : ''}`}
    />
  );
}
