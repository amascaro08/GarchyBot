'use client';

import { useEffect, useRef } from 'react';
import { createChart, ColorType, IChartApi, ISeriesApi, CandlestickData, Time, IPriceLine } from 'lightweight-charts';
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
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const lastProcessedRef = useRef<string>('');

  useEffect(() => {
    if (!chartContainerRef.current) return;

    // Create chart only if it doesn't exist
    if (!chartRef.current) {
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
        chartRef.current = null;
        seriesRef.current = null;
        priceLinesRef.current = [];
      };
    }
  }, []);

  // Update chart data and price lines when props change
  useEffect(() => {
    if (!seriesRef.current || !chartRef.current) {
      // Chart not ready yet, wait for next render
      return;
    }

    // Don't proceed if we don't have candle data
    if (!candles || candles.length === 0) {
      return;
    }

    // Always update candlestick data first
    const candlestickData: CandlestickData<Time>[] = candles.map((candle) => ({
      time: (candle.ts / 1000) as Time,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
    }));

    seriesRef.current.setData(candlestickData);

    // Create a signature of price line data to prevent duplicate processing
    const priceLinesSignature = JSON.stringify({
      upper,
      lower,
      dOpen,
      vwap,
      upLevels,
      dnLevels,
      openTrades: openTrades.map(t => `${t.entry}-${t.tp}-${t.sl}-${t.side}`),
    });

    // Only update price lines if the signature has changed
    if (lastProcessedRef.current === priceLinesSignature) {
      return;
    }

    lastProcessedRef.current = priceLinesSignature;

    // Clear all existing price lines before adding new ones
    priceLinesRef.current.forEach(line => {
      try {
        if (line) {
          // Try using removePriceLine from the series
          if (seriesRef.current && typeof (seriesRef.current as any).removePriceLine === 'function') {
            (seriesRef.current as any).removePriceLine(line);
          } else if (typeof (line as any).remove === 'function') {
            (line as any).remove();
          }
        }
      } catch (e) {
        // Ignore errors if line was already removed
        console.debug('Error removing price line:', e);
      }
    });
    priceLinesRef.current = [];

    // Add upper and lower bounds
    if (upper !== null && seriesRef.current) {
      const line = seriesRef.current.createPriceLine({
        price: upper,
        color: '#10b981',
        lineWidth: 2,
        lineStyle: 0,
        axisLabelVisible: true,
        title: 'Upper Bound',
      });
      priceLinesRef.current.push(line);
    }

    if (lower !== null && seriesRef.current) {
      const line = seriesRef.current.createPriceLine({
        price: lower,
        color: '#ef4444',
        lineWidth: 2,
        lineStyle: 0,
        axisLabelVisible: true,
        title: 'Lower Bound',
      });
      priceLinesRef.current.push(line);
    }

    // Add zone visualization (4 equal zones)
    if (upper !== null && lower !== null && dOpen !== null && seriesRef.current) {
      const range = upper - lower;
      const zoneSize = range / 4;
      
      const zone1 = seriesRef.current.createPriceLine({
        price: lower + zoneSize,
        color: '#ef4444',
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: 'Zone 1/4',
      });
      priceLinesRef.current.push(zone1);
      
      if (lower + zoneSize < dOpen) {
        const zone2 = seriesRef.current.createPriceLine({
          price: lower + zoneSize * 2,
          color: '#f97316',
          lineWidth: 1,
          lineStyle: 2,
          axisLabelVisible: true,
          title: 'Zone 2/4',
        });
        priceLinesRef.current.push(zone2);
      }
      
      if (dOpen < upper - zoneSize) {
        const zone3 = seriesRef.current.createPriceLine({
          price: upper - zoneSize * 2,
          color: '#3b82f6',
          lineWidth: 1,
          lineStyle: 2,
          axisLabelVisible: true,
          title: 'Zone 3/4',
        });
        priceLinesRef.current.push(zone3);
      }
      
      const zone4 = seriesRef.current.createPriceLine({
        price: upper - zoneSize,
        color: '#10b981',
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: 'Zone 4/4',
      });
      priceLinesRef.current.push(zone4);
    }

    // Add dOpen
    if (dOpen !== null && seriesRef.current) {
      const line = seriesRef.current.createPriceLine({
        price: dOpen,
        color: '#fbbf24',
        lineWidth: 2,
        lineStyle: 0,
        axisLabelVisible: true,
        title: 'Daily Open',
      });
      priceLinesRef.current.push(line);
    }

    // Add VWAP - make it more distinct (purple, thick line)
    if (vwap !== null && !isNaN(vwap) && vwap > 0 && seriesRef.current) {
      const line = seriesRef.current.createPriceLine({
        price: vwap,
        color: '#8b5cf6', // Purple to distinguish from other green lines
        lineWidth: 3,
        lineStyle: 0, // Solid
        axisLabelVisible: true,
        title: `VWAP: ${vwap.toFixed(2)}`,
      });
      priceLinesRef.current.push(line);
    }

    // Add upper levels (U1-U5) - ensure they're visible
    if (upLevels.length > 0 && seriesRef.current) {
      upLevels.forEach((level, idx) => {
        if (!isNaN(level) && level > 0) {
          const line = seriesRef.current!.createPriceLine({
            price: level,
            color: '#14b8a6',
            lineWidth: 2,
            lineStyle: 2, // Dashed
            axisLabelVisible: true,
            title: `U${idx + 1}`,
          });
          priceLinesRef.current.push(line);
        }
      });
    }

    // Add lower levels (D1-D5) - ensure they're visible
    if (dnLevels.length > 0 && seriesRef.current) {
      dnLevels.forEach((level, idx) => {
        if (!isNaN(level) && level > 0) {
          const line = seriesRef.current!.createPriceLine({
            price: level,
            color: '#f97316',
            lineWidth: 2,
            lineStyle: 2, // Dashed
            axisLabelVisible: true,
            title: `D${idx + 1}`,
          });
          priceLinesRef.current.push(line);
        }
      });
    }

    // Add TP/SL levels for open trades
    if (seriesRef.current && openTrades.length > 0) {
      openTrades.forEach((trade, idx) => {
        const tpLine = seriesRef.current!.createPriceLine({
          price: trade.tp,
          color: '#10b981',
          lineWidth: 2,
          lineStyle: 0,
          axisLabelVisible: true,
          title: `TP ${trade.side} ${idx + 1}`,
        });
        priceLinesRef.current.push(tpLine);

        const slLine = seriesRef.current!.createPriceLine({
          price: trade.sl,
          color: '#ef4444',
          lineWidth: 2,
          lineStyle: 0,
          axisLabelVisible: true,
          title: `SL ${trade.side} ${idx + 1}`,
        });
        priceLinesRef.current.push(slLine);

        const entryLine = seriesRef.current!.createPriceLine({
          price: trade.entry,
          color: trade.side === 'LONG' ? '#3b82f6' : '#f59e0b',
          lineWidth: 2,
          lineStyle: 1,
          axisLabelVisible: true,
          title: `Entry ${trade.side} ${idx + 1}`,
        });
        priceLinesRef.current.push(entryLine);
      });
    }

    // Add markers
    if (seriesRef.current) {
      if (markers.length > 0) {
        const chartMarkers = markers.map((m) => ({
          time: m.time as Time,
          position: m.position as 'aboveBar' | 'belowBar',
          color: m.color,
          shape: m.shape as 'circle' | 'arrowUp' | 'arrowDown',
          text: m.text,
        }));
        seriesRef.current.setMarkers(chartMarkers);
      } else {
        seriesRef.current.setMarkers([]);
      }
    }
  }, [candles, dOpen, vwap, upLevels, dnLevels, upper, lower, markers, openTrades]);

  return <div ref={chartContainerRef} className="w-full h-[600px]" />;
}
