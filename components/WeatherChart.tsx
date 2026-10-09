'use client';

import { useEffect, useRef } from 'react';
import type { ECharts, EChartsOption } from 'echarts';
import { compass, type WeatherView } from '@/lib/config';
import { fmtDateTime, fmtValue } from '@/lib/format';

interface Props {
  view: WeatherView;
  unit: string;
  /** Main values: wind speed, rain, humidity or temperature. Null = gap. */
  values: [number, number | null][];
  /** Wind direction (degrees, where the wind comes FROM), only for the wind view. */
  directions?: [number, number][];
  color: string;
  daily: boolean;
  dark: boolean;
  resetKey: number;
  xMin?: number;
  xMax?: number;
  group?: string;
}

const INK = {
  light: { muted: '#898781', secondary: '#52514e', primary: '#0b0b0b', grid: '#e1e0d9', axis: '#c3c2b7', surface: '#fcfcfb' },
  dark: { muted: '#898781', secondary: '#c3c2b7', primary: '#ffffff', grid: '#2c2c2a', axis: '#383835', surface: '#1a1a19' },
};

export default function WeatherChart(props: Props) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<ECharts | null>(null);
  const renderRef = useRef<() => void>(() => {});
  renderRef.current = render;

  useEffect(() => {
    let disposed = false;
    let observer: ResizeObserver | null = null;
    import('echarts').then((echarts) => {
      if (disposed || !el.current) return;
      chart.current = echarts.init(el.current, undefined, { renderer: 'canvas' });
      if (props.group) {
        chart.current.group = props.group;
        echarts.connect(props.group);
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
    renderRef.current();
  }, [props.view, props.values, props.directions, props.color, props.daily, props.dark, props.xMin, props.xMax]);

  useEffect(() => {
    chart.current?.dispatchAction({ type: 'dataZoom', start: 0, end: 100 });
  }, [props.resetKey]);

  function render() {
    const c = chart.current;
    if (!c) return;
    const { view, unit, values, directions = [], color, daily, dark, xMin, xMax } = props;
    const ink = dark ? INK.dark : INK.light;
    // Same plot width as the PM2.5 chart above, so the time axes line up.
    const wide = (el.current?.clientWidth ?? 800) >= 560;
    const dirAt = new Map(directions.map(([t, d]) => [t, d]));

    // Direction arrows: every 3rd hour for up to a week, fewer for longer periods.
    const span = (xMax ?? 0) - (xMin ?? 0);
    const every = span > 21 * 86400_000 ? 24 : span > 7 * 86400_000 ? 6 : 3;
    const arrows =
      view === 'wind' && !daily
        ? values
            .filter(([t, v]) => v != null && dirAt.has(t) && ((new Date(t).getUTCHours() + 8) % 24) % every === 0)
            .map(([t, v]) => ({
              value: [t, v as number],
              // Arrow shows where the wind blows TO. ECharts rotates counter-clockwise.
              symbolRotate: (180 - (dirAt.get(t) as number) + 360) % 360,
            }))
        : [];

    const option: EChartsOption = {
      animation: false,
      backgroundColor: 'transparent',
      textStyle: { fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif' },
      grid: { left: 48, right: wide ? 92 : 12, top: 28, bottom: 36 },
      toolbox: {
        right: 8,
        top: -4,
        itemSize: 15,
        iconStyle: { borderColor: ink.muted },
        feature: { dataZoom: { yAxisIndex: 'none', title: { zoom: 'Drag to zoom', back: 'Undo zoom' } } },
      },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'line', lineStyle: { color: ink.axis } },
        backgroundColor: ink.surface,
        borderColor: ink.grid,
        textStyle: { color: ink.primary, fontSize: 12 },
        formatter: (params) => {
          const list = (Array.isArray(params) ? params : [params]) as unknown as { value: [number, number | null] }[];
          const p = list[0];
          if (!p || p.value[1] == null) return '';
          const t = p.value[0];
          const dir = dirAt.get(t);
          const extra = view === 'wind' && dir != null && !daily ? ` from ${compass(dir)} (${Math.round(dir)}°)` : '';
          return `<div style="color:${ink.secondary};margin-bottom:4px">${fmtDateTime(t, daily)}${daily ? ' (daily average)' : ''}</div><b>${fmtValue(p.value[1])}</b> ${unit}${extra}`;
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
        name: unit,
        min: view === 'rainfall' || view === 'wind' ? 0 : undefined,
        scale: view === 'humidity' || view === 'temperature',
        nameTextStyle: { color: ink.muted, fontSize: 11, align: 'right' },
        axisLabel: { color: ink.muted, fontSize: 11 },
        splitLine: { lineStyle: { color: ink.grid, width: 1 } },
      },
      dataZoom: [{ type: 'inside', zoomOnMouseWheel: true, moveOnMouseMove: false, moveOnMouseWheel: false }],
      series: [
        view === 'rainfall'
          ? {
              type: 'bar',
              data: values,
              barMaxWidth: 8,
              itemStyle: { color, borderRadius: [2, 2, 0, 0] },
            }
          : {
              type: 'line',
              data: values,
              showSymbol: false,
              connectNulls: false,
              lineStyle: { width: 2, color },
              itemStyle: { color },
            },
        ...(arrows.length
          ? [
              {
                type: 'scatter' as const,
                data: arrows,
                symbol: 'arrow',
                symbolSize: [9, 13],
                itemStyle: { color: ink.secondary },
                silent: true,
                tooltip: { show: false },
                z: 3,
              },
            ]
          : []),
      ],
    };

    c.setOption(option, { notMerge: true });
    const touch = window.matchMedia('(pointer: coarse)').matches;
    c.dispatchAction({ type: 'takeGlobalCursor', key: 'dataZoomSelect', dataZoomSelectActive: !touch });
  }

  return <div ref={el} className="chart chart-small" role="img" aria-label="Weather chart" />;
}
