'use client';

import { useEffect, useRef } from 'react';
import { createChart, ColorType, IChartApi, ISeriesApi, LineData, Time } from 'lightweight-charts';
import type { Candle } from '@/lib/types';

interface ChartProps {
  candles: Candle[];
  dOpen: number | null;
  vwap: number | null;
  upLevels: number[];
  dnLevels: number[];
  markers?: Array<{
    time: number;
    position: 'aboveBar' | 'belowBar';
    color: string;
    shape: 'circle' | 'arrowUp' | 'arrowDown';
    text: string;
  }>;
}

export default function Chart({ candles, dOpen, vwap, upLevels, dnLevels, markers = [] }: ChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Line'> | null>(null);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    // Create chart
    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#1a1a1a' },
        textColor: '#d1d5db',
      },
      width: chartContainerRef.current.clientWidth,
      height: 600,
      grid: {
        vertLines: { color: '#2a2a2a' },
        horzLines: { color: '#2a2a2a' },
      },
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
      },
    });

    chartRef.current = chart;

    // Add close price line series
    const lineSeries = chart.addLineSeries({
      color: '#3b82f6',
      lineWidth: 2,
      priceFormat: {
        type: 'price',
        precision: 2,
        minMove: 0.01,
      },
    });
    seriesRef.current = lineSeries;

    // Prepare data (convert candles to line data)
    const lineData: LineData<Time>[] = candles.map((candle) => ({
      time: (candle.ts / 1000) as Time,
      value: candle.close,
    }));

    lineSeries.setData(lineData);

    // Add horizontal lines for dOpen
    if (dOpen !== null) {
      lineSeries.createPriceLine({
        price: dOpen,
        color: '#fbbf24',
        lineWidth: 2,
        lineStyle: 0, // Solid
        axisLabelVisible: true,
        title: 'Daily Open',
      });
    }

    // Add horizontal line for VWAP
    if (vwap !== null) {
      lineSeries.createPriceLine({
        price: vwap,
        color: '#10b981',
        lineWidth: 2,
        lineStyle: 0,
        axisLabelVisible: true,
        title: 'VWAP',
      });
    }

    // Add upper levels (teal, faint)
    upLevels.forEach((level, idx) => {
      lineSeries.createPriceLine({
        price: level,
        color: '#14b8a6',
        lineWidth: 1,
        lineStyle: 2, // Dashed
        axisLabelVisible: false,
      });
    });

    // Add lower levels (orange, faint)
    dnLevels.forEach((level, idx) => {
      lineSeries.createPriceLine({
        price: level,
        color: '#f97316',
        lineWidth: 1,
        lineStyle: 2, // Dashed
        axisLabelVisible: false,
      });
    });

    // Add markers for signals
    if (markers.length > 0 && seriesRef.current) {
      const chartMarkers = markers.map((m) => ({
        time: m.time as Time,
        position: m.position as 'aboveBar' | 'belowBar',
        color: m.color,
        shape: m.shape as 'circle' | 'arrowUp' | 'arrowDown',
        text: m.text,
      }));
      lineSeries.setMarkers(chartMarkers);
    } else if (seriesRef.current) {
      lineSeries.setMarkers([]);
    }

    // Handle resize
    const handleResize = () => {
      if (chartContainerRef.current && chartRef.current) {
        chartRef.current.applyOptions({ width: chartContainerRef.current.clientWidth });
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
    };
  }, [candles, dOpen, vwap, upLevels, dnLevels, markers]);

  return <div ref={chartContainerRef} className="w-full h-[600px]" />;
}
