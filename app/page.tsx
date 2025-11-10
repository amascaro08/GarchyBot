'use client';

import { useState, useEffect } from 'react';
import Chart from '@/components/Chart';
import Cards from '@/components/Cards';
import TradeLog, { Trade } from '@/components/TradeLog';
import type { Candle, LevelsResponse, SignalResponse } from '@/lib/types';

const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
const DEFAULT_SYMBOL = 'BTCUSDT';
const POLL_INTERVAL = 12000; // 12 seconds
const SUBDIVISIONS = 5;
const NO_TRADE_BAND_PCT = 0.001;

export default function Home() {
  const [symbol, setSymbol] = useState<string>(DEFAULT_SYMBOL);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [levels, setLevels] = useState<LevelsResponse | null>(null);
  const [signal, setSignal] = useState<SignalResponse | null>(null);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [sessionPnL, setSessionPnL] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch klines
  const fetchKlines = async () => {
    try {
      const res = await fetch(`/api/klines?symbol=${symbol}&interval=5&limit=200&testnet=false`);
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to fetch klines');
      }
      const data = await res.json();
      setCandles(data);
      return data;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to fetch klines';
      setError(errorMsg);
      throw err;
    }
  };

  // Calculate volatility
  const calculateVol = async (closes: number[]) => {
    try {
      const res = await fetch('/api/vol', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol, closes }),
      });
      if (!res.ok) throw new Error('Failed to calculate volatility');
      const data = await res.json();
      return data.k_pct;
    } catch (err) {
      console.error('Vol calculation error:', err);
      return 0.02; // Default 2%
    }
  };

  // Fetch levels
  const fetchLevels = async (kPct: number) => {
    try {
      const res = await fetch('/api/levels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol, kPct, subdivisions: SUBDIVISIONS }),
      });
      if (!res.ok) throw new Error('Failed to fetch levels');
      const data = await res.json();
      setLevels(data);
      return data;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch levels');
      throw err;
    }
  };

  // Calculate signal
  const calculateSignal = async (candlesData: Candle[], kPct: number) => {
    try {
      const res = await fetch('/api/signal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol,
          kPct,
          subdivisions: SUBDIVISIONS,
          noTradeBandPct: NO_TRADE_BAND_PCT,
          candles: candlesData,
        }),
      });
      if (!res.ok) throw new Error('Failed to calculate signal');
      const data = await res.json();
      setSignal(data);
      return data;
    } catch (err) {
      console.error('Signal calculation error:', err);
      return null;
    }
  };

  // Main polling function
  const pollData = async () => {
    try {
      setLoading(true);
      setError(null);

      // Fetch klines
      const candlesData = await fetchKlines();
      if (candlesData.length === 0) {
        setLoading(false);
        return;
      }

      // Calculate volatility from daily closes (use last 30 days if available)
      const closes = candlesData.map((c: Candle) => c.close);
      const kPct = await calculateVol(closes);

      // Fetch levels
      const levelsData = await fetchLevels(kPct);

      // Calculate signal
      const signalData = await calculateSignal(candlesData, kPct);

      // Check for new signal and add to trade log
      if (signalData && signalData.signal && signalData.touchedLevel) {
        const lastTrade = trades[trades.length - 1];
        const isNewSignal =
          !lastTrade ||
          lastTrade.time !== new Date().toISOString() ||
          lastTrade.entry !== signalData.touchedLevel;

        if (isNewSignal) {
          const newTrade: Trade = {
            time: new Date().toISOString(),
            side: signalData.signal,
            entry: signalData.touchedLevel!,
            tp: signalData.tp!,
            sl: signalData.sl!,
            reason: signalData.reason,
            status: 'open',
          };
          setTrades((prev) => [...prev, newTrade]);
        }
      }

      // Simulate TP/SL checks for open trades
      if (candlesData.length > 0) {
        const lastCandle = candlesData[candlesData.length - 1];
        setTrades((prevTrades) => {
          return prevTrades.map((trade) => {
            if (trade.status !== 'open') return trade;

            let newStatus: 'open' | 'tp' | 'sl' | 'breakeven' = trade.status;
            let exitPrice: number | undefined;

            if (trade.side === 'LONG') {
              if (lastCandle.high >= trade.tp) {
                newStatus = 'tp';
                exitPrice = trade.tp;
              } else if (lastCandle.low <= trade.sl) {
                newStatus = 'sl';
                exitPrice = trade.sl;
              }
            } else {
              if (lastCandle.low <= trade.tp) {
                newStatus = 'tp';
                exitPrice = trade.tp;
              } else if (lastCandle.high >= trade.sl) {
                newStatus = 'sl';
                exitPrice = trade.sl;
              }
            }

            // Update P&L
            if (newStatus !== 'open' && exitPrice) {
              const pnl =
                trade.side === 'LONG'
                  ? exitPrice - trade.entry
                  : trade.entry - exitPrice;
              setSessionPnL((prev) => prev + pnl);
            }

            return { ...trade, status: newStatus, exitPrice };
          });
        });
      }

      setLoading(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to poll data');
      setLoading(false);
    }
  };

  // Initial load and polling
  useEffect(() => {
    pollData();
    const interval = setInterval(pollData, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [symbol]);

  // Prepare chart markers from signals
  const chartMarkers =
    signal && signal.signal && signal.touchedLevel
      ? [
          {
            time: candles[candles.length - 1]?.ts / 1000,
            position: signal.signal === 'LONG' ? ('belowBar' as const) : ('aboveBar' as const),
            color: signal.signal === 'LONG' ? '#10b981' : '#ef4444',
            shape: signal.signal === 'LONG' ? ('arrowUp' as const) : ('arrowDown' as const),
            text: `${signal.signal} @ ${signal.touchedLevel.toFixed(2)}`,
          },
        ]
      : [];

  return (
    <div className="min-h-screen text-white p-4 sm:p-6 lg:p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl sm:text-5xl font-bold mb-2 bg-gradient-to-r from-blue-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">
            VWAP + GARCH Grid Trading Dashboard
          </h1>
          <p className="text-gray-400 text-sm sm:text-base">Real-time trading signals powered by volatility analysis</p>
        </div>

        {/* Symbol selector */}
        <div className="mb-6">
          <label className="block text-sm font-medium mb-2 text-gray-300">Trading Pair</label>
          <select
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            className="glass-effect rounded-lg px-4 py-2.5 text-white font-medium cursor-pointer transition-all duration-200 hover:border-blue-500/50 focus:outline-none focus:ring-2 focus:ring-blue-500/50 w-full sm:w-auto min-w-[200px]"
          >
            {SYMBOLS.map((s) => (
              <option key={s} value={s} className="bg-slate-800">
                {s}
              </option>
            ))}
          </select>
        </div>

        {error && (
          <div className="glass-effect border-red-500/50 rounded-lg p-4 mb-6 text-red-400 shadow-lg shadow-red-500/10 animate-pulse">
            <div className="flex items-center gap-2">
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
              </svg>
              <span className="font-medium">Error: {error}</span>
            </div>
          </div>
        )}

        {loading && (
          <div className="text-center py-12">
            <div className="inline-flex items-center gap-3 text-gray-400">
              <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              <span className="font-medium">Loading market data...</span>
            </div>
          </div>
        )}

        {/* Main layout */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Chart - takes 2 columns */}
          <div className="lg:col-span-2">
            <div className="glass-effect rounded-xl p-4 sm:p-6 shadow-2xl card-hover">
              <div className="mb-4">
                <h2 className="text-xl font-semibold text-gray-200">Price Chart</h2>
                <p className="text-sm text-gray-400">Real-time candlestick data with trading levels</p>
              </div>
              <Chart
                candles={candles}
                dOpen={levels?.dOpen ?? null}
                vwap={levels?.vwap ?? null}
                upLevels={levels?.upLevels ?? []}
                dnLevels={levels?.dnLevels ?? []}
                markers={chartMarkers}
              />
            </div>
          </div>

          {/* Right sidebar - Cards and Trade Log */}
          <div className="space-y-6">
            <Cards
              price={candles.length > 0 ? candles[candles.length - 1].close : null}
              garchPct={levels ? (levels.upper - levels.lower) / (2 * levels.dOpen) : null}
              vwap={levels?.vwap ?? null}
              dOpen={levels?.dOpen ?? null}
              upper={levels?.upper ?? null}
              lower={levels?.lower ?? null}
            />
            <TradeLog trades={trades} sessionPnL={sessionPnL} />
          </div>
        </div>
      </div>
    </div>
  );
}
