'use client';

import { useState, useEffect, useRef } from 'react';
import Chart from '@/components/Chart';
import Cards from '@/components/Cards';
import TradeLog, { Trade } from '@/components/TradeLog';
import TradesTable from '@/components/TradesTable';
import type { Candle, LevelsResponse, SignalResponse } from '@/lib/types';

const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
const DEFAULT_SYMBOL = 'BTCUSDT';
const POLL_INTERVAL = 12000; // 12 seconds
const SUBDIVISIONS = 5;
const NO_TRADE_BAND_PCT = 0.001;
const DEFAULT_MAX_TRADES = 3;
const DEFAULT_LEVERAGE = 1;
const DEFAULT_CAPITAL = 10000;
const DEFAULT_RISK_AMOUNT = 100;
const DEFAULT_RISK_TYPE = 'fixed'; // 'fixed' or 'percent'
const INTERVALS = [
  { value: '1', label: '1m' },
  { value: '3', label: '3m' },
  { value: '5', label: '5m' },
  { value: '15', label: '15m' },
  { value: '60', label: '1h' },
  { value: '120', label: '2h' },
  { value: '240', label: '4h' },
];
const DEFAULT_INTERVAL = '5';

export default function Home() {
  const [symbol, setSymbol] = useState<string>(DEFAULT_SYMBOL);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [levels, setLevels] = useState<LevelsResponse | null>(null);
  const [signal, setSignal] = useState<SignalResponse | null>(null);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [sessionPnL, setSessionPnL] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [botRunning, setBotRunning] = useState<boolean>(false);
  const [maxTrades, setMaxTrades] = useState<number>(DEFAULT_MAX_TRADES);
  const [leverage, setLeverage] = useState<number>(DEFAULT_LEVERAGE);
  const [candleInterval, setCandleInterval] = useState<string>(DEFAULT_INTERVAL);
  const [capital, setCapital] = useState<number>(DEFAULT_CAPITAL);
  const [riskAmount, setRiskAmount] = useState<number>(DEFAULT_RISK_AMOUNT);
  const [riskType, setRiskType] = useState<'fixed' | 'percent'>(DEFAULT_RISK_TYPE);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Fetch klines
  const fetchKlines = async () => {
    try {
      // Use mainnet by default (more reliable for public data)
      const res = await fetch(`/api/klines?symbol=${symbol}&interval=${candleInterval}&limit=200&testnet=false`);
      
      let data;
      try {
        data = await res.json();
      } catch (parseError) {
        // If JSON parsing fails, throw with status
        throw new Error(`Failed to parse response: HTTP ${res.status} ${res.statusText}`);
      }
      
      if (!res.ok) {
        throw new Error(data.error || `Failed to fetch klines: HTTP ${res.status}`);
      }
      
      if (!data || !Array.isArray(data) || data.length === 0) {
        throw new Error('No kline data received from API');
      }
      
      setCandles(data);
      return data;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to fetch klines';
      setError(errorMsg);
      console.error('fetchKlines error:', err);
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
        body: JSON.stringify({ 
          symbol, 
          kPct, 
          subdivisions: SUBDIVISIONS, 
          interval: candleInterval,
          testnet: false, // Match the testnet setting used for klines
        }),
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to fetch levels');
      }
      const data = await res.json();
      setLevels(data);
      return data;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to fetch levels';
      setError(errorMsg);
      console.error('fetchLevels error:', err);
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

  // Main polling function - uses current symbol/interval from closure
  const pollData = async () => {
    // Capture current values to ensure we use latest
    const currentSymbol = symbol;
    const currentInterval = candleInterval;
    
    try {
      setLoading(true);
      setError(null);

      // Fetch klines
      const candlesData = await fetchKlines();
      if (candlesData.length === 0) {
        setLoading(false);
        return;
      }

      // Verify symbol hasn't changed during fetch
      if (currentSymbol !== symbol) {
        console.log('Symbol changed during fetch, aborting');
        setLoading(false);
        return;
      }

      // Calculate volatility from daily closes (use last 30 days if available)
      const closes = candlesData.map((c: Candle) => c.close);
      const kPct = await calculateVol(closes);

      // Fetch levels - ensure we use current symbol and interval
      const levelsData = await fetchLevels(kPct);
      
      // Verify levels match current symbol (double check)
      if (levelsData.symbol !== symbol || symbol !== currentSymbol) {
        console.warn('Levels symbol mismatch, skipping update');
        setLoading(false);
        return;
      }

      // Calculate signal
      const signalData = await calculateSignal(candlesData, kPct);

      // Check for new signal and add to trade log
      // Only enter trades if bot is running AND we have valid signal
      if (botRunning && signalData && signalData.signal && signalData.touchedLevel) {
        // Use functional update to get current trades state
        setTrades((prevTrades) => {
          // Check max trades limit with current state
          const openTrades = prevTrades.filter((t) => t.status === 'open');
          if (openTrades.length >= maxTrades) {
            console.log(`Max trades limit reached (${maxTrades}). Skipping new signal.`);
            return prevTrades;
          }

          // Check if there's already an open trade at this exact level/symbol/side
          // This prevents duplicate entries on small price fluctuations
          const duplicateTrade = openTrades.find(
            (t) =>
              t.symbol === symbol &&
              t.side === signalData.signal &&
              Math.abs(t.entry - signalData.touchedLevel!) < 0.01 // Allow small tolerance for floating point
          );

          if (duplicateTrade) {
            console.log(`Duplicate trade detected at level ${signalData.touchedLevel}. Skipping.`);
            return prevTrades;
          }

          // Calculate position size based on risk management
          const riskPerTrade = riskType === 'percent' 
            ? (capital * riskAmount) / 100 
            : riskAmount;
          
          // Calculate position size: risk amount / (entry - stop loss)
          const stopLossDistance = Math.abs(signalData.touchedLevel! - signalData.sl!);
          const positionSize = stopLossDistance > 0 
            ? riskPerTrade / stopLossDistance 
            : 0;

          const newTrade: Trade = {
            time: new Date().toISOString(),
            side: signalData.signal,
            entry: signalData.touchedLevel!,
            tp: signalData.tp!,
            sl: signalData.sl!,
            reason: signalData.reason,
            status: 'open',
            symbol: symbol,
            leverage: leverage,
            positionSize: positionSize,
          };
          
          return [...prevTrades, newTrade];
        });
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

            // Update P&L (with position size)
            if (newStatus !== 'open' && exitPrice) {
              const positionSize = trade.positionSize || 0;
              const pnl =
                trade.side === 'LONG'
                  ? (exitPrice - trade.entry) * positionSize
                  : (trade.entry - exitPrice) * positionSize;
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
    // Reset levels and signal when symbol or interval changes to force refresh
    setLevels(null);
    setSignal(null);
    setCandles([]);

    // Create a function that uses current symbol/interval values
    const loadData = async () => {
      try {
        setLoading(true);
        setError(null);

        // Fetch klines with current symbol and interval
        const res = await fetch(`/api/klines?symbol=${symbol}&interval=${candleInterval}&limit=200&testnet=false`);
        const klinesData = await res.json();
        
        if (!res.ok || !klinesData || !Array.isArray(klinesData) || klinesData.length === 0) {
          setLoading(false);
          return;
        }

        setCandles(klinesData);

        // Calculate volatility
        const closes = klinesData.map((c: Candle) => c.close);
        const volRes = await fetch('/api/vol', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ symbol, closes }),
        });
        const volData = await volRes.json();
        const kPct = volData.k_pct || 0.02;

        // Fetch levels with current symbol and interval
        const levelsRes = await fetch('/api/levels', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            symbol, 
            kPct, 
            subdivisions: SUBDIVISIONS, 
            interval: candleInterval,
            testnet: false,
          }),
        });
        const levelsData = await levelsRes.json();
        
        // Only update if symbol still matches (prevent race conditions)
        if (levelsData.symbol === symbol) {
          setLevels(levelsData);
        }

        // Calculate signal
        const signalRes = await fetch('/api/signal', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            symbol,
            kPct,
            subdivisions: SUBDIVISIONS,
            noTradeBandPct: NO_TRADE_BAND_PCT,
            candles: klinesData,
          }),
        });
        const signalData = await signalRes.json();
        if (signalData.symbol === symbol) {
          setSignal(signalData);
        }

        setLoading(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load data');
        setLoading(false);
      }
    };

    if (botRunning) {
      loadData();
      const intervalId = setInterval(() => {
        pollData();
      }, POLL_INTERVAL);
      pollingIntervalRef.current = intervalId;
      return () => {
        if (pollingIntervalRef.current) {
          clearInterval(pollingIntervalRef.current);
          pollingIntervalRef.current = null;
        }
      };
    } else {
      // Load initial data even when bot is stopped
      loadData();
    }
  }, [symbol, candleInterval, botRunning]);

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

  // Get open trades for chart visualization
  const openTrades = trades
    .filter((t) => t.status === 'open')
    .map((t) => ({
      entry: t.entry,
      tp: t.tp,
      sl: t.sl,
      side: t.side,
    }));

  // Get current price
  const currentPrice = candles.length > 0 ? candles[candles.length - 1].close : null;

  const handleStartBot = () => {
    setBotRunning(true);
    setError(null);
  };

  const handleStopBot = () => {
    setBotRunning(false);
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
  };

  return (
    <div className="min-h-screen text-white p-4 sm:p-6 lg:p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl sm:text-5xl font-bold mb-2 bg-gradient-to-r from-blue-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">
            Garchy Bot
          </h1>
          <p className="text-gray-400 text-sm sm:text-base">Real-time trading signals powered by volatility analysis</p>
        </div>

        {/* Symbol selector and Bot controls */}
        <div className="mb-6 space-y-4">
          <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
            <div className="flex-1 grid grid-cols-1 sm:grid-cols-4 gap-4">
              <div>
                <label className="block text-sm font-medium mb-2 text-gray-300">Trading Pair</label>
                <select
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value)}
                  className="glass-effect rounded-lg px-4 py-2.5 text-white font-medium cursor-pointer transition-all duration-200 hover:border-blue-500/50 focus:outline-none focus:ring-2 focus:ring-blue-500/50 w-full"
                >
                  {SYMBOLS.map((s) => (
                    <option key={s} value={s} className="bg-slate-800">
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-2 text-gray-300">Interval</label>
                <select
                  value={candleInterval}
                  onChange={(e) => setCandleInterval(e.target.value)}
                  className="glass-effect rounded-lg px-4 py-2.5 text-white font-medium cursor-pointer transition-all duration-200 hover:border-blue-500/50 focus:outline-none focus:ring-2 focus:ring-blue-500/50 w-full"
                >
                  {INTERVALS.map((int) => (
                    <option key={int.value} value={int.value} className="bg-slate-800">
                      {int.label}
                    </option>
                  ))}
                </select>
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-2 text-gray-300">Max Trades</label>
                <input
                  type="number"
                  min="1"
                  max="10"
                  value={maxTrades}
                  onChange={(e) => setMaxTrades(Math.max(1, Math.min(10, parseInt(e.target.value) || 1)))}
                  className="glass-effect rounded-lg px-4 py-2.5 text-white font-medium w-full transition-all duration-200 hover:border-blue-500/50 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-2 text-gray-300">Leverage</label>
                <input
                  type="number"
                  min="1"
                  max="100"
                  step="1"
                  value={leverage}
                  onChange={(e) => setLeverage(Math.max(1, Math.min(100, parseFloat(e.target.value) || 1)))}
                  className="glass-effect rounded-lg px-4 py-2.5 text-white font-medium w-full transition-all duration-200 hover:border-blue-500/50 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                />
              </div>
            </div>
            
            <div className="flex gap-3 items-end">
              {!botRunning ? (
                <button
                  onClick={handleStartBot}
                  className="glass-effect rounded-lg px-6 py-2.5 bg-green-500/20 text-green-400 border border-green-500/30 font-semibold hover:bg-green-500/30 transition-all duration-200 flex items-center gap-2"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Start Bot
                </button>
              ) : (
                <button
                  onClick={handleStopBot}
                  className="glass-effect rounded-lg px-6 py-2.5 bg-red-500/20 text-red-400 border border-red-500/30 font-semibold hover:bg-red-500/30 transition-all duration-200 flex items-center gap-2"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 10h6v4H9z" />
                  </svg>
                  Stop Bot
                </button>
              )}
              {botRunning && (
                <div className="flex items-center gap-2 text-green-400">
                  <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
                  <span className="text-sm font-medium">Running</span>
                </div>
              )}
            </div>
          </div>
          
          {/* Risk Management Controls */}
          <div className="glass-effect rounded-lg p-4 border border-slate-700/50">
            <h3 className="text-sm font-semibold text-gray-300 mb-3">Risk Management</h3>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
              <div>
                <label className="block text-xs font-medium mb-2 text-gray-400">Capital ($)</label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={capital}
                  onChange={(e) => setCapital(Math.max(1, parseFloat(e.target.value) || 1))}
                  className="glass-effect rounded-lg px-4 py-2 text-white font-medium w-full transition-all duration-200 hover:border-blue-500/50 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-2 text-gray-400">Risk Type</label>
                <select
                  value={riskType}
                  onChange={(e) => setRiskType(e.target.value as 'fixed' | 'percent')}
                  className="glass-effect rounded-lg px-4 py-2 text-white font-medium cursor-pointer transition-all duration-200 hover:border-blue-500/50 focus:outline-none focus:ring-2 focus:ring-blue-500/50 w-full"
                >
                  <option value="fixed" className="bg-slate-800">Fixed $</option>
                  <option value="percent" className="bg-slate-800">% of Capital</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-2 text-gray-400">
                  Risk {riskType === 'percent' ? '(%)' : '($)'}
                </label>
                <input
                  type="number"
                  min="0.01"
                  step={riskType === 'percent' ? "0.1" : "1"}
                  value={riskAmount}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value) || 0;
                    if (riskType === 'percent') {
                      setRiskAmount(Math.max(0.01, Math.min(100, val)));
                    } else {
                      setRiskAmount(Math.max(0.01, val));
                    }
                  }}
                  className="glass-effect rounded-lg px-4 py-2 text-white font-medium w-full transition-all duration-200 hover:border-blue-500/50 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                />
              </div>
              <div className="flex items-end">
                <div className="glass-effect rounded-lg px-4 py-2 w-full border border-purple-500/30 bg-purple-500/10">
                  <div className="text-xs text-gray-400 mb-1">Risk Per Trade</div>
                  <div className="text-sm font-semibold text-purple-300">
                    ${riskType === 'percent' 
                      ? ((capital * riskAmount) / 100).toFixed(2)
                      : riskAmount.toFixed(2)}
                  </div>
                </div>
              </div>
            </div>
          </div>
          
          <div className="flex gap-2 text-xs text-gray-400">
            <span>Open Trades: {trades.filter(t => t.status === 'open').length}/{maxTrades}</span>
            <span>•</span>
            <span>Leverage: {leverage}x</span>
            <span>•</span>
            <span>Interval: {INTERVALS.find(i => i.value === candleInterval)?.label || candleInterval}</span>
          </div>
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
                upper={levels?.upper ?? null}
                lower={levels?.lower ?? null}
                markers={chartMarkers}
                openTrades={openTrades}
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
            <TradeLog trades={trades} sessionPnL={sessionPnL} currentPrice={currentPrice} />
          </div>
        </div>

        {/* Trades Table */}
        <div className="mt-6">
          <TradesTable trades={trades} currentPrice={currentPrice} />
        </div>
      </div>
    </div>
  );
}
