'use client';

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import Link from 'next/link';
import Chart from '@/components/Chart';
import Cards from '@/components/Cards';
import TradeLog, { Trade } from '@/components/TradeLog';
import TradesTable from '@/components/TradesTable';
import Sidebar from '@/components/Sidebar';
import OrderBook from '@/components/OrderBook';
import ActivityLog, { LogEntry, LogLevel } from '@/components/ActivityLog';
import type { Candle, LevelsResponse, SignalResponse } from '@/lib/types';
import { computeTrailingBreakeven } from '@/lib/strategy';
import { startOrderBook, stopOrderBook, confirmLevelTouch } from '@/lib/orderbook';
import { io, Socket } from 'socket.io-client';

const DEFAULT_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
const DEFAULT_SYMBOL = DEFAULT_SYMBOLS[0];
const POLL_INTERVAL = 12000; // 12 seconds
const PENDING_FILL_DELAY_MS = 5000; // wait 5s before considering pending orders fillable
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
  const [symbols, setSymbols] = useState<string[]>(DEFAULT_SYMBOLS);
  const [symbolsLoading, setSymbolsLoading] = useState<boolean>(true);
  const [symbol, setSymbol] = useState<string>(DEFAULT_SYMBOL);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [levels, setLevels] = useState<LevelsResponse | null>(null);
  const [signal, setSignal] = useState<SignalResponse | null>(null);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [sessionPnL, setSessionPnL] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [botRunning, setBotRunning] = useState<boolean>(false);
  const [loadingBotStatus, setLoadingBotStatus] = useState<boolean>(true);
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
  const [activityLogs, setActivityLogs] = useState<LogEntry[]>([]);
  const [garchMode, setGarchMode] = useState<'auto' | 'custom'>('auto');
  const [customKPct, setCustomKPct] = useState<number>(0.03); // Default 3% (0.03 as decimal)
  const [apiMode, setApiMode] = useState<'demo' | 'live'>('demo');
  const [apiKey, setApiKey] = useState<string>('');
  const [apiSecret, setApiSecret] = useState<string>('');
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [connectionMessage, setConnectionMessage] = useState<string | null>(null);
  const [walletInfo, setWalletInfo] = useState<Array<{ coin: string; equity: number; availableToWithdraw: number }> | null>(null);
  const [overrideDailyLimits, setOverrideDailyLimits] = useState<boolean>(false);
  const [currentPrice, setCurrentPrice] = useState<number | null>(null);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const tradesRef = useRef<Trade[]>([]);
  
  // Helper function to add log entries (memoized to avoid dependency warnings)
  const addLog = useCallback((level: LogLevel, message: string) => {
    const logEntry: LogEntry = {
      id: `${Date.now()}-${Math.random()}`,
      timestamp: new Date(),
      level,
      message,
    };
    setActivityLogs((prev) => [...prev, logEntry].slice(-100)); // Keep last 100 logs
  }, []);

  useEffect(() => {
    tradesRef.current = trades;
  }, [trades]);

  useEffect(() => {
    const loadSymbols = async () => {
      try {
        setSymbolsLoading(true);
        const res = await fetch('/api/symbols');
        const data = await res.json();

        if (res.ok && data.success && Array.isArray(data.symbols) && data.symbols.length > 0) {
          setSymbols(data.symbols);
          setSymbol((prev) => (data.symbols.includes(prev) ? prev : data.symbols[0]));
          addLog('info', `Loaded ${data.symbols.length} Bybit symbols`);
        } else {
          const errorMsg = data.error || 'Unknown error';
          addLog('warning', `Failed to load Bybit symbols: ${errorMsg}. Using defaults.`);
          setSymbols(DEFAULT_SYMBOLS);
          setSymbol((prev) => (DEFAULT_SYMBOLS.includes(prev) ? prev : DEFAULT_SYMBOL));
        }
      } catch (error) {
        console.error('Failed to load symbols:', error);
        addLog('warning', 'Failed to load Bybit symbols, using defaults.');
        setSymbols(DEFAULT_SYMBOLS);
        setSymbol((prev) => (DEFAULT_SYMBOLS.includes(prev) ? prev : DEFAULT_SYMBOL));
      } finally {
        setSymbolsLoading(false);
      }
    };

    loadSymbols();
  }, [addLog, setSymbol]);

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
  // Rules: Daily limits should auto-stop the bot when reached
  const isDailyTargetHit = useMemo(() => {
    return dailyPnL >= dailyTargetValue && dailyTargetValue > 0;
  }, [dailyPnL, dailyTargetValue]);

  const isDailyStopHit = useMemo(() => {
    return dailyPnL <= -dailyStopValue && dailyStopValue > 0;
  }, [dailyPnL, dailyStopValue]);

  const canTrade = useMemo(() => {
    return !isDailyTargetHit && !isDailyStopHit;
  }, [isDailyTargetHit, isDailyStopHit]);

  // Auto-stop bot when daily limits are hit (as per rules)
  useEffect(() => {
    if (botRunning && !canTrade && !overrideDailyLimits) {
      setBotRunning(false);
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
      const reason = isDailyTargetHit ? 'Daily target reached' : 'Daily stop loss hit';
      addLog('warning', `Bot auto-stopped: ${reason}`);
    }
  }, [botRunning, canTrade, isDailyTargetHit, addLog, overrideDailyLimits]);

  useEffect(() => {
    if (canTrade && overrideDailyLimits) {
      setOverrideDailyLimits(false);
    }
  }, [canTrade, overrideDailyLimits]);

  // Check if we need to reset daily P&L (new UTC day)
  useEffect(() => {
    const checkDailyReset = () => {
      const today = new Date().toISOString().split('T')[0];
      if (today !== dailyStartDate) {
        setDailyStartDate(today);
        setDailyPnL(0);
        setSessionPnL(0);
        setTrades([]);
        tradesRef.current = [];
        setOverrideDailyLimits(false);
      }
    };
    
    // Check immediately and then every minute
    checkDailyReset();
    const interval = setInterval(checkDailyReset, 60000);
    return () => clearInterval(interval);
  }, [dailyStartDate]);

  // Fetch klines - prefer mainnet for accurate prices
  const fetchKlines = async () => {
    try {
      // Try mainnet first for accurate prices
      let res = await fetch(`/api/klines?symbol=${symbol}&interval=${candleInterval}&limit=200&testnet=false`);
      
      // If mainnet fails, fallback to testnet
      if (!res.ok) {
        res = await fetch(`/api/klines?symbol=${symbol}&interval=${candleInterval}&limit=200&testnet=true`);
      }
      
      let data;
      try {
        data = await res.json();
      } catch (parseError) {
        throw new Error(`Failed to parse response: HTTP ${res.status} ${res.statusText}`);
      }
      
      if (!res.ok) {
        throw new Error(data.error || `Failed to fetch klines: HTTP ${res.status}`);
      }
      
      if (!data || !Array.isArray(data) || data.length === 0) {
        throw new Error('No kline data received from API');
      }
      
      setCandles(data);
      const latest = data[data.length - 1];
      setCurrentPrice(latest && Number.isFinite(latest.close) ? latest.close : null);
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
          ...(garchMode === 'custom' && { customKPct }),
        }),
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to fetch levels');
      }
      const data = await res.json();
      setLevels(data);
      setKPct(data.kPct); // Store kPct from levels
      addLog('info', `Levels updated: k% = ${(data.kPct * 100).toFixed(2)}%`);
      return data;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to fetch levels';
      setError(errorMsg);
      addLog('error', `Failed to fetch levels: ${errorMsg}`);
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

  const addTradeToState = useCallback((trade: Trade) => {
    setTrades((prev) => {
      const next = [...prev, trade];
      tradesRef.current = next;
      return next;
    });
  }, []);

  const replaceTradeInState = useCallback((updatedTrade: Trade) => {
    setTrades((prev) => {
      const next = prev.map((t) => (t.id === updatedTrade.id ? updatedTrade : t));
      tradesRef.current = next;
      return next;
    });
  }, []);

  const updateTradeStopOnServer = useCallback(async (trade: Trade, newSl: number) => {
    try {
      const res = await fetch(`/api/trades/${trade.id}/sl`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentSl: newSl }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to update stop loss');
      }

      const updatedTrade = data.trade as Trade;
      replaceTradeInState(updatedTrade);
      const tradeSymbol = trade.symbol ?? symbol;
      addLog('info', `Stop moved to $${newSl.toFixed(2)} for ${trade.side} ${tradeSymbol}`);
      return updatedTrade;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update stop loss';
      addLog('error', message);
      setError(message);
      return null;
    }
  }, [replaceTradeInState, addLog, symbol]);

  const fillTradeOnServer = useCallback(async (trade: Trade, fillPrice: number) => {
    try {
      const res = await fetch(`/api/trades/${trade.id}/fill`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fillPrice }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to mark trade as filled');
      }

      const updatedTrade = data.trade as Trade;
      replaceTradeInState(updatedTrade);
      addLog('success', `Limit order filled: ${updatedTrade.side} @ $${updatedTrade.entry.toFixed(2)}`);
      return updatedTrade;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to mark trade as filled';
      addLog('error', message);
      setError(message);
      return null;
    }
  }, [replaceTradeInState, addLog]);

  const openTradeOnServer = useCallback(async (params: {
    entry: number;
    tp: number;
    sl: number;
    side: 'LONG' | 'SHORT';
    positionSize: number;
    leverage: number;
    reason: string;
  }) => {
    try {
      const res = await fetch('/api/trades', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol,
          side: params.side,
          entry: params.entry,
          tp: params.tp,
          sl: params.sl,
          positionSize: params.positionSize,
          leverage: params.leverage,
          reason: params.reason,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to persist trade');
      }

      addTradeToState(data.trade);
      addLog('success', `Limit order placed: ${params.side} @ $${params.entry.toFixed(2)}, TP $${params.tp.toFixed(2)}, SL $${params.sl.toFixed(2)}`);
      return data.trade as Trade;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to persist trade';
      addLog('error', message);
      setError(message);
      return null;
    }
  }, [symbol, addTradeToState, addLog]);

  const closeTradeOnServer = useCallback(async (
    trade: Trade,
    status: 'tp' | 'sl' | 'breakeven' | 'cancelled',
    exitPrice: number,
    logLevel: LogLevel,
    logMessage: string
  ) => {
    try {
      const res = await fetch(`/api/trades/${trade.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status,
          exitPrice,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to update trade');
      }

      const updatedTrade = data.trade as Trade;
      const pnlChange = Number(data.pnlChange || 0);

      replaceTradeInState(updatedTrade);
      if (!Number.isNaN(pnlChange) && Number.isFinite(pnlChange)) {
        setSessionPnL((prev) => prev + pnlChange);
        setDailyPnL((prev) => prev + pnlChange);
      }

      const pnlFormatted = pnlChange >= 0 ? `+$${pnlChange.toFixed(2)}` : `-$${Math.abs(pnlChange).toFixed(2)}`;
      addLog(logLevel, `${logMessage} (P&L: ${pnlFormatted})`);
      return { updatedTrade, pnlChange };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update trade';
      addLog('error', message);
      setError(message);
      return null;
    }
  }, [replaceTradeInState, addLog]);

  // Main polling function - uses current symbol/interval from closure
  const pollData = async () => {
    // Capture current values to ensure we use latest
    const currentSymbol = symbol;
    
    try {
      setLoading(true);
      setError(null);

      // Fetch klines
      // Use mainnet for accurate prices, fallback to testnet
      let candlesData;
      try {
        const res = await fetch(`/api/klines?symbol=${symbol}&interval=${candleInterval}&limit=200&testnet=false`);
        if (res.ok) {
          candlesData = await res.json();
        } else {
          // Fallback to testnet
          const testnetRes = await fetch(`/api/klines?symbol=${symbol}&interval=${candleInterval}&limit=200&testnet=true`);
          candlesData = await testnetRes.json();
        }
      } catch (err) {
        // Final fallback to testnet
        const testnetRes = await fetch(`/api/klines?symbol=${symbol}&interval=${candleInterval}&limit=200&testnet=true`);
        candlesData = await testnetRes.json();
      }
      
      if (!candlesData || !Array.isArray(candlesData) || candlesData.length === 0) {
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
      addLog('info', `Monitoring levels for ${symbol}...`);
      const lv = await fetchLevels();
      const lastCandle = candlesData[candlesData.length - 1];
      const lastClose = lastCandle?.close ?? NaN;
      if (Number.isFinite(lastClose)) {
        setCurrentPrice(lastClose);
      }
      addLog('info', `VWAP: $${lv.vwap.toFixed(2)}, Price: $${lastClose.toFixed(2)}`);

      // Calculate signal using THE SAME kPct from levels
      const signalData = await calculateSignal(candlesData, lv.kPct);

      // Check for new signal and add to trade log
      // Only enter trades if bot is running AND we have valid signal AND daily limits not hit
      if (botRunning && canTrade && signalData && signalData.signal && signalData.touchedLevel) {
        addLog('info', `Signal detected: ${signalData.signal} @ $${signalData.touchedLevel.toFixed(2)} (${signalData.reason})`);
        
        // Optional order-book confirmation
        let approved = true;
        if (useOrderBookConfirm) {
          addLog('info', 'Checking order book confirmation...');
          try {
            approved = await confirmLevelTouch({
              symbol,
              level: signalData.touchedLevel,
              side: signalData.signal,
              windowMs: 8000,
              minNotional: 50_000, // tune
              proximityBps: 5, // 5 bps proximity to level
            });
            if (approved) {
              addLog('success', 'Order book confirmation: Liquidity wall detected');
            } else {
              addLog('warning', 'Order book confirmation: No significant liquidity wall');
            }
          } catch (err) {
            console.error('Order-book confirmation error:', err);
            addLog('error', 'Order book confirmation failed');
            approved = false; // Fail-safe: reject if confirmation fails
          }
        }

        if (approved) {
          const activeTradesForSymbol = tradesRef.current.filter(
            (t) => (t.status === 'open' || t.status === 'pending') && t.symbol === symbol
          );

          if (activeTradesForSymbol.length >= maxTrades) {
            addLog('warning', `Max trades limit reached (${maxTrades}). Skipping signal.`);
          } else {
            const duplicateTrade = activeTradesForSymbol.find(
              (t) =>
                t.side === signalData.signal &&
                Math.abs(t.entry - signalData.touchedLevel!) < 0.01
            );

            if (duplicateTrade) {
              addLog('warning', `Duplicate trade detected at $${signalData.touchedLevel!.toFixed(2)}. Skipping.`);
            } else {
              const riskPerTrade = riskType === 'percent'
                ? (capital * riskAmount) / 100
                : riskAmount;

              const stopLossDistance = Math.abs(signalData.touchedLevel! - signalData.sl!);
              const rawPositionSize = stopLossDistance > 0 ? riskPerTrade / stopLossDistance : 0;
              const positionSize = Number.isFinite(rawPositionSize) ? rawPositionSize : 0;

              if (positionSize <= 0) {
                addLog('warning', 'Calculated position size is zero. Skipping trade.');
              } else {
                await openTradeOnServer({
                  entry: signalData.touchedLevel!,
                  tp: signalData.tp!,
                  sl: signalData.sl!,
                  side: signalData.signal,
                  positionSize,
                  leverage,
                  reason: signalData.reason,
                });
              }
            }
          }
        } else {
          addLog('warning', `Signal rejected: ${signalData.reason}`);
        }
      } else if (botRunning && !canTrade) {
        addLog('warning', 'Trading paused: Daily limit reached');
      } else if (!botRunning && signalData && signalData.signal) {
        addLog('info', `Signal detected but bot is stopped: ${signalData.signal} @ $${signalData.touchedLevel!.toFixed(2)}`);
      }

      // Fill pending limit orders when price retests the entry
      if (candlesData.length > 0) {
        const pendingTradesSnapshot = tradesRef.current.filter(
          (trade) => trade.status === 'pending' && trade.symbol === symbol
        );

        for (const trade of pendingTradesSnapshot) {
          const placedAt = new Date(trade.time).getTime();
          if (Date.now() - placedAt < PENDING_FILL_DELAY_MS) {
            continue;
          }

          const biasBuffer = Math.abs(lv.vwap) * NO_TRADE_BAND_PCT;
          const biasValid = trade.side === 'LONG'
            ? lastClose > lv.vwap + biasBuffer
            : lastClose < lv.vwap - biasBuffer;

          if (!biasValid) {
            continue;
          }

          const retest = trade.side === 'LONG'
            ? lastCandle.low <= trade.entry
            : lastCandle.high >= trade.entry;

          if (retest) {
            const filled = await fillTradeOnServer(trade, trade.entry);
            if (filled) {
              trade.status = 'open';
            }
          }
        }
      }

      // Simulate TP/SL checks for open trades
      if (candlesData.length > 0) {
        const openTradesSnapshot = tradesRef.current.filter(
          (trade) => trade.status === 'open' && trade.symbol === symbol
        );

        for (const trade of openTradesSnapshot) {
          if (!Number.isFinite(lastClose)) {
            continue;
          }

          const initialSl = trade.initialSl ?? trade.sl;
          const trailingSl = computeTrailingBreakeven(
            trade.side,
            trade.entry,
            initialSl,
            trade.sl,
            lastClose
          );

          if (trailingSl !== null) {
            await updateTradeStopOnServer(trade, trailingSl);
            continue;
          }

          if (trade.side === 'LONG') {
            if (lastCandle.high >= trade.tp) {
              await closeTradeOnServer(
                trade,
                'tp',
                trade.tp,
                'success',
                `Take profit hit: ${trade.side} @ $${trade.entry.toFixed(2)} → $${trade.tp.toFixed(2)}`
              );
              continue;
            }
            if (lastCandle.low <= trade.sl) {
              await closeTradeOnServer(
                trade,
                'sl',
                trade.sl,
                'error',
                `Stop loss hit: ${trade.side} @ $${trade.entry.toFixed(2)} → $${trade.sl.toFixed(2)}`
              );
            }
          } else {
            if (lastCandle.low <= trade.tp) {
              await closeTradeOnServer(
                trade,
                'tp',
                trade.tp,
                'success',
                `Take profit hit: ${trade.side} @ $${trade.entry.toFixed(2)} → $${trade.tp.toFixed(2)}`
              );
              continue;
            }
            if (lastCandle.high >= trade.sl) {
              await closeTradeOnServer(
                trade,
                'sl',
                trade.sl,
                'error',
                `Stop loss hit: ${trade.side} @ $${trade.entry.toFixed(2)} → $${trade.sl.toFixed(2)}`
              );
            }
          }
        }
      }

      setLoading(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to poll data');
      setLoading(false);
    }
  };

  // Check auth status and load bot status on mount
  useEffect(() => {
    const checkAuthAndLoadStatus = async () => {
      // First check if user is authenticated
      try {
        const authRes = await fetch('/api/auth/me');
        if (!authRes.ok) {
          // Not authenticated, redirect to login
          window.location.href = '/login';
          return;
        }
      } catch (err) {
        console.error('Auth check failed:', err);
        window.location.href = '/login';
        return;
      }

      // User is authenticated, load bot status
      try {
        setLoadingBotStatus(true);
        
        // Calculate GARCH volatility to see debug logs in console
        try {
          console.log('🚀 [INIT] Calculating GARCH volatility...');
          const garchRes = await fetch('/api/garch/calculate?symbol=BTCUSDT');
          if (garchRes.ok) {
            const garchData = await garchRes.json();
            if (garchData.success && garchData.debugInfo) {
              console.log('\n' + '='.repeat(80));
              console.log('✅ [INIT] GARCH Calculation Complete');
              console.log('='.repeat(80));
              console.log(`📊 Symbol: ${garchData.symbol}`);
              console.log(`📅 Data Points: ${garchData.dataPoints} days`);
              console.log(`\n📈 Results:`);
              console.log(`  Historical Std Dev: ${garchData.debugInfo.historicalStdDev?.toFixed(4)}%`);
              if (garchData.debugInfo.garchForecasts) {
                console.log(`  GARCH Forecasts: ${garchData.debugInfo.garchForecasts.map((f: number) => f.toFixed(4)).join(', ')}%`);
              }
              if (garchData.debugInfo.gjrForecasts) {
                console.log(`  GJR Forecasts: ${garchData.debugInfo.gjrForecasts.map((f: number) => f.toFixed(4)).join(', ')}%`);
              }
              if (garchData.debugInfo.egarchForecasts) {
                console.log(`  EGARCH Forecasts: ${garchData.debugInfo.egarchForecasts.map((f: number) => f.toFixed(4)).join(', ')}%`);
              }
              console.log(`\n📊 Model Averages:`);
              console.log(`  Prom GARCH: ${garchData.debugInfo.promGarch?.toFixed(4)}%`);
              console.log(`  Prom GJR: ${garchData.debugInfo.promGjr?.toFixed(4)}%`);
              console.log(`  Prom EGARCH: ${garchData.debugInfo.promEgarch?.toFixed(4)}%`);
              console.log(`  ⭐ Prom Global (avg of three): ${garchData.debugInfo.promGlobal?.toFixed(4)}%`);
              console.log(`\n🎯 Final Results:`);
              console.log(`  GARCH(1,1) kPct: ${(garchData.models.garch11.kPct * 100).toFixed(4)}%`);
              console.log(`  GJR-GARCH(1,1) kPct: ${(garchData.models.gjrgarch11.kPct * 100).toFixed(4)}%`);
              console.log(`  EGARCH(1,1) kPct: ${(garchData.models.egarch11.kPct * 100).toFixed(4)}%`);
              console.log(`  🎯 Averaged kPct: ${(garchData.models.averaged.kPct * 100).toFixed(4)}%`);
              console.log('='.repeat(80) + '\n');
              console.log('💡 Check the server terminal (where npm run dev runs) for detailed GARCH debug logs');
            }
          } else {
            const errorData = await garchRes.json().catch(() => ({}));
            console.warn('⚠️  [INIT] GARCH calculation failed:', errorData.error || 'Unknown error');
          }
        } catch (err) {
          console.warn('⚠️  [INIT] GARCH calculation error:', err instanceof Error ? err.message : err);
        }
        
        const res = await fetch('/api/bot/status');
        
        if (res.ok) {
          const data = await res.json();
          
          // Load ALL bot configuration settings from database
          if (data.botConfig) {
            const config = data.botConfig;
            
            // Set bot running state
            setBotRunning(config.is_running || false);
            
            // Load trading settings
            setSymbol(config.symbol || DEFAULT_SYMBOL);
            setCandleInterval(config.candle_interval || DEFAULT_INTERVAL);
            setMaxTrades(config.max_trades || DEFAULT_MAX_TRADES);
            setLeverage(config.leverage || DEFAULT_LEVERAGE);
            setCapital(Number(config.capital) || DEFAULT_CAPITAL);
            setRiskAmount(Number(config.risk_amount) || DEFAULT_RISK_AMOUNT);
            setRiskType(config.risk_type || DEFAULT_RISK_TYPE);
            
            // Load daily limits
            setDailyTargetType(config.daily_target_type || DEFAULT_DAILY_TARGET_TYPE);
            setDailyTargetAmount(Number(config.daily_target_amount) || DEFAULT_DAILY_TARGET_AMOUNT);
            setDailyStopType(config.daily_stop_type || DEFAULT_DAILY_STOP_TYPE);
            setDailyStopAmount(Number(config.daily_stop_amount) || DEFAULT_DAILY_STOP_AMOUNT);
            setDailyPnL(Number(config.daily_pnl || 0));
            
            // Load GARCH settings
            setGarchMode(config.garch_mode || 'auto');
            if (config.custom_k_pct !== null) {
              setCustomKPct(Number(config.custom_k_pct));
            }
            
            // Load other settings
            setUseOrderBookConfirm(config.use_orderbook_confirm !== false);
            setApiMode((config.api_mode as 'demo' | 'live') || 'demo');
            setApiKey(config.api_key || '');
            setApiSecret(config.api_secret || '');
            setConnectionStatus('idle');
            setConnectionMessage(null);
            setWalletInfo(null);
            
            addLog('success', `Bot config loaded: ${config.symbol}, ${config.garch_mode} mode, k%: ${config.custom_k_pct ? (Number(config.custom_k_pct) * 100).toFixed(2) + '%' : 'auto'}`);
          }
          
          // Load trades from database if any
          if (data.allTrades && data.allTrades.length > 0) {
            const dbTrades = data.allTrades.map((t: any) => ({
              id: t.id,
              time: t.entry_time,
              side: t.side,
              entry: Number(t.entry_price),
              tp: Number(t.tp_price),
              sl: Number(t.current_sl ?? t.sl_price),
              initialSl: Number(t.sl_price),
              reason: t.reason || '',
              status: t.status,
              symbol: t.symbol,
              leverage: Number(t.leverage || leverage),
              positionSize: Number(t.position_size),
              exitPrice: t.exit_price ? Number(t.exit_price) : undefined,
            }));
            // Only set trades if we don't already have them (avoid overwriting active trades)
            if (trades.length === 0) {
              setTrades(dbTrades);
            }
          }
          
          // Load session P&L
          if (data.sessionPnL !== undefined) {
            setSessionPnL(Number(data.sessionPnL));
          }
          
          // Load activity logs
          if (data.activityLogs && data.activityLogs.length > 0) {
            const dbLogs = data.activityLogs.map((log: any) => ({
              id: log.id,
              timestamp: new Date(log.created_at),
              level: log.level,
              message: log.message,
            }));
            setActivityLogs(dbLogs);
          }
          
          addLog('success', 'Bot status and settings loaded from database');
        }
      } catch (err) {
        console.error('Failed to load bot status:', err);
        addLog('warning', 'Could not load previous bot status');
      } finally {
        setLoadingBotStatus(false);
      }
    };
    
    checkAuthAndLoadStatus();
  }, [addLog]);

  // Start/stop order book on symbol change
  useEffect(() => {
    addLog('info', `Connecting to order book for ${symbol}...`);
    startOrderBook(symbol);
    return () => {
      stopOrderBook(symbol);
      addLog('info', `Disconnected order book for ${symbol}`);
    };
  }, [symbol, addLog]);

  // Fetch levels when symbol changes (levels are based on daily candles, independent of interval)
  useEffect(() => {
    const loadLevels = async () => {
      try {
        // Reset levels first to ensure UI updates
        setLevels(null);
        addLog('info', `Loading levels for ${symbol}...`);
        
        const levelsRes = await fetch('/api/levels', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            symbol, 
            subdivisions: SUBDIVISIONS,
            testnet: true, // Default to testnet
            ...(garchMode === 'custom' && { customKPct }),
          }),
        });
        
        if (!levelsRes.ok) {
          throw new Error('Failed to fetch levels');
        }
        
        const levelsData = await levelsRes.json();
        
        // Only update if symbol hasn't changed during fetch
        if (levelsData.symbol === symbol) {
          setLevels(levelsData);
          setKPct(levelsData.kPct); // Store kPct from levels
          addLog('success', `Levels loaded for ${symbol}: k% = ${(levelsData.kPct * 100).toFixed(2)}%`);
        }
      } catch (err) {
        console.error('Failed to load levels:', err);
        const errorMsg = err instanceof Error ? err.message : 'Failed to load levels';
        setError(errorMsg);
        addLog('error', `Failed to load levels for ${symbol}: ${errorMsg}`);
      }
    };

    loadLevels();
  }, [symbol, garchMode, customKPct, addLog]); // Refetch levels when symbol or GARCH settings change

  // Initial load and polling - handles candles, signals, and interval changes
  useEffect(() => {
    // Reset signal and candles when symbol or interval changes
    setSignal(null);
    setCandles([]);
    setCurrentPrice(null);

    // Create a function that uses current symbol/interval values
    const loadData = async () => {
      try {
        setLoading(true);
        setError(null);

        // Fetch klines with current symbol and interval (for display only)
        // Use mainnet for accurate prices, fallback to testnet
        let klinesData;
        try {
          const res = await fetch(`/api/klines?symbol=${symbol}&interval=${candleInterval}&limit=200&testnet=false`);
          if (res.ok) {
            klinesData = await res.json();
          } else {
            // Fallback to testnet
            const testnetRes = await fetch(`/api/klines?symbol=${symbol}&interval=${candleInterval}&limit=200&testnet=true`);
            klinesData = await testnetRes.json();
          }
        } catch (err) {
          // Final fallback to testnet
          const testnetRes = await fetch(`/api/klines?symbol=${symbol}&interval=${candleInterval}&limit=200&testnet=true`);
          klinesData = await testnetRes.json();
        }
        
        if (!klinesData || !Array.isArray(klinesData) || klinesData.length === 0) {
          setLoading(false);
          return;
        }

        setCandles(klinesData);
        const latest = klinesData[klinesData.length - 1];
        setCurrentPrice(latest && Number.isFinite(latest.close) ? latest.close : null);

        // Fetch levels for this symbol (may already be loading from symbol change useEffect)
        // This ensures we have levels even if symbol change useEffect hasn't completed
        const levelsRes = await fetch('/api/levels', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            symbol, 
            subdivisions: SUBDIVISIONS,
            testnet: true, // Default to testnet
            ...(garchMode === 'custom' && { customKPct }),
          }),
        });
        
        if (levelsRes.ok) {
          const levelsData = await levelsRes.json();
          if (levelsData.symbol === symbol) {
            setLevels(levelsData);
            setKPct(levelsData.kPct);
            addLog('success', `Levels loaded: k% = ${(levelsData.kPct * 100).toFixed(2)}%`);
            
            // Calculate signal using kPct from levels
            const signalRes = await fetch('/api/signal', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                symbol,
                kPct: levelsData.kPct,
                subdivisions: SUBDIVISIONS,
                noTradeBandPct: NO_TRADE_BAND_PCT,
                candles: klinesData,
              }),
            });
            if (signalRes.ok) {
              const signalData = await signalRes.json();
              if (signalData.symbol === symbol) {
                setSignal(signalData);
                if (signalData.signal) {
                  addLog('info', `Initial signal: ${signalData.signal} @ $${signalData.touchedLevel?.toFixed(2) || 'N/A'}`);
                }
              }
            }
          }
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
  const handleStartBot = async () => {
    const overrideLimits = !canTrade;
    setOverrideDailyLimits(overrideLimits);
    setTrades([]);
    tradesRef.current = [];
    setSessionPnL(0);
    setError(null);

    // Check if phases are completed before starting (Phase 1 and Phase 2 must be completed)
    try {
      if (apiMode === 'live' && (!apiKey.trim() || !apiSecret.trim())) {
        const errorMsg = 'Live mode requires Bybit API key and secret.';
        setError(errorMsg);
        addLog('error', errorMsg);
        setOverrideDailyLimits(false);
        return;
      }

      const levelsRes = await fetch('/api/levels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol,
          subdivisions: SUBDIVISIONS,
          testnet: true,
        }),
      });

      if (!levelsRes.ok) {
        const errorMsg = 'Cannot start bot: Daily setup not completed. Please wait for Phase 1 & 2 to finish.';
        setError(errorMsg);
        addLog('error', errorMsg);
        setOverrideDailyLimits(false);
        return;
      }
    } catch (err) {
      const errorMsg = 'Cannot start bot: Unable to verify daily setup completion.';
      setError(errorMsg);
      addLog('error', errorMsg);
      setOverrideDailyLimits(false);
      return;
    }
    
    try {
      const res = await fetch('/api/bot/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ overrideDailyLimits: overrideLimits }),
      });
      const data = await res.json();
      
      if (!res.ok) {
        throw new Error(data.error || 'Failed to start bot');
      }
      
      setBotRunning(true);
      setError(null);
      if (overrideLimits) {
        setDailyPnL(0);
        setDailyStartDate(new Date().toISOString().split('T')[0]);
      }
      setOverrideDailyLimits(false);
      addLog('success', `Bot started for ${symbol} - running in background`);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to start bot';
      setError(errorMsg);
      addLog('error', errorMsg);
      setOverrideDailyLimits(false);
    }
  };

  const handleStopBot = async () => {
    try {
      const res = await fetch('/api/bot/stop', { method: 'POST' });
      const data = await res.json();
      
      if (!res.ok) {
        throw new Error(data.error || 'Failed to stop bot');
      }
      
      setBotRunning(false);
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
      setOverrideDailyLimits(false);
      addLog('warning', 'Bot stopped');
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to stop bot';
      setError(errorMsg);
      addLog('error', errorMsg);
    }
  };

  const handleSaveSettings = async () => {
    try {
      const sanitizedKey = apiKey.trim();
      const sanitizedSecret = apiSecret.trim();
      const settingsToSave = {
        symbol,
        candle_interval: candleInterval,
        max_trades: maxTrades,
        leverage,
        capital,
        risk_amount: riskAmount,
        risk_type: riskType,
        daily_target_type: dailyTargetType,
        daily_target_amount: dailyTargetAmount,
        daily_stop_type: dailyStopType,
        daily_stop_amount: dailyStopAmount,
        garch_mode: garchMode,
        custom_k_pct: customKPct,
        use_orderbook_confirm: useOrderBookConfirm,
        api_mode: apiMode,
        api_key: sanitizedKey.length > 0 ? sanitizedKey : null,
        api_secret: sanitizedSecret.length > 0 ? sanitizedSecret : null,
      };

      const res = await fetch('/api/bot/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settingsToSave),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to save settings');
      }

      addLog('success', 'Settings saved successfully!');
      setError(null);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to save settings';
      setError(errorMsg);
      addLog('error', errorMsg);
    }
  };

  const handleTestConnection = async () => {
    const key = apiKey.trim();
    const secret = apiSecret.trim();

    if (!key || !secret) {
      const message = 'Please provide both API key and secret before testing.';
      setConnectionStatus('error');
      setConnectionMessage(message);
      setWalletInfo(null);
      addLog('error', message);
      return;
    }

    try {
      setConnectionStatus('loading');
      setConnectionMessage(null);
      setWalletInfo(null);

      const res = await fetch('/api/bybit/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: key,
          apiSecret: secret,
          mode: apiMode,
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Connection failed');
      }

      const balances = Array.isArray(data.wallet?.list)
        ? data.wallet.list.flatMap((wallet: any) =>
            (wallet.coin || []).map((coin: any) => ({
              coin: coin.coin,
              equity: Number(coin.equity || 0),
              availableToWithdraw: Number(coin.availableToWithdraw || 0),
            }))
          )
          .filter((wallet: { equity: number; availableToWithdraw: number }) => wallet.equity > 0 || wallet.availableToWithdraw > 0)
        : [];

      setWalletInfo(balances);
      setConnectionStatus('success');
      setConnectionMessage('Connection successful.');
      addLog('success', `Bybit ${apiMode} connection successful.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to test connection';
      setConnectionStatus('error');
      setConnectionMessage(message);
      setWalletInfo(null);
      addLog('error', message);
    }
  };

  const handleManualCloseTrade = async (trade: Trade) => {
    try {
      if (trade.status === 'pending') {
        await closeTradeOnServer(
          trade,
          'cancelled',
          trade.entry,
          'warning',
          `Pending order cancelled: ${trade.side} @ $${trade.entry.toFixed(2)}`
        );
        return;
      }

      const exitPrice = currentPrice ?? trade.entry;
      await closeTradeOnServer(
        trade,
        'breakeven',
        exitPrice,
        'warning',
        `Trade manually closed: ${trade.side} @ $${trade.entry.toFixed(2)} → $${exitPrice.toFixed(2)}`
      );
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to close trade';
      setError(errorMsg);
      addLog('error', errorMsg);
    }
  };

  return (
    <div className="min-h-screen text-white flex">
      {/* Sidebar - Desktop: fixed left, Mobile: slide-out */}
      <Sidebar
        symbol={symbol}
        setSymbol={setSymbol}
        candleInterval={candleInterval}
        setCandleInterval={setCandleInterval}
        maxTrades={maxTrades}
        setMaxTrades={setMaxTrades}
        leverage={leverage}
        setLeverage={setLeverage}
        capital={capital}
        setCapital={setCapital}
        riskAmount={riskAmount}
        setRiskAmount={setRiskAmount}
        riskType={riskType}
        setRiskType={setRiskType}
        dailyTargetType={dailyTargetType}
        setDailyTargetType={setDailyTargetType}
        dailyTargetAmount={dailyTargetAmount}
        setDailyTargetAmount={setDailyTargetAmount}
        dailyStopType={dailyStopType}
        setDailyStopType={setDailyStopType}
        dailyStopAmount={dailyStopAmount}
        setDailyStopAmount={setDailyStopAmount}
        useOrderBookConfirm={useOrderBookConfirm}
        setUseOrderBookConfirm={setUseOrderBookConfirm}
        dailyPnL={dailyPnL}
        dailyTargetValue={dailyTargetValue}
        dailyStopValue={dailyStopValue}
        isDailyTargetHit={isDailyTargetHit}
        isDailyStopHit={isDailyStopHit}
        canTrade={canTrade}
        botRunning={botRunning}
        onStartBot={handleStartBot}
        onStopBot={handleStopBot}
        onSaveSettings={handleSaveSettings}
        symbols={symbols}
        symbolsLoading={symbolsLoading}
        intervals={INTERVALS}
        garchMode={garchMode}
        setGarchMode={setGarchMode}
        customKPct={customKPct}
        setCustomKPct={setCustomKPct}
        apiMode={apiMode}
        setApiMode={setApiMode}
        apiKey={apiKey}
        setApiKey={setApiKey}
        apiSecret={apiSecret}
        setApiSecret={setApiSecret}
        onTestConnection={handleTestConnection}
        connectionStatus={connectionStatus}
        connectionMessage={connectionMessage}
        walletInfo={walletInfo}
      />

      {/* Main Content */}
      <div className="flex-1 p-4 sm:p-6 lg:p-8 overflow-x-hidden">
        <div className="max-w-[1600px] mx-auto">
          {/* Header */}
          <div className="mb-6 lg:mb-8 relative">
            <div className="absolute inset-0 bg-gradient-to-r from-cyan-500/20 via-purple-500/20 to-pink-500/20 blur-3xl rounded-full"></div>
            <div className="relative">
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black mb-2 lg:mb-3 text-gradient-animated">
                GARCHY BOT
              </h1>
              <div className="flex items-center gap-2 lg:gap-3 flex-wrap">
                <div className="h-1 w-12 lg:w-16 bg-gradient-to-r from-cyan-500 to-purple-500 rounded-full"></div>
                <p className="text-gray-300 text-xs sm:text-sm lg:text-base font-medium tracking-wide">Real-time trading signals powered by volatility analysis</p>
                <div className="h-1 w-12 lg:w-16 bg-gradient-to-r from-purple-500 to-pink-500 rounded-full"></div>
              </div>
            </div>
          </div>

          {/* Enhanced Status badges */}
          <div className="mb-8 flex flex-wrap gap-3">
            {/* Core Trading Stats */}
            <div className="px-4 py-2.5 rounded-xl bg-slate-900/60 border border-slate-700/60 backdrop-blur-sm shadow-lg hover:shadow-xl transition-all duration-300">
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 bg-cyan-400 rounded-full opacity-80"></div>
                <div className="text-xs">
                  <div className="text-gray-400 font-medium">Active Orders</div>
                  <div className="text-cyan-300 font-bold text-sm">{trades.filter(t => t.status === 'open' || t.status === 'pending').length}/{maxTrades}</div>
                </div>
              </div>
            </div>

            <div className="px-4 py-2.5 rounded-xl bg-slate-900/60 border border-slate-700/60 backdrop-blur-sm shadow-lg hover:shadow-xl transition-all duration-300">
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 bg-purple-400 rounded-full opacity-80"></div>
                <div className="text-xs">
                  <div className="text-gray-400 font-medium">Leverage</div>
                  <div className="text-purple-300 font-bold text-sm">{leverage}x</div>
                </div>
              </div>
            </div>

            <div className="px-4 py-2.5 rounded-xl bg-slate-900/60 border border-slate-700/60 backdrop-blur-sm shadow-lg hover:shadow-xl transition-all duration-300">
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 bg-pink-400 rounded-full opacity-80"></div>
                <div className="text-xs">
                  <div className="text-gray-400 font-medium">Interval</div>
                  <div className="text-pink-300 font-bold text-sm">{INTERVALS.find(i => i.value === candleInterval)?.label || candleInterval}</div>
                </div>
              </div>
            </div>

            {/* Volatility */}
            {levels && (
              <div className="px-4 py-2.5 rounded-xl bg-slate-900/60 border border-slate-700/60 backdrop-blur-sm shadow-lg hover:shadow-xl transition-all duration-300">
                <div className="flex items-center gap-3">
                  <div className="w-3 h-3 bg-yellow-400 rounded-full opacity-80"></div>
                  <div className="text-xs">
                    <div className="text-gray-400 font-medium">Volatility</div>
                    <div className="text-yellow-300 font-bold text-sm">{(levels.kPct * 100).toFixed(2)}%</div>
                  </div>
                </div>
              </div>
            )}

            {/* Bot Status */}
            {botRunning && (
              <div className="px-4 py-2.5 rounded-xl bg-green-500/15 border border-green-500/40 backdrop-blur-sm shadow-lg hover:shadow-xl transition-all duration-300">
                <div className="flex items-center gap-3">
                  <div className="w-3 h-3 bg-green-400 rounded-full animate-pulse shadow-lg shadow-green-400/50"></div>
                  <div className="text-xs">
                    <div className="text-green-400 font-bold">Bot Active</div>
                    <div className="text-green-300/80 text-xs">Trading enabled</div>
                  </div>
                </div>
              </div>
            )}

            {!botRunning && canTrade && (
              <div className="px-4 py-2.5 rounded-xl bg-orange-500/15 border border-orange-500/40 backdrop-blur-sm shadow-lg hover:shadow-xl transition-all duration-300">
                <div className="flex items-center gap-3">
                  <div className="w-3 h-3 bg-orange-400 rounded-full"></div>
                  <div className="text-xs">
                    <div className="text-orange-400 font-bold">Bot Stopped</div>
                    <div className="text-orange-300/80 text-xs">Ready to trade</div>
                  </div>
                </div>
              </div>
            )}

            {/* Daily Limits Status */}
            {isDailyTargetHit && (
              <div className="px-4 py-2.5 rounded-xl bg-blue-500/15 border border-blue-500/40 backdrop-blur-sm shadow-lg hover:shadow-xl transition-all duration-300">
                <div className="flex items-center gap-3">
                  <svg className="w-5 h-5 text-blue-400" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  <div className="text-xs">
                    <div className="text-blue-400 font-bold">Target Achieved</div>
                    <div className="text-blue-300/80 text-xs">Daily goal reached</div>
                  </div>
                </div>
              </div>
            )}

            {isDailyStopHit && (
              <div className="px-4 py-2.5 rounded-xl bg-red-500/15 border border-red-500/40 backdrop-blur-sm shadow-lg hover:shadow-xl transition-all duration-300">
                <div className="flex items-center gap-3">
                  <svg className="w-5 h-5 text-red-400" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                  </svg>
                  <div className="text-xs">
                    <div className="text-red-400 font-bold">Stop Loss Triggered</div>
                    <div className="text-red-300/80 text-xs">Daily limit reached</div>
                  </div>
                </div>
              </div>
            )}
          </div>

        {error && (
          <div className="glass-effect border-2 border-red-500/50 rounded-xl p-4 mb-6 text-red-300 shadow-2xl shadow-red-500/20 backdrop-blur-xl bg-red-500/5 animate-pulse">
            <div className="flex items-center gap-3">
              <svg className="w-6 h-6 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
              </svg>
              <div className="flex-1">
                <span className="font-bold">Error: {error}</span>
                <div className="text-sm text-red-200 mt-1 opacity-80">
                  Please check your configuration and try again. If the issue persists, contact support.
                </div>
              </div>
              <button
                onClick={() => setError(null)}
                className="text-red-300 hover:text-red-100 transition-colors"
              >
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>
            </div>
          </div>
        )}

        {loadingBotStatus && (
          <div className="text-center py-12">
            <div className="inline-flex items-center gap-3 text-cyan-300">
              <svg className="animate-spin h-6 w-6" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              <span className="font-bold text-lg">Loading bot status from database...</span>
            </div>
          </div>
        )}

        {loading && !loadingBotStatus && (
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
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            {/* Chart spans full width */}
            <div className="xl:col-span-3 glass-effect rounded-2xl p-5 sm:p-7 shadow-2xl card-hover border-2 border-slate-700/50 bg-gradient-to-br from-slate-900/80 to-slate-800/80 backdrop-blur-xl">
              <div className="mb-5">
                <h2 className="text-2xl font-black text-transparent bg-clip-text bg-gradient-to-r from-cyan-300 via-purple-300 to-pink-300 mb-2">Price Chart</h2>
                <p className="text-sm text-gray-300 font-medium">Real-time candlestick data with trading levels</p>
              </div>
              <Chart
                candles={candles}
                dOpen={levels?.dOpen ?? null}
                vwap={levels?.vwap ?? null}
                vwapLine={levels?.vwapLine}
                upLevels={levels?.upLevels ?? []}
                dnLevels={levels?.dnLevels ?? []}
                upper={levels?.upper ?? null}
                lower={levels?.lower ?? null}
                symbol={symbol}
                interval={candleInterval}
                markers={chartMarkers}
                openTrades={openTrades}
                onPriceUpdate={setCurrentPrice}
              />
            </div>

            {/* Trade statistics & activity */}
            <div className="space-y-6">
              <Cards
                price={currentPrice}
                garchPct={levels?.kPct ?? null}
                vwap={levels?.vwap ?? null}
                dOpen={levels?.dOpen ?? null}
                upper={levels?.upper ?? null}
                lower={levels?.lower ?? null}
              />
              <TradeLog trades={trades} sessionPnL={sessionPnL} currentPrice={currentPrice} walletInfo={walletInfo} />
              <ActivityLog logs={activityLogs} maxLogs={50} />
            </div>

            {/* Trades Table */}
            <div className="xl:col-span-2 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <h2 className="text-xl font-bold text-white">Recent Trades</h2>
                <Link href="/history" className="text-cyan-400 hover:text-cyan-300 transition-colors text-sm">
                  View Full History →
                </Link>
              </div>
              <div className="glass-effect rounded-xl p-4 sm:p-6 shadow-2xl border-slate-700/50 bg-slate-900/70 backdrop-blur-xl">
                <TradesTable
                  trades={trades}
                  currentPrice={currentPrice}
                  onCloseTrade={handleManualCloseTrade}
                  candles={candles}
                  symbol={symbol}
                  interval={candleInterval}
                  levels={levels}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
