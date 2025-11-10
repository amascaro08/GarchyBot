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
      const res = await fetch(`/api/klines?symbol=${symbol}&interval=5&limit=200&testnet=true`);
      if (!res.ok) throw new Error('Failed to fetch klines');
      const data = await res.json();
      setCandles(data);
      return data;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch klines');
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
    <div className="min-h-screen bg-gray-900 text-white p-6">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-3xl font-bold mb-6">VWAP + GARCH Grid Trading Dashboard</h1>

        {/* Symbol selector */}
        <div className="mb-6">
          <label className="block text-sm font-medium mb-2">Symbol</label>
          <select
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded px-4 py-2 text-white"
          >
            {SYMBOLS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        {error && (
          <div className="bg-red-900/20 border border-red-700 rounded p-4 mb-6 text-red-400">
            Error: {error}
          </div>
        )}

        {loading && (
          <div className="text-center py-8 text-gray-400">Loading data...</div>
        )}

        {/* Main layout */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Chart - takes 2 columns */}
          <div className="lg:col-span-2">
            <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
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
