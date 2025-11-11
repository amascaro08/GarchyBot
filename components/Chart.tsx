'use client';

import { useEffect, useRef, useState, useMemo } from 'react';
import { createChart, ColorType, IChartApi, ISeriesApi, CandlestickData, LineData, Time, IPriceLine } from 'lightweight-charts';
import type { Candle } from '@/lib/types';
import { getCachedMarketData } from '@/lib/websocket';
import { useWebSocket } from '@/lib/useWebSocket';

interface ChartProps {
  candles: Candle[];
  dOpen: number | null;
  vwap: number | null; // Current VWAP (for backward compatibility)
  vwapLine?: (number | null)[]; // Progressive VWAP values per candle
  upLevels: number[];
  dnLevels: number[];
  upper: number | null;
  lower: number | null;
  symbol?: string; // Add symbol for WebSocket subscription
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
  vwapLine,
  upLevels,
  dnLevels,
  upper,
  lower,
  symbol = 'BTCUSDT',
  markers = [],
  openTrades = []
}: ChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const vwapSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const lastProcessedRef = useRef<string>('');
  const lastCandleRef = useRef<Candle | null>(null);

  // Use WebSocket hook for real-time data, initialize with static candles
  const { candles: wsCandles, isConnected: wsConnected } = useWebSocket(symbol, candles);

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
        // Disable auto-scaling to prevent inappropriate scales for different assets
        handleScroll: false,
        handleScale: false,
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

      // Add VWAP line series
      const vwapLineSeries = chart.addLineSeries({
        color: '#8b5cf6', // Purple to distinguish from other lines
        lineWidth: 2,
        priceFormat: {
          type: 'price',
          precision: 2,
          minMove: 0.01,
        },
        title: 'VWAP',
        visible: true,
        priceLineVisible: false,
        lastValueVisible: true,
      });
      vwapSeriesRef.current = vwapLineSeries;

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
        vwapSeriesRef.current = null;
        priceLinesRef.current = [];
      };
    }
  }, []);


  // Use only websocket candles when available, otherwise fall back to static candles
  const displayCandles = useMemo(() => {
    if (wsConnected && wsCandles.length > 0) {
      return wsCandles;
    }
    return candles;
  }, [candles, wsCandles, wsConnected]);

  // Update chart data and price lines when props change
   useEffect(() => {
     if (!seriesRef.current || !chartRef.current) {
       // Chart not ready yet, wait for next render
       return;
     }

     // Don't proceed if we don't have candle data
     if (!displayCandles || displayCandles.length === 0) {
       return;
     }

     // Always update candlestick data first
     const candlestickData: CandlestickData<Time>[] = displayCandles.map((candle) => ({
       time: (candle.ts / 1000) as Time,
       open: candle.open,
       high: candle.high,
       low: candle.low,
       close: candle.close,
     }));

     seriesRef.current.setData(candlestickData);

     // After setting data, fit the chart to show all candles properly
     if (chartRef.current && displayCandles.length > 0) {
       // Small delay to ensure data is processed, then fit content and disable auto-scaling
       setTimeout(() => {
         if (chartRef.current) {
           chartRef.current.timeScale().fitContent();
           // Lock the scale to prevent auto-adjustments that cause inappropriate scaling
           const timeScale = chartRef.current.timeScale();
           timeScale.applyOptions({
             fixLeftEdge: true,
             fixRightEdge: true,
           });
         }
       }, 200); // Increased delay to ensure proper rendering
     }

    // Create a signature of price line data to prevent duplicate processing
    const priceLinesSignature = JSON.stringify({
      upper,
      lower,
      dOpen,
      vwap,
      upLevels: upLevels.slice().sort(),
      dnLevels: dnLevels.slice().sort(),
      openTrades: openTrades.map(t => `${t.entry}-${t.tp}-${t.sl}-${t.side}`).sort(),
      vwapLineLength: vwapLine?.length,
    });

    // Only update price lines if the signature has changed
    if (lastProcessedRef.current === priceLinesSignature) {
      return;
    }

    lastProcessedRef.current = priceLinesSignature;

    // Clear all existing price lines before adding new ones
    priceLinesRef.current.forEach(line => {
      try {
        if (line && seriesRef.current) {
          // Use the removePriceLine method from the series
          seriesRef.current.removePriceLine(line);
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

    // VWAP is now displayed as a line series, not a price line
    // Only show static VWAP price line if vwapLine is not available (fallback)
    if ((!vwapLine || vwapLine.length === 0) && vwap !== null && !isNaN(vwap) && vwap > 0 && seriesRef.current) {
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
  }, [displayCandles, dOpen, vwap, vwapLine, upLevels, dnLevels, upper, lower, markers, openTrades]);

  // Update VWAP line independently whenever candles or vwapLine changes
  useEffect(() => {
    if (!vwapSeriesRef.current || !candles || candles.length === 0) {
      return;
    }

    // Only require vwapLine to exist, don't require exact length match
    // This handles cases where candles might be filtered or updated
    if (vwapLine && vwapLine.length > 0) {
      const vwapData: LineData<Time>[] = [];
      
      // Create a map of candle timestamps for faster lookup
      const candleTimeMap = new Map<number, Candle>();
      candles.forEach(candle => {
        candleTimeMap.set(candle.ts, candle);
      });
      
      // Try to match vwapLine to candles by index first (most common case)
      const minLength = Math.min(candles.length, vwapLine.length);
      let matchedByIndex = true;
      
      for (let idx = 0; idx < minLength; idx++) {
        const vwapValue = vwapLine[idx];
        if (vwapValue !== null && !isNaN(vwapValue) && vwapValue > 0) {
          // Check if this index matches a valid candle
          if (idx < candles.length) {
            vwapData.push({
              time: (candles[idx].ts / 1000) as Time,
              value: vwapValue,
            });
          } else {
            matchedByIndex = false;
            break;
          }
        }
      }
      
      // If index matching didn't work well, try to match by finding candles from the levels API
      // For now, we'll use index matching as it should work if candles come from the same source
      
      if (vwapData.length > 0) {
        vwapSeriesRef.current.setData(vwapData);
        console.debug('VWAP line updated:', vwapData.length, 'points, candles:', candles.length, 'vwapLine:', vwapLine.length);
      } else {
        // If no valid VWAP data, clear the series
        vwapSeriesRef.current.setData([]);
        console.debug('VWAP line cleared: no valid data. candles:', candles.length, 'vwapLine:', vwapLine.length);
      }
    } else if (vwap !== null && !isNaN(vwap) && vwap > 0) {
      // Fallback: if vwapLine is not available, use static VWAP value
      // Create a line with the current VWAP at the last candle
      if (candles.length > 0) {
        const lastCandle = candles[candles.length - 1];
        vwapSeriesRef.current.setData([{
          time: (lastCandle.ts / 1000) as Time,
          value: vwap,
        }]);
        console.debug('VWAP fallback: using static value', vwap);
      }
    } else {
      console.debug('VWAP line not updated: missing data', { 
        vwapLine: !!vwapLine, 
        vwapLineLength: vwapLine?.length, 
        candlesLength: candles.length, 
        vwap 
      });
    }
  }, [displayCandles, vwapLine, vwap]);

  return <div ref={chartContainerRef} className="w-full h-[600px]" />;
}
