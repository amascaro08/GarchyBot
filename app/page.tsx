'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import Chart from '@/components/Chart';
import Cards from '@/components/Cards';
import TradeLog, { Trade } from '@/components/TradeLog';
import TradesTable from '@/components/TradesTable';
import type { Candle, LevelsResponse, SignalResponse } from '@/lib/types';
import { applyBreakeven } from '@/lib/strategy';
import { startOrderBook, stopOrderBook, confirmLevelTouch } from '@/lib/orderbook';

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
const DEFAULT_DAILY_TARGET_TYPE = 'percent'; // 'fixed' or 'percent'
const DEFAULT_DAILY_TARGET_AMOUNT = 5; // 5% or $500
const DEFAULT_DAILY_STOP_TYPE = 'percent'; // 'fixed' or 'percent'
const DEFAULT_DAILY_STOP_AMOUNT = 3; // 3% or $300
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
  const [useOrderBookConfirm, setUseOrderBookConfirm] = useState<boolean>(true);
  const [kPct, setKPct] = useState<number>(3); // Will be filled by /levels
  const [dailyPnL, setDailyPnL] = useState<number>(0);
  const [dailyTargetType, setDailyTargetType] = useState<'fixed' | 'percent'>(DEFAULT_DAILY_TARGET_TYPE);
  const [dailyTargetAmount, setDailyTargetAmount] = useState<number>(DEFAULT_DAILY_TARGET_AMOUNT);
  const [dailyStopType, setDailyStopType] = useState<'fixed' | 'percent'>(DEFAULT_DAILY_STOP_TYPE);
  const [dailyStopAmount, setDailyStopAmount] = useState<number>(DEFAULT_DAILY_STOP_AMOUNT);
  const [dailyStartDate, setDailyStartDate] = useState<string>(() => {
    // Get current UTC date string (YYYY-MM-DD)
    return new Date().toISOString().split('T')[0];
  });
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Calculate daily limits
  const dailyTargetValue = useMemo(() => {
    return dailyTargetType === 'percent' 
      ? (capital * dailyTargetAmount) / 100 
      : dailyTargetAmount;
  }, [dailyTargetType, dailyTargetAmount, capital]);

  const dailyStopValue = useMemo(() => {
    return dailyStopType === 'percent' 
      ? (capital * dailyStopAmount) / 100 
      : dailyStopAmount;
  }, [dailyStopType, dailyStopAmount, capital]);

  // Check if daily limits are hit
  const isDailyTargetHit = useMemo(() => {
    return dailyPnL >= dailyTargetValue && dailyTargetValue > 0;
  }, [dailyPnL, dailyTargetValue]);

  const isDailyStopHit = useMemo(() => {
    return dailyPnL <= -dailyStopValue && dailyStopValue > 0;
  }, [dailyPnL, dailyStopValue]);

  const canTrade = useMemo(() => {
    return !isDailyTargetHit && !isDailyStopHit;
  }, [isDailyTargetHit, isDailyStopHit]);

  // Auto-stop bot when daily limits are hit
  useEffect(() => {
    if (botRunning && !canTrade) {
      setBotRunning(false);
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    }
  }, [botRunning, canTrade]);

  // Check if we need to reset daily P&L (new UTC day)
  useEffect(() => {
    const checkDailyReset = () => {
      const today = new Date().toISOString().split('T')[0];
      if (today !== dailyStartDate) {
        setDailyStartDate(today);
        setDailyPnL(0);
        setSessionPnL(0);
        setTrades([]);
      }
    };
    
    // Check immediately and then every minute
    checkDailyReset();
    const interval = setInterval(checkDailyReset, 60000);
    return () => clearInterval(interval);
  }, [dailyStartDate]);

  // Fetch klines
  const fetchKlines = async () => {
    try {
      // Use testnet by default
      const res = await fetch(`/api/klines?symbol=${symbol}&interval=${candleInterval}&limit=200&testnet=true`);
      
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

  // Fetch levels - volatility (kPct) is calculated internally from daily candles
  const fetchLevels = async () => {
    try {
      const res = await fetch('/api/levels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          symbol, 
          subdivisions: SUBDIVISIONS,
          testnet: true, // Default to testnet
        }),
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to fetch levels');
      }
      const data = await res.json();
      setLevels(data);
      setKPct(data.kPct); // Store kPct from levels
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

      // Get levels (includes kPct) - refresh to ensure we have latest VWAP
      const lv = await fetchLevels();
      const lastClose = candlesData.length > 0 ? candlesData[candlesData.length - 1].close : NaN;

      // Apply breakeven to open trades (if any)
      setTrades((prev) =>
        prev.map((t) => {
          if (t.status !== 'open') return t;
          const newSL = applyBreakeven(t.side, t.entry, t.sl, lastClose, lv.vwap);
          return newSL !== t.sl ? { ...t, sl: newSL } : t;
        })
      );

      // Calculate signal using THE SAME kPct from levels
      const signalData = await calculateSignal(candlesData, lv.kPct);

      // Check for new signal and add to trade log
      // Only enter trades if bot is running AND we have valid signal AND daily limits not hit
      if (botRunning && canTrade && signalData && signalData.signal && signalData.touchedLevel) {
        // Optional order-book confirmation
        let approved = true;
        if (useOrderBookConfirm) {
          try {
            approved = await confirmLevelTouch({
              symbol,
              level: signalData.touchedLevel,
              side: signalData.signal,
              windowMs: 8000,
              minNotional: 50_000, // tune
              proximityBps: 5, // 5 bps proximity to level
            });
          } catch (err) {
            console.error('Order-book confirmation error:', err);
            approved = false; // Fail-safe: reject if confirmation fails
          }
        }

        if (approved) {
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
            // Note: Position size is in base units, not leveraged
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
        } else {
          console.log(`Signal rejected by order-book confirmation: ${signalData.reason}`);
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

            // Update P&L (with position size)
            if (newStatus !== 'open' && exitPrice) {
              const positionSize = trade.positionSize || 0;
              const pnl =
                trade.side === 'LONG'
                  ? (exitPrice - trade.entry) * positionSize
                  : (trade.entry - exitPrice) * positionSize;
              setSessionPnL((prev) => prev + pnl);
              setDailyPnL((prev) => prev + pnl);
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

  // Start/stop order book on symbol change
  useEffect(() => {
    startOrderBook(symbol);
    return () => stopOrderBook(symbol);
  }, [symbol]);

  // Fetch levels when symbol changes (levels are based on daily candles, independent of interval)
  useEffect(() => {
    const loadLevels = async () => {
      try {
        const levelsRes = await fetch('/api/levels', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            symbol, 
            subdivisions: SUBDIVISIONS,
            testnet: true, // Default to testnet
          }),
        });
        const levelsData = await levelsRes.json();
        
        if (levelsData.symbol === symbol) {
          setLevels(levelsData);
          setKPct(levelsData.kPct); // Store kPct from levels
        }
      } catch (err) {
        console.error('Failed to load levels:', err);
      }
    };

    loadLevels();
  }, [symbol]); // Only refetch levels when symbol changes

  // Initial load and polling - handles candles, signals, and interval changes
  useEffect(() => {
    // Reset signal and candles when symbol or interval changes
    setSignal(null);
    setCandles([]);

    // Create a function that uses current symbol/interval values
    const loadData = async () => {
      try {
        setLoading(true);
        setError(null);

        // Fetch klines with current symbol and interval (for display only)
        const res = await fetch(`/api/klines?symbol=${symbol}&interval=${candleInterval}&limit=200&testnet=false`);
        const klinesData = await res.json();
        
        if (!res.ok || !klinesData || !Array.isArray(klinesData) || klinesData.length === 0) {
          setLoading(false);
          return;
        }

        setCandles(klinesData);

        // Get levels (includes kPct) - use the unified kPct from levels API
        const levelsRes = await fetch('/api/levels', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            symbol, 
            subdivisions: SUBDIVISIONS,
            testnet: true, // Default to testnet
          }),
        });
        const levelsData = await levelsRes.json();
        if (levelsData.symbol === symbol) {
          setLevels(levelsData);
          setKPct(levelsData.kPct);
        }

        // Calculate signal using kPct from levels
        const signalRes = await fetch('/api/signal', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            symbol,
            kPct: levelsData.kPct || kPct, // Use kPct from levels
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
  }, [symbol, candleInterval, botRunning]); // Candles and signals depend on interval, but levels don't

  // Prepare chart markers from signals - memoize to prevent unnecessary re-renders
  const chartMarkers = useMemo(() => {
    if (signal && signal.signal && signal.touchedLevel && candles.length > 0) {
      return [
        {
          time: candles[candles.length - 1]?.ts / 1000,
          position: signal.signal === 'LONG' ? ('belowBar' as const) : ('aboveBar' as const),
          color: signal.signal === 'LONG' ? '#10b981' : '#ef4444',
          shape: signal.signal === 'LONG' ? ('arrowUp' as const) : ('arrowDown' as const),
          text: `${signal.signal} @ ${signal.touchedLevel.toFixed(2)}`,
        },
      ];
    }
    return [];
  }, [signal, candles]);

  // Get open trades for chart visualization - memoize to prevent unnecessary re-renders
  const openTrades = useMemo(() => {
    return trades
      .filter((t) => t.status === 'open')
      .map((t) => ({
        entry: t.entry,
        tp: t.tp,
        sl: t.sl,
        side: t.side,
      }));
  }, [trades]);

  // Get current price
  const currentPrice = candles.length > 0 ? candles[candles.length - 1].close : null;

  const handleStartBot = () => {
    if (!canTrade) {
      setError(isDailyTargetHit 
        ? `Daily target reached (${dailyPnL >= 0 ? '+' : ''}${dailyPnL.toFixed(2)}). Reset to continue.`
        : `Daily stop loss hit (${dailyPnL.toFixed(2)}). Reset to continue.`
      );
      return;
    }
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
        <div className="mb-8 relative">
          <div className="absolute inset-0 bg-gradient-to-r from-cyan-500/20 via-purple-500/20 to-pink-500/20 blur-3xl rounded-full"></div>
          <div className="relative">
            <h1 className="text-5xl sm:text-6xl font-black mb-3 text-gradient-animated">
              GARCHY BOT
            </h1>
            <div className="flex items-center gap-3">
              <div className="h-1 w-16 bg-gradient-to-r from-cyan-500 to-purple-500 rounded-full"></div>
              <p className="text-gray-300 text-sm sm:text-base font-medium tracking-wide">Real-time trading signals powered by volatility analysis</p>
              <div className="h-1 w-16 bg-gradient-to-r from-purple-500 to-pink-500 rounded-full"></div>
            </div>
          </div>
        </div>

        {/* Symbol selector and Bot controls */}
        <div className="mb-6 space-y-4">
          <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
            <div className="flex-1 grid grid-cols-1 sm:grid-cols-4 gap-4">
              <div className="relative group">
                <label className="block text-xs font-bold mb-2 text-cyan-300 uppercase tracking-wider">Trading Pair</label>
                <select
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value)}
                  className="glass-effect rounded-xl px-4 py-3 text-white font-semibold cursor-pointer transition-all duration-300 hover:border-cyan-500/50 hover:shadow-lg hover:shadow-cyan-500/20 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 w-full bg-slate-900/70 backdrop-blur-xl border-2 border-slate-700/50"
                >
                  {SYMBOLS.map((s) => (
                    <option key={s} value={s} className="bg-slate-900">
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              
              <div className="relative group">
                <label className="block text-xs font-bold mb-2 text-purple-300 uppercase tracking-wider">Interval</label>
                <select
                  value={candleInterval}
                  onChange={(e) => setCandleInterval(e.target.value)}
                  className="glass-effect rounded-xl px-4 py-3 text-white font-semibold cursor-pointer transition-all duration-300 hover:border-purple-500/50 hover:shadow-lg hover:shadow-purple-500/20 focus:outline-none focus:ring-2 focus:ring-purple-500/50 w-full bg-slate-900/70 backdrop-blur-xl border-2 border-slate-700/50"
                >
                  {INTERVALS.map((int) => (
                    <option key={int.value} value={int.value} className="bg-slate-900">
                      {int.label}
                    </option>
                  ))}
                </select>
              </div>
              
              <div className="relative group">
                <label className="block text-xs font-bold mb-2 text-pink-300 uppercase tracking-wider">Max Trades</label>
                <input
                  type="number"
                  min="1"
                  max="10"
                  value={maxTrades}
                  onChange={(e) => setMaxTrades(Math.max(1, Math.min(10, parseInt(e.target.value) || 1)))}
                  className="glass-effect rounded-xl px-4 py-3 text-white font-semibold w-full transition-all duration-300 hover:border-pink-500/50 hover:shadow-lg hover:shadow-pink-500/20 focus:outline-none focus:ring-2 focus:ring-pink-500/50 bg-slate-900/70 backdrop-blur-xl border-2 border-slate-700/50"
                />
              </div>
              
              <div className="relative group">
                <label className="block text-xs font-bold mb-2 text-cyan-300 uppercase tracking-wider">Leverage</label>
                <input
                  type="number"
                  min="1"
                  max="100"
                  step="1"
                  value={leverage}
                  onChange={(e) => setLeverage(Math.max(1, Math.min(100, parseFloat(e.target.value) || 1)))}
                  className="glass-effect rounded-xl px-4 py-3 text-white font-semibold w-full transition-all duration-300 hover:border-cyan-500/50 hover:shadow-lg hover:shadow-cyan-500/20 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 bg-slate-900/70 backdrop-blur-xl border-2 border-slate-700/50"
                />
              </div>
            </div>
            
            <div className="flex gap-3 items-end">
              {!botRunning ? (
                <button
                  onClick={handleStartBot}
                  disabled={!canTrade}
                  className="glass-effect rounded-xl px-8 py-3 bg-gradient-to-r from-green-500/20 to-emerald-500/20 text-green-300 border-2 border-green-500/40 font-bold hover:from-green-500/30 hover:to-emerald-500/30 hover:border-green-500/60 hover:shadow-lg hover:shadow-green-500/30 transition-all duration-300 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed backdrop-blur-xl"
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
                  className="glass-effect rounded-xl px-8 py-3 bg-gradient-to-r from-red-500/20 to-rose-500/20 text-red-300 border-2 border-red-500/40 font-bold hover:from-red-500/30 hover:to-rose-500/30 hover:border-red-500/60 hover:shadow-lg hover:shadow-red-500/30 transition-all duration-300 flex items-center gap-2 backdrop-blur-xl"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 10h6v4H9z" />
                  </svg>
                  Stop Bot
                </button>
              )}
              {botRunning && (
                <div className="flex items-center gap-2 text-green-400 px-4 py-2 rounded-lg bg-green-500/10 border border-green-500/30">
                  <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse shadow-lg shadow-green-400/50"></div>
                  <span className="text-sm font-bold">Running</span>
                </div>
              )}
            </div>
          </div>
          
          {/* Risk Management Controls */}
          <div className="glass-effect rounded-xl p-5 border-2 border-blue-500/20 bg-gradient-to-br from-blue-500/5 to-indigo-500/5 backdrop-blur-xl shadow-2xl">
            <h3 className="text-sm font-bold text-blue-300 mb-4 flex items-center gap-2">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              Risk Management
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
              <div>
                <label className="block text-xs font-bold mb-2 text-blue-300 uppercase tracking-wider">Capital ($)</label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={capital}
                  onChange={(e) => setCapital(Math.max(1, parseFloat(e.target.value) || 1))}
                  className="glass-effect rounded-xl px-4 py-3 text-white font-semibold w-full transition-all duration-300 hover:border-blue-500/50 hover:shadow-lg hover:shadow-blue-500/20 focus:outline-none focus:ring-2 focus:ring-blue-500/50 bg-slate-900/70 backdrop-blur-xl border-2 border-slate-700/50"
                />
              </div>
              <div>
                <label className="block text-xs font-bold mb-2 text-blue-300 uppercase tracking-wider">Risk Type</label>
                <select
                  value={riskType}
                  onChange={(e) => setRiskType(e.target.value as 'fixed' | 'percent')}
                  className="glass-effect rounded-xl px-4 py-3 text-white font-semibold cursor-pointer transition-all duration-300 hover:border-blue-500/50 hover:shadow-lg hover:shadow-blue-500/20 focus:outline-none focus:ring-2 focus:ring-blue-500/50 w-full bg-slate-900/70 backdrop-blur-xl border-2 border-slate-700/50"
                >
                  <option value="fixed" className="bg-slate-900">Fixed $</option>
                  <option value="percent" className="bg-slate-900">% of Capital</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold mb-2 text-blue-300 uppercase tracking-wider">
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
                  className="glass-effect rounded-xl px-4 py-3 text-white font-semibold w-full transition-all duration-300 hover:border-blue-500/50 hover:shadow-lg hover:shadow-blue-500/20 focus:outline-none focus:ring-2 focus:ring-blue-500/50 bg-slate-900/70 backdrop-blur-xl border-2 border-slate-700/50"
                />
              </div>
              <div className="flex items-end">
                <div className="glass-effect rounded-xl px-5 py-3 w-full border-2 border-purple-500/40 bg-gradient-to-br from-purple-500/10 to-pink-500/10 backdrop-blur-xl">
                  <div className="text-xs text-purple-300 mb-1 font-bold uppercase tracking-wider">Risk Per Trade</div>
                  <div className="text-lg font-black text-purple-200 bg-gradient-to-r from-purple-300 to-pink-300 bg-clip-text text-transparent">
                    ${riskType === 'percent' 
                      ? ((capital * riskAmount) / 100).toFixed(2)
                      : riskAmount.toFixed(2)}
                  </div>
                </div>
              </div>
            </div>
          </div>
          
          {/* Daily Limits Section */}
          <div className="glass-effect rounded-xl p-5 border border-cyan-500/20 bg-gradient-to-br from-cyan-500/5 to-purple-500/5 backdrop-blur-xl shadow-2xl">
            <h3 className="text-sm font-bold text-cyan-300 mb-4 flex items-center gap-2">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
              Daily Limits
            </h3>
            
            {/* Daily P&L Display */}
            <div className="mb-4 p-3 rounded-lg bg-slate-900/50 border border-slate-700/50">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-gray-400">Today's P&L</span>
                <span className={`text-lg font-bold ${dailyPnL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {dailyPnL >= 0 ? '+' : ''}${dailyPnL.toFixed(2)}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-500">Target: ${dailyTargetValue.toFixed(2)}</span>
                <span className="text-gray-500">Stop: -${dailyStopValue.toFixed(2)}</span>
              </div>
            </div>

            {/* Daily Target */}
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="block text-xs font-medium mb-1.5 text-cyan-300">Target Type</label>
                <select
                  value={dailyTargetType}
                  onChange={(e) => setDailyTargetType(e.target.value as 'fixed' | 'percent')}
                  className="glass-effect rounded-lg px-3 py-2 text-white text-sm font-medium cursor-pointer transition-all duration-200 hover:border-cyan-500/50 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 w-full bg-slate-900/50"
                >
                  <option value="percent" className="bg-slate-900">%</option>
                  <option value="fixed" className="bg-slate-900">$</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1.5 text-cyan-300">Target Amount</label>
                <input
                  type="number"
                  min="0.01"
                  step={dailyTargetType === 'percent' ? "0.1" : "1"}
                  value={dailyTargetAmount}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value) || 0;
                    if (dailyTargetType === 'percent') {
                      setDailyTargetAmount(Math.max(0.01, Math.min(100, val)));
                    } else {
                      setDailyTargetAmount(Math.max(0.01, val));
                    }
                  }}
                  className="glass-effect rounded-lg px-3 py-2 text-white text-sm font-medium w-full transition-all duration-200 hover:border-cyan-500/50 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 bg-slate-900/50"
                />
              </div>
            </div>

            {/* Daily Stop Loss */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1.5 text-red-300">Stop Type</label>
                <select
                  value={dailyStopType}
                  onChange={(e) => setDailyStopType(e.target.value as 'fixed' | 'percent')}
                  className="glass-effect rounded-lg px-3 py-2 text-white text-sm font-medium cursor-pointer transition-all duration-200 hover:border-red-500/50 focus:outline-none focus:ring-2 focus:ring-red-500/50 w-full bg-slate-900/50"
                >
                  <option value="percent" className="bg-slate-900">%</option>
                  <option value="fixed" className="bg-slate-900">$</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1.5 text-red-300">Stop Amount</label>
                <input
                  type="number"
                  min="0.01"
                  step={dailyStopType === 'percent' ? "0.1" : "1"}
                  value={dailyStopAmount}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value) || 0;
                    if (dailyStopType === 'percent') {
                      setDailyStopAmount(Math.max(0.01, Math.min(100, val)));
                    } else {
                      setDailyStopAmount(Math.max(0.01, val));
                    }
                  }}
                  className="glass-effect rounded-lg px-3 py-2 text-white text-sm font-medium w-full transition-all duration-200 hover:border-red-500/50 focus:outline-none focus:ring-2 focus:ring-red-500/50 bg-slate-900/50"
                />
              </div>
            </div>

            {/* Status Indicators */}
            {(isDailyTargetHit || isDailyStopHit) && (
              <div className={`mt-4 p-3 rounded-lg border-2 ${
                isDailyTargetHit 
                  ? 'bg-green-500/10 border-green-500/50 text-green-400' 
                  : 'bg-red-500/10 border-red-500/50 text-red-400'
              }`}>
                <div className="flex items-center gap-2">
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                  </svg>
                  <span className="text-sm font-semibold">
                    {isDailyTargetHit ? 'Daily Target Reached!' : 'Daily Stop Loss Hit!'}
                  </span>
                </div>
                <p className="text-xs mt-1 opacity-80">
                  {isDailyTargetHit 
                    ? 'Trading paused. Reset daily P&L to continue.'
                    : 'Trading paused. Reset daily P&L to continue.'}
                </p>
              </div>
            )}
          </div>

          {/* Order Book Confirmation Toggle */}
          <div className="glass-effect rounded-xl p-5 border border-purple-500/20 bg-gradient-to-br from-purple-500/5 to-pink-500/5 backdrop-blur-xl shadow-2xl">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-purple-300 mb-1 flex items-center gap-2">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Order Book Confirmation
                </h3>
                <p className="text-xs text-gray-400">Require order-book imbalance/wall before entering trades</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={useOrderBookConfirm}
                  onChange={(e) => setUseOrderBookConfirm(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-12 h-6 bg-slate-700 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-purple-800/50 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-gradient-to-r peer-checked:from-purple-500 peer-checked:to-pink-500 shadow-lg"></div>
              </label>
            </div>
          </div>
          
          <div className="flex flex-wrap gap-3 text-xs">
            <div className="px-3 py-1.5 rounded-lg bg-slate-900/50 border border-slate-700/50 backdrop-blur-sm">
              <span className="text-gray-400 font-medium">Open:</span>
              <span className="text-cyan-300 font-bold ml-1">{trades.filter(t => t.status === 'open').length}/{maxTrades}</span>
            </div>
            <div className="px-3 py-1.5 rounded-lg bg-slate-900/50 border border-slate-700/50 backdrop-blur-sm">
              <span className="text-gray-400 font-medium">Leverage:</span>
              <span className="text-purple-300 font-bold ml-1">{leverage}x</span>
            </div>
            <div className="px-3 py-1.5 rounded-lg bg-slate-900/50 border border-slate-700/50 backdrop-blur-sm">
              <span className="text-gray-400 font-medium">Interval:</span>
              <span className="text-pink-300 font-bold ml-1">{INTERVALS.find(i => i.value === candleInterval)?.label || candleInterval}</span>
            </div>
            {levels && (
              <div className="px-3 py-1.5 rounded-lg bg-slate-900/50 border border-slate-700/50 backdrop-blur-sm">
                <span className="text-gray-400 font-medium">k%:</span>
                <span className="text-cyan-300 font-bold ml-1">{(levels.kPct * 100).toFixed(2)}%</span>
              </div>
            )}
          </div>
        </div>

        {error && (
          <div className="glass-effect border-2 border-red-500/50 rounded-xl p-4 mb-6 text-red-300 shadow-2xl shadow-red-500/20 backdrop-blur-xl bg-red-500/5 animate-pulse">
            <div className="flex items-center gap-3">
              <svg className="w-6 h-6 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
              </svg>
              <span className="font-bold">Error: {error}</span>
            </div>
          </div>
        )}

        {loading && (
          <div className="text-center py-12">
            <div className="inline-flex items-center gap-3 text-cyan-300">
              <svg className="animate-spin h-6 w-6" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              <span className="font-bold text-lg">Loading market data...</span>
            </div>
          </div>
        )}

        {/* Main layout */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Chart - takes 2 columns */}
          <div className="lg:col-span-2">
            <div className="glass-effect rounded-2xl p-5 sm:p-7 shadow-2xl card-hover border-2 border-slate-700/50 bg-gradient-to-br from-slate-900/80 to-slate-800/80 backdrop-blur-xl">
              <div className="mb-5">
                <h2 className="text-2xl font-black text-transparent bg-clip-text bg-gradient-to-r from-cyan-300 via-purple-300 to-pink-300 mb-2">Price Chart</h2>
                <p className="text-sm text-gray-300 font-medium">Real-time candlestick data with trading levels</p>
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
