'use client';

import { useEffect, useRef } from 'react';
import { createChart, ColorType, IChartApi, ISeriesApi, CandlestickData, Time } from 'lightweight-charts';
import type { Candle } from '@/lib/types';

interface ChartProps {
  candles: Candle[];
  dOpen: number | null;
  vwap: number | null;
  upLevels: number[];
  dnLevels: number[];
  upper: number | null;
  lower: number | null;
  markers?: Array<{
    time: number;
    position: 'aboveBar' | 'belowBar';
    color: string;
    shape: 'circle' | 'arrowUp' | 'arrowDown';
    text: string;
  }>;
  openTrades?: Array<{
    entry: number;
    tp: number;
    sl: number;
    side: 'LONG' | 'SHORT';
  }>;
}

export default function Chart({ 
  candles, 
  dOpen, 
  vwap, 
  upLevels, 
  dnLevels, 
  upper,
  lower,
  markers = [],
  openTrades = []
}: ChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);

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

    // Add candlestick series
    const candlestickSeries = chart.addCandlestickSeries({
      upColor: '#10b981',
      downColor: '#ef4444',
      borderVisible: false,
      wickUpColor: '#10b981',
      wickDownColor: '#ef4444',
      priceFormat: {
        type: 'price',
        precision: 2,
        minMove: 0.01,
      },
    });
    seriesRef.current = candlestickSeries;

    // Prepare candlestick data
    const candlestickData: CandlestickData<Time>[] = candles.map((candle) => ({
      time: (candle.ts / 1000) as Time,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
    }));

    candlestickSeries.setData(candlestickData);

    // Add upper and lower bounds (prominent lines)
    if (upper !== null) {
      candlestickSeries.createPriceLine({
        price: upper,
        color: '#10b981',
        lineWidth: 2,
        lineStyle: 0, // Solid
        axisLabelVisible: true,
        title: 'Upper Bound',
      });
    }

    if (lower !== null) {
      candlestickSeries.createPriceLine({
        price: lower,
        color: '#ef4444',
        lineWidth: 2,
        lineStyle: 0, // Solid
        axisLabelVisible: true,
        title: 'Lower Bound',
      });
    }

    // Add zone visualization (4 equal zones)
    if (upper !== null && lower !== null && dOpen !== null) {
      const range = upper - lower;
      const zoneSize = range / 4;
      
      // Zone 1: Lower to Lower + zoneSize (red zone)
      candlestickSeries.createPriceLine({
        price: lower + zoneSize,
        color: '#ef4444',
        lineWidth: 1,
        lineStyle: 2, // Dashed
        axisLabelVisible: true,
        title: 'Zone 1/4',
      });
      
      // Zone 2: Lower + zoneSize to dOpen (orange zone)
      if (lower + zoneSize < dOpen) {
        candlestickSeries.createPriceLine({
          price: lower + zoneSize * 2,
          color: '#f97316',
          lineWidth: 1,
          lineStyle: 2,
          axisLabelVisible: true,
          title: 'Zone 2/4',
        });
      }
      
      // Zone 3: dOpen to Upper - zoneSize (blue zone)
      if (dOpen < upper - zoneSize) {
        candlestickSeries.createPriceLine({
          price: upper - zoneSize * 2,
          color: '#3b82f6',
          lineWidth: 1,
          lineStyle: 2,
          axisLabelVisible: true,
          title: 'Zone 3/4',
        });
      }
      
      // Zone 4: Upper - zoneSize to Upper (green zone)
      candlestickSeries.createPriceLine({
        price: upper - zoneSize,
        color: '#10b981',
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: 'Zone 4/4',
      });
    }

    // Add horizontal lines for dOpen
    if (dOpen !== null) {
      candlestickSeries.createPriceLine({
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
      candlestickSeries.createPriceLine({
        price: vwap,
        color: '#10b981',
        lineWidth: 2,
        lineStyle: 1, // Dotted
        axisLabelVisible: true,
        title: 'VWAP',
      });
    }

    // Add upper levels (teal, faint)
    upLevels.forEach((level, idx) => {
      candlestickSeries.createPriceLine({
        price: level,
        color: '#14b8a6',
        lineWidth: 1,
        lineStyle: 2, // Dashed
        axisLabelVisible: false,
      });
    });

    // Add lower levels (orange, faint)
    dnLevels.forEach((level, idx) => {
      candlestickSeries.createPriceLine({
        price: level,
        color: '#f97316',
        lineWidth: 1,
        lineStyle: 2, // Dashed
        axisLabelVisible: false,
      });
    });

    // Add TP/SL levels for open trades
    openTrades.forEach((trade, idx) => {
      // TP level (green)
      candlestickSeries.createPriceLine({
        price: trade.tp,
        color: '#10b981',
        lineWidth: 2,
        lineStyle: 0,
        axisLabelVisible: true,
        title: `TP ${trade.side} ${idx + 1}`,
      });

      // SL level (red)
      candlestickSeries.createPriceLine({
        price: trade.sl,
        color: '#ef4444',
        lineWidth: 2,
        lineStyle: 0,
        axisLabelVisible: true,
        title: `SL ${trade.side} ${idx + 1}`,
      });

      // Entry level (blue/yellow)
      candlestickSeries.createPriceLine({
        price: trade.entry,
        color: trade.side === 'LONG' ? '#3b82f6' : '#f59e0b',
        lineWidth: 2,
        lineStyle: 1, // Dotted
        axisLabelVisible: true,
        title: `Entry ${trade.side} ${idx + 1}`,
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
      candlestickSeries.setMarkers(chartMarkers);
    } else if (seriesRef.current) {
      candlestickSeries.setMarkers([]);
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
  }, [candles, dOpen, vwap, upLevels, dnLevels, upper, lower, markers, openTrades]);

  return <div ref={chartContainerRef} className="w-full h-[600px]" />;
}
