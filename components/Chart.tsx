'use client';

import { useEffect, useRef, useMemo } from 'react';
import { createChart, ColorType, IChartApi, ISeriesApi, CandlestickData, LineData, Time, IPriceLine, PriceScaleMode } from 'lightweight-charts';
import type { Candle } from '@/lib/types';
import { useSharedWebSocket } from '@/lib/WebSocketContext';

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
  interval?: string;
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
  height?: number;
  onPriceUpdate?: (price: number) => void;
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
  interval = '5',
  markers = [],
  openTrades = [],
  height = 600,
  onPriceUpdate,
}: ChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const vwapSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const lastProcessedRef = useRef<string>('');
  const lastCandleRef = useRef<Candle | null>(null);
  const hasInitialFitRef = useRef<boolean>(false);
  const lastNotifiedPriceRef = useRef<number | null>(null);
  const onPriceUpdateRef = useRef<typeof onPriceUpdate | null>(null);
  const updateCheckIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const candlesSignatureRef = useRef<string>('');
  const lastCandleCountRef = useRef<number>(0);

  useEffect(() => {
    onPriceUpdateRef.current = onPriceUpdate;
  }, [onPriceUpdate]);

  // Use shared WebSocket connection (eliminates duplicate connections)
  const { candles: wsCandles, isConnected: wsConnected, ticker } = useSharedWebSocket();

  // Update price from ticker in real-time (separate from candle updates)
  useEffect(() => {
    if (ticker?.lastPrice && ticker.lastPrice > 0) {
      if (ticker.lastPrice !== lastNotifiedPriceRef.current) {
        lastNotifiedPriceRef.current = ticker.lastPrice;
        if (onPriceUpdateRef.current) {
          onPriceUpdateRef.current(ticker.lastPrice);
        }
      }
    }
  }, [ticker?.lastPrice, ticker?.timestamp]);

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
        height,
        grid: {
          vertLines: { color: '#2a2a2a' },
          horzLines: { color: '#2a2a2a' },
        },
        timeScale: {
          timeVisible: true,
          secondsVisible: false,
        },
        // Allow user interaction but prevent automatic scaling issues
        handleScroll: true,
        handleScale: true,
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
        if (updateCheckIntervalRef.current) {
          clearInterval(updateCheckIntervalRef.current);
          updateCheckIntervalRef.current = null;
        }
        chart.remove();
        chartRef.current = null;
        seriesRef.current = null;
        vwapSeriesRef.current = null;
        priceLinesRef.current = [];
      };
    }
  }, []);

  useEffect(() => {
    if (chartRef.current) {
      chartRef.current.applyOptions({ height });
    }
  }, [height]);

  useEffect(() => {
    // Reset all tracking refs when symbol/interval changes
    hasInitialFitRef.current = false;
    candlesSignatureRef.current = '';
    lastCandleCountRef.current = 0;
    lastProcessedRef.current = '';
    lastNotifiedPriceRef.current = null;
    
    if (updateCheckIntervalRef.current) {
      clearInterval(updateCheckIntervalRef.current);
      updateCheckIntervalRef.current = null;
    }
    
    // Clear existing data and reset chart scale
    if (chartRef.current && seriesRef.current && vwapSeriesRef.current) {
      // Clear series data immediately
      seriesRef.current.setData([]);
      vwapSeriesRef.current.setData([]);
      
      // Remove all price lines
      priceLinesRef.current.forEach(line => {
        try {
          if (line && seriesRef.current) {
            seriesRef.current.removePriceLine(line);
          }
        } catch (e) {
          // Ignore errors if line was already removed
        }
      });
      priceLinesRef.current = [];
      
      // Clear any markers
      seriesRef.current.setMarkers([]);
      
      // Reset chart scale and fit content
      chartRef.current.timeScale().fitContent();
      chartRef.current.timeScale().scrollToPosition(0, false);
      chartRef.current.priceScale('right').applyOptions({ 
        mode: PriceScaleMode.Normal,
        autoScale: true 
      });
    }
  }, [symbol, interval]);


  // Use WebSocket candles when connected, otherwise use static candles
  // Force update when candle count changes or when WebSocket connects/disconnects
  const displayCandles = useMemo(() => {
    // Prefer WebSocket candles if connected and we have data
    if (wsConnected && wsCandles.length > 0) {
      return wsCandles;
    }
    // Fall back to static candles
    return candles.length > 0 ? candles : [];
  }, [candles, wsCandles, wsConnected]);

  // Create a signature of the candles array to detect changes
  // Include candle count to detect when new candles are added
  const candlesSignature = useMemo(() => {
    if (!displayCandles || displayCandles.length === 0) return '';
    // Include count in signature to detect new candles
    const lastCandle = displayCandles[displayCandles.length - 1];
    if (!lastCandle) return '';
    // Use last candle's full data plus count to detect any changes
    return `${displayCandles.length}-${lastCandle.ts}-${lastCandle.open}-${lastCandle.high}-${lastCandle.low}-${lastCandle.close}-${lastCandle.volume || 0}`;
  }, [displayCandles]);

  // Update chart data when candles change (from WebSocket or static)
  useEffect(() => {
    if (!seriesRef.current || !chartRef.current) {
      return;
    }

    if (!displayCandles || displayCandles.length === 0) {
      return;
    }

    // Check if we need to update: signature changed OR candle count changed
    const candleCountChanged = displayCandles.length !== lastCandleCountRef.current;
    const signatureChanged = candlesSignature !== candlesSignatureRef.current;
    
    // Always update if WebSocket is connected (real-time data should always update)
    // For static candles, only update if signature or count changed
    if (wsConnected) {
      // WebSocket connected - always update to ensure real-time updates
      // But skip if signature hasn't changed and we've already processed this data
      if (!signatureChanged && !candleCountChanged && candlesSignature !== '' && candlesSignatureRef.current === candlesSignature) {
        return;
      }
    } else {
      // Static candles - only update if signature/count changed
      if (!signatureChanged && !candleCountChanged && candlesSignature !== '') {
        return;
      }
    }

    candlesSignatureRef.current = candlesSignature;
    lastCandleCountRef.current = displayCandles.length;

    // Convert candles to chart format
    const candlestickData: CandlestickData<Time>[] = displayCandles.map((candle) => ({
      time: (candle.ts / 1000) as Time,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
    }));

    // Use setData to update chart - lightweight-charts handles this efficiently
    // It only updates what changed internally
    seriesRef.current.setData(candlestickData);

    const priceScale = seriesRef.current?.priceScale();
    if (priceScale) {
      priceScale.applyOptions({ mode: PriceScaleMode.Normal });
    }

    // Update price from ticker if available (real-time), otherwise use latest candle close
    const priceToUse = ticker?.lastPrice && ticker.lastPrice > 0 
      ? ticker.lastPrice 
      : displayCandles[displayCandles.length - 1]?.close;
    
    if (priceToUse && priceToUse !== lastNotifiedPriceRef.current) {
      lastNotifiedPriceRef.current = priceToUse;
      if (onPriceUpdateRef.current) {
        onPriceUpdateRef.current(priceToUse);
      }
    }

    // Only fit content on the VERY FIRST load (when chart is created)
    // After that, preserve user zoom/pan settings
    // This check ensures fitContent() is called only once per symbol/interval
    if (!hasInitialFitRef.current && chartRef.current && displayCandles.length > 0) {
      // Use setTimeout to ensure DOM is ready and avoid layout thrashing
      setTimeout(() => {
        if (chartRef.current && !hasInitialFitRef.current) {
          chartRef.current.timeScale().fitContent();
          hasInitialFitRef.current = true;
        }
      }, 100);
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
        // Don't log to reduce console noise
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
        axisLabelVisible: false,
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
            axisLabelVisible: false,
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
            axisLabelVisible: false,
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
  }, [displayCandles, candlesSignature, wsConnected, ticker, dOpen, vwap, vwapLine, upLevels, dnLevels, upper, lower, markers, openTrades]);

  // Monitor for chart freezing - if candles signature stops updating but we have WebSocket data, force refresh
  useEffect(() => {
    if (!wsConnected || displayCandles.length === 0) {
      return;
    }

    let lastSignature = candlesSignature;
    let lastCheckTime = Date.now();

    const checkInterval = setInterval(() => {
      // If signature hasn't changed in 10 seconds but we have WebSocket connection, something might be wrong
      if (candlesSignature === lastSignature && Date.now() - lastCheckTime > 10000) {
        const currentSignature = displayCandles.slice(-3).map(c => `${c.ts}-${c.open}-${c.high}-${c.low}-${c.close}`).join('|');
        if (currentSignature !== candlesSignatureRef.current) {
          // New data available but signature didn't update - force refresh
          console.warn('Chart update may be stuck, forcing refresh...');
          candlesSignatureRef.current = ''; // Reset to force update
        }
      }
      lastSignature = candlesSignature;
      lastCheckTime = Date.now();
    }, 5000); // Check every 5 seconds

    updateCheckIntervalRef.current = checkInterval;

    return () => {
      if (updateCheckIntervalRef.current) {
        clearInterval(updateCheckIntervalRef.current);
        updateCheckIntervalRef.current = null;
      }
    };
  }, [displayCandles, wsConnected, candlesSignature]);

  // Update VWAP line independently whenever candles or vwapLine changes
  useEffect(() => {
    if (!vwapSeriesRef.current || !candles || candles.length === 0) {
      return;
    }

    // Only require vwapLine to exist, don't require exact length match
    // This handles cases where candles might be filtered or updated
    if (vwapLine && vwapLine.length > 0) {
      const vwapData: LineData<Time>[] = [];

      const sourceCandles = displayCandles;

      const minLength = Math.min(sourceCandles.length, vwapLine.length);
      for (let idx = 0; idx < minLength; idx++) {
        const vwapValue = vwapLine[idx];
        if (vwapValue !== null && !isNaN(vwapValue) && vwapValue > 0) {
          vwapData.push({
            time: (sourceCandles[idx].ts / 1000) as Time,
            value: vwapValue,
          });
        }
      }
      
      if (vwapData.length > 0) {
        vwapSeriesRef.current.setData(vwapData);
        // Reduce console logging to prevent spam
      } else {
        // If no valid VWAP data, clear the series
        vwapSeriesRef.current.setData([]);
      }
    } else if (vwap !== null && !isNaN(vwap) && vwap > 0) {
      // Fallback: if vwapLine is not available, use static VWAP value
      // Create a line with the current VWAP at the last candle
      if (displayCandles.length > 0) {
        const lastCandle = displayCandles[displayCandles.length - 1];
        vwapSeriesRef.current.setData([{
          time: (lastCandle.ts / 1000) as Time,
          value: vwap,
        }]);
      }
    } else {
      // Clear VWAP line if no data
      vwapSeriesRef.current.setData([]);
    }
  }, [displayCandles, vwapLine, vwap]);

  return <div ref={chartContainerRef} className="w-full" style={{ height }} />;
}
