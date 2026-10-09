'use client';

import { useEffect, useRef } from 'react';
import type { ECharts } from 'echarts';
import { fmtDateTime } from '@/lib/format';

export interface CalibrationPoint {
  t: number;
  humidity: number;
  ratio: number;
}

interface Props {
  points: CalibrationPoint[];
  color: string;
  dark: boolean;
}

const INK = {
  light: { muted: '#898781', secondary: '#52514e', primary: '#0b0b0b', grid: '#e1e0d9', axis: '#c3c2b7', surface: '#fcfcfb' },
  dark: { muted: '#898781', secondary: '#c3c2b7', primary: '#ffffff', grid: '#2c2c2a', axis: '#383835', surface: '#1a1a19' },
};

/** Scatter: x = humidity at the sensor, y = sensor ÷ NEA. A ratio of 1 means "agrees with NEA". */
export default function CalibrationChart({ points, color, dark }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<ECharts | null>(null);
  const renderRef = useRef<() => void>(() => {});
  renderRef.current = render;

  useEffect(() => {
    let disposed = false;
    let observer: ResizeObserver | null = null;
    import('echarts').then((echarts) => {
      if (disposed || !el.current) return;
      chart.current = echarts.init(el.current);
      observer = new ResizeObserver(() => chart.current?.resize());
      observer.observe(el.current);
      renderRef.current();
    });
    return () => {
      disposed = true;
      observer?.disconnect();
      chart.current?.dispose();
    };
  }, []);

  useEffect(() => {
    renderRef.current();
  }, [points, color, dark]);

  function render() {
    const c = chart.current;
    if (!c) return;
    const ink = dark ? INK.dark : INK.light;
    const yMax = Math.max(2, Math.ceil(Math.max(...points.map((p) => p.ratio), 1) * 2) / 2);
    c.setOption(
      {
        animation: false,
        textStyle: { fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif' },
        grid: { left: 48, right: 24, top: 24, bottom: 44 },
        tooltip: {
          trigger: 'item',
          backgroundColor: ink.surface,
          borderColor: ink.grid,
          textStyle: { color: ink.primary, fontSize: 12 },
          formatter: (p: { value: [number, number, number] }) =>
            `<div style="color:${ink.secondary};margin-bottom:4px">${fmtDateTime(p.value[2])}</div>` +
            `Humidity <b>${p.value[0].toFixed(0)}%</b><br/>Your sensor reads <b>${p.value[1].toFixed(2)}×</b> NEA`,
        },
        xAxis: {
          type: 'value',
          name: 'Humidity at your sensor (%)',
          nameLocation: 'middle',
          nameGap: 28,
          nameTextStyle: { color: ink.muted, fontSize: 11 },
          scale: true,
          axisLine: { lineStyle: { color: ink.axis } },
          axisLabel: { color: ink.muted, fontSize: 11 },
          splitLine: { show: false },
        },
        yAxis: {
          type: 'value',
          name: 'Sensor ÷ NEA',
          min: 0,
          max: yMax,
          nameTextStyle: { color: ink.muted, fontSize: 11, align: 'left' },
          axisLabel: { color: ink.muted, fontSize: 11, formatter: (v: number) => `${v}×` },
          splitLine: { lineStyle: { color: ink.grid } },
        },
        series: [
          {
            type: 'scatter',
            data: points.map((p) => [p.humidity, p.ratio, p.t]),
            symbolSize: 8,
            itemStyle: { color, opacity: 0.75, borderColor: ink.surface, borderWidth: 1 },
            markLine: {
              silent: true,
              symbol: 'none',
              lineStyle: { color: ink.axis, type: 'dashed' },
              label: { color: ink.muted, fontSize: 11, formatter: 'same as NEA', position: 'insideEndTop' },
              data: [{ yAxis: 1 }],
            },
          },
        ],
      },
      { notMerge: true },
    );
  }

  return <div ref={el} className="chart chart-small" role="img" aria-label="Calibration chart: sensor compared with NEA by humidity" />;
}
