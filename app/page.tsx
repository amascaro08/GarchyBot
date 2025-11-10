'use client';

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import Chart from '@/components/Chart';
import Cards from '@/components/Cards';
import TradeLog, { Trade } from '@/components/TradeLog';
import TradesTable from '@/components/TradesTable';
import Sidebar from '@/components/Sidebar';
import OrderBook from '@/components/OrderBook';
import ActivityLog, { LogEntry, LogLevel } from '@/components/ActivityLog';
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
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  
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
      const reason = isDailyTargetHit ? 'Daily target reached' : 'Daily stop loss hit';
      addLog('warning', `Bot auto-stopped: ${reason}`);
    }
  }, [botRunning, canTrade, isDailyTargetHit, addLog]);

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

  // Main polling function - uses current symbol/interval from closure
  const pollData = async () => {
    // Capture current values to ensure we use latest
    const currentSymbol = symbol;
    const currentInterval = candleInterval;
    
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
      const lastClose = candlesData.length > 0 ? candlesData[candlesData.length - 1].close : NaN;
      addLog('info', `VWAP: $${lv.vwap.toFixed(2)}, Price: $${lastClose.toFixed(2)}`);

      // Apply breakeven to open trades (if any)
      setTrades((prev) =>
        prev.map((t) => {
          if (t.status !== 'open') return t;
          const newSL = applyBreakeven(t.side, t.entry, t.sl, lastClose, lv.vwap);
          if (newSL !== t.sl) {
            addLog('success', `Breakeven applied: ${t.side} @ $${t.entry.toFixed(2)}, SL → $${newSL.toFixed(2)}`);
          }
          return newSL !== t.sl ? { ...t, sl: newSL } : t;
        })
      );

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
          // Use functional update to get current trades state
          setTrades((prevTrades) => {
            // Check max trades limit with current state
            const openTrades = prevTrades.filter((t) => t.status === 'open');
            if (openTrades.length >= maxTrades) {
              addLog('warning', `Max trades limit reached (${maxTrades}). Skipping signal.`);
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
              addLog('warning', `Duplicate trade detected at $${signalData.touchedLevel!.toFixed(2)}. Skipping.`);
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
            
            addLog('success', `Trade opened: ${signalData.signal} @ $${signalData.touchedLevel!.toFixed(2)}, TP: $${signalData.tp!.toFixed(2)}, SL: $${signalData.sl!.toFixed(2)}`);
            return [...prevTrades, newTrade];
          });
        } else {
          addLog('warning', `Signal rejected: ${signalData.reason}`);
        }
      } else if (botRunning && !canTrade) {
        addLog('warning', 'Trading paused: Daily limit reached');
      } else if (!botRunning && signalData && signalData.signal) {
        addLog('info', `Signal detected but bot is stopped: ${signalData.signal} @ $${signalData.touchedLevel!.toFixed(2)}`);
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
                addLog('success', `Take profit hit: ${trade.side} @ $${trade.entry.toFixed(2)} → $${exitPrice.toFixed(2)}`);
              } else if (lastCandle.low <= trade.sl) {
                newStatus = 'sl';
                exitPrice = trade.sl;
                addLog('error', `Stop loss hit: ${trade.side} @ $${trade.entry.toFixed(2)} → $${exitPrice.toFixed(2)}`);
              }
            } else {
              if (lastCandle.low <= trade.tp) {
                newStatus = 'tp';
                exitPrice = trade.tp;
                addLog('success', `Take profit hit: ${trade.side} @ $${trade.entry.toFixed(2)} → $${exitPrice.toFixed(2)}`);
              } else if (lastCandle.high >= trade.sl) {
                newStatus = 'sl';
                exitPrice = trade.sl;
                addLog('error', `Stop loss hit: ${trade.side} @ $${trade.entry.toFixed(2)} → $${exitPrice.toFixed(2)}`);
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
              const pnlFormatted = pnl >= 0 ? `+$${pnl.toFixed(2)}` : `-$${Math.abs(pnl).toFixed(2)}`;
              addLog(newStatus === 'tp' ? 'success' : 'error', `P&L: ${pnlFormatted}`);
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

  // Load bot status from database on mount
  useEffect(() => {
    const loadBotStatus = async () => {
      try {
        setLoadingBotStatus(true);
        const res = await fetch('/api/bot/status');
        
        if (res.ok) {
          const data = await res.json();
          // Set bot running state from database
          setBotRunning(data.botConfig?.is_running || false);
          
          // Load trades from database if any
          if (data.allTrades && data.allTrades.length > 0) {
            const dbTrades = data.allTrades.map((t: any) => ({
              time: t.entry_time,
              side: t.side,
              entry: Number(t.entry_price),
              tp: Number(t.tp_price),
              sl: Number(t.current_sl),
              reason: t.reason || '',
              status: t.status,
              symbol: t.symbol,
              leverage: t.leverage,
              positionSize: Number(t.position_size),
              exitPrice: t.exit_price ? Number(t.exit_price) : undefined,
            }));
            setTrades(dbTrades);
          }
          
          // Load daily P&L
          if (data.botConfig) {
            setDailyPnL(Number(data.botConfig.daily_pnl || 0));
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
          
          addLog('success', 'Bot status loaded from database');
        }
      } catch (err) {
        console.error('Failed to load bot status:', err);
        addLog('warning', 'Could not load previous bot status');
      } finally {
        setLoadingBotStatus(false);
      }
    };
    
    loadBotStatus();
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
  const currentPrice = candles.length > 0 ? candles[candles.length - 1].close : null;

  const handleStartBot = async () => {
    if (!canTrade) {
      const errorMsg = isDailyTargetHit 
        ? `Daily target reached (${dailyPnL >= 0 ? '+' : ''}${dailyPnL.toFixed(2)}). Reset to continue.`
        : `Daily stop loss hit (${dailyPnL.toFixed(2)}). Reset to continue.`;
      setError(errorMsg);
      addLog('error', `Cannot start bot: ${errorMsg}`);
      return;
    }
    
    try {
      const res = await fetch('/api/bot/start', { method: 'POST' });
      const data = await res.json();
      
      if (!res.ok) {
        throw new Error(data.error || 'Failed to start bot');
      }
      
      setBotRunning(true);
      setError(null);
      addLog('success', `Bot started for ${symbol} - running in background`);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to start bot';
      setError(errorMsg);
      addLog('error', errorMsg);
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
      addLog('warning', 'Bot stopped');
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to stop bot';
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
        symbols={SYMBOLS}
        intervals={INTERVALS}
        garchMode={garchMode}
        setGarchMode={setGarchMode}
        customKPct={customKPct}
        setCustomKPct={setCustomKPct}
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

          {/* Status badges */}
          <div className="mb-6 flex flex-wrap gap-3 text-xs">
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
            {botRunning && (
              <div className="px-3 py-1.5 rounded-lg bg-green-500/10 border border-green-500/30 backdrop-blur-sm">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse shadow-lg shadow-green-400/50"></div>
                  <span className="text-green-400 font-bold">Running</span>
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
              <span className="font-bold">Error: {error}</span>
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
            {/* Chart - takes 2 columns */}
            <div className="xl:col-span-2 space-y-6">
              <div className="glass-effect rounded-2xl p-5 sm:p-7 shadow-2xl card-hover border-2 border-slate-700/50 bg-gradient-to-br from-slate-900/80 to-slate-800/80 backdrop-blur-xl">
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
                  markers={chartMarkers}
                  openTrades={openTrades}
                />
              </div>

              {/* Order Book Visualization */}
              <OrderBook symbol={symbol} currentPrice={currentPrice} />
            </div>

            {/* Right sidebar - Cards, Trade Log, and Activity Log */}
            <div className="space-y-6">
              <Cards
                price={candles.length > 0 ? candles[candles.length - 1].close : null}
                garchPct={levels?.kPct ?? null}
                vwap={levels?.vwap ?? null}
                dOpen={levels?.dOpen ?? null}
                upper={levels?.upper ?? null}
                lower={levels?.lower ?? null}
              />
              <TradeLog trades={trades} sessionPnL={sessionPnL} currentPrice={currentPrice} />
              <ActivityLog logs={activityLogs} maxLogs={50} />
            </div>
          </div>

        {/* Trades Table */}
        <div className="mt-6">
          <TradesTable trades={trades} currentPrice={currentPrice} />
        </div>
        </div>
      </div>
    </div>
  );
}
