'use client';

import { useEffect, useRef } from 'react';
import type { ECharts, EChartsOption } from 'echarts';
import type { MetricConfig } from '@/lib/config';
import { fmtDateTime, fmtValue } from '@/lib/format';

export interface ChartSeries {
  id: string;
  name: string;
  color: string;
  data: [number, number | null][];
  /** Dashed line, used for uncalibrated citizen sensors. */
  dashed?: boolean;
}

interface Props {
  series: ChartSeries[];
  metric: MetricConfig;
  daily: boolean;
  dark: boolean;
  resetKey: number;
  /** Fixed time window, so charts in the same group zoom in step. */
  xMin?: number;
  xMax?: number;
  group?: string;
}

const INK = {
  light: { muted: '#898781', secondary: '#52514e', primary: '#0b0b0b', grid: '#e1e0d9', axis: '#c3c2b7', surface: '#fcfcfb' },
  dark: { muted: '#898781', secondary: '#c3c2b7', primary: '#ffffff', grid: '#2c2c2a', axis: '#383835', surface: '#1a1a19' },
};

export default function AirChart({ series, metric, daily, dark, resetKey, xMin, xMax, group }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<ECharts | null>(null);
  // Always points at the latest render function, so the async chart init never uses stale props.
  const renderRef = useRef<() => void>(() => {});
  renderRef.current = render;

  // Create the chart once
  useEffect(() => {
    let disposed = false;
    let observer: ResizeObserver | null = null;
    import('echarts').then((echarts) => {
      if (disposed || !el.current) return;
      chart.current = echarts.init(el.current, undefined, { renderer: 'canvas' });
      if (group) {
        chart.current.group = group;
        echarts.connect(group);
      }
      observer = new ResizeObserver(() => chart.current?.resize());
      observer.observe(el.current);
      renderRef.current();
    });
    return () => {
      disposed = true;
      observer?.disconnect();
      chart.current?.dispose();
      chart.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    render();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series, metric, daily, dark, xMin, xMax]);

  useEffect(() => {
    chart.current?.dispatchAction({ type: 'dataZoom', start: 0, end: 100 });
  }, [resetKey]);

  function render() {
    const c = chart.current;
    if (!c) return;
    const ink = dark ? INK.dark : INK.light;
    const wide = (el.current?.clientWidth ?? 800) >= 560;

    let dataMax = 0;
    for (const s of series) for (const [, v] of s.data) if (v != null && v > dataMax) dataMax = v;
    // Let the axis end on the next category boundary, so you can see which band you are in.
    const edges = metric.bands.map((b) => b.to);
    const yMax = edges.find((e) => e >= dataMax * 1.05) ?? Math.ceil((dataMax * 1.1) / 50) * 50;

    const bandAreas = metric.bands
      .filter((b) => b.from < yMax)
      .map((b) => [
        {
          yAxis: b.from,
          itemStyle: { color: b.tint ?? 'rgba(0,0,0,0)' },
          label: {
            show: wide,
            position: 'right',
            distance: 8,
            color: ink.muted,
            fontSize: 11,
            formatter: b.label,
          },
        },
        { yAxis: Math.min(b.to, yMax) },
      ]);


    const option: EChartsOption = {
      animation: false,
      backgroundColor: 'transparent',
      textStyle: { fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif' },
      grid: { left: 48, right: wide ? 92 : 12, top: 28, bottom: 72 },
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
        axisPointer: { type: 'line', lineStyle: { color: ink.axis } },
        backgroundColor: ink.surface,
        borderColor: ink.grid,
        textStyle: { color: ink.primary, fontSize: 12 },
        formatter: (params) => {
          const list = (Array.isArray(params) ? params : [params]) as unknown as {
            value: [number, number | null];
            seriesName: string;
            color: string;
          }[];
          if (!list.length) return '';
          const t = list[0].value[0];
          const rows = list
            .filter((p) => p.value[1] != null)
            .sort((a, b) => (b.value[1] ?? 0) - (a.value[1] ?? 0))
            .map((p) => {
              const v = p.value[1] as number;
              const band = metric.bands.find((b) => v >= b.from && v < b.to)?.label ?? '';
              return `<div style="display:flex;gap:10px;align-items:center;justify-content:space-between">
                <span><span style="display:inline-block;width:10px;height:3px;border-radius:2px;background:${p.color};margin-right:6px;vertical-align:middle"></span>${p.seriesName}</span>
                <span><b>${fmtValue(v)}</b> <span style="color:${ink.muted}">${band}</span></span></div>`;
            })
            .join('');
          return `<div style="margin-bottom:6px;color:${ink.secondary}">${fmtDateTime(t, daily)}${daily ? ' (daily average)' : ''}</div>${rows || '<i>No data</i>'}`;
        },
      },
      xAxis: {
        type: 'time',
        min: xMin,
        max: xMax,
        axisLine: { lineStyle: { color: ink.axis } },
        axisTick: { show: false },
        axisLabel: { color: ink.muted, fontSize: 11, hideOverlap: true },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value',
        min: 0,
        max: yMax,
        name: metric.unit,
        nameTextStyle: { color: ink.muted, fontSize: 11, align: 'right' },
        axisLabel: { color: ink.muted, fontSize: 11 },
        splitLine: { lineStyle: { color: ink.grid, width: 1 } },
      },
      dataZoom: [
        { type: 'inside', zoomOnMouseWheel: true, moveOnMouseMove: false, moveOnMouseWheel: false },
        {
          type: 'slider',
          height: 26,
          bottom: 10,
          borderColor: ink.grid,
          fillerColor: dark ? 'rgba(57,135,229,0.18)' : 'rgba(42,120,214,0.12)',
          handleStyle: { color: ink.surface, borderColor: ink.axis },
          moveHandleStyle: { color: ink.axis },
          dataBackground: { lineStyle: { color: ink.axis }, areaStyle: { color: ink.grid } },
          textStyle: { color: ink.muted, fontSize: 10 },
          labelFormatter: (v: number) => (Number.isFinite(v) ? fmtDateTime(v, daily) : ''),
        },
      ],
      series: series.map((s, i) => ({
        id: s.id,
        name: s.name,
        type: 'line',
        data: s.data,
        showSymbol: false,
        symbolSize: 8,
        connectNulls: false,
        lineStyle: { width: 2, color: s.color, type: s.dashed ? 'dashed' : 'solid' },
        itemStyle: { color: s.color },
        emphasis: { focus: 'series', lineStyle: { width: 2.5 } },
        markArea: i === 0 ? { silent: true, data: bandAreas as never } : undefined,
      })),
    };

    c.setOption(option, { notMerge: true });
    // Default mouse mode: drag a box to zoom into that time window.
    // Not on touch screens, where dragging must keep scrolling the page.
    const touch = window.matchMedia('(pointer: coarse)').matches;
    c.dispatchAction({ type: 'takeGlobalCursor', key: 'dataZoomSelect', dataZoomSelectActive: !touch });
  }

  return <div ref={el} className="chart" role="img" aria-label={`${metric.label} chart`} />;
}
