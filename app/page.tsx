'use client';

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import Link from 'next/link';
import Navigation from '@/components/Navigation';
import Chart from '@/components/Chart';
import Cards from '@/components/Cards';
import type { Candle, LevelsResponse, SignalResponse } from '@/lib/types';
import { Trade } from '@/components/TradeLog';
import { computeTrailingBreakeven, applyBreakevenOnVWAPFlip } from '@/lib/strategy';
import { startOrderBook, stopOrderBook, confirmLevelTouch } from '@/lib/orderbook';
import { WebSocketProvider, useSharedWebSocket } from '@/lib/WebSocketContext';
import { useThrottle } from '@/lib/hooks/useThrottle';
import { formatCurrency } from '@/lib/format';

const DEFAULT_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
const DEFAULT_SYMBOL = DEFAULT_SYMBOLS[0];
const POLL_INTERVAL = 12000;
const PENDING_FILL_DELAY_MS = 5000;
const SUBDIVISIONS = 5;
const NO_TRADE_BAND_PCT = 0.001;
const DEFAULT_INTERVAL = '5';

interface HomeContentProps {
  onInitialCandlesLoaded?: (candles: Candle[]) => void;
  onSymbolChange?: (symbol: string) => void;
  onIntervalChange?: (interval: string) => void;
}

function HomeContent({ onInitialCandlesLoaded, onSymbolChange, onIntervalChange }: HomeContentProps) {
  // Core State
  const [symbol, setSymbol] = useState<string>(DEFAULT_SYMBOL);
  const [candleInterval, setCandleInterval] = useState<string>(DEFAULT_INTERVAL);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [levels, setLevels] = useState<LevelsResponse | null>(null);
  const [signal, setSignal] = useState<SignalResponse | null>(null);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [sessionPnL, setSessionPnL] = useState<number>(0);
  const [dailyPnL, setDailyPnL] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [botConfigLoaded, setBotConfigLoaded] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [botRunning, setBotRunning] = useState<boolean>(false);
  const [botToggling, setBotToggling] = useState<boolean>(false);
  const [currentPrice, setCurrentPrice] = useState<number | null>(null);
  
  // Bot Config
  const [maxTrades, setMaxTrades] = useState<number>(3);
  const [leverage, setLeverage] = useState<number>(1);
  const [capital, setCapital] = useState<number>(10000);
  const [useOrderBookConfirm, setUseOrderBookConfirm] = useState<boolean>(true);
  const [garchMode, setGarchMode] = useState<'auto' | 'custom'>('auto');
  const [customKPct, setCustomKPct] = useState<number>(0.03);
  
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const tradesRef = useRef<Trade[]>([]);
  
  // WebSocket
  const { ticker: wsTicker, candles: wsCandles, isConnected: wsConnected, connectionStatus: wsConnectionStatus, lastUpdateTime } = useSharedWebSocket();
  // Determine connection status: if we have data (candles or current price), consider it connected
  const hasData = candles.length > 0 || currentPrice !== null;
  const connectionStatus = hasData ? 'connected' : (wsConnectionStatus || 'connecting');
  const isConnected = wsConnected || hasData; // Connected if WebSocket is up OR we have data
  const throttledTickerPrice = useThrottle(wsTicker?.lastPrice, 100);
  
  useEffect(() => {
    if (throttledTickerPrice && throttledTickerPrice > 0) {
      setCurrentPrice(throttledTickerPrice);
    }
  }, [throttledTickerPrice]);
  
  useEffect(() => {
    tradesRef.current = trades;
  }, [trades]);

  // Load bot status on mount (only once!)
  useEffect(() => {
    let mounted = true;
    
    const loadBotStatus = async () => {
      try {
        // Check auth once
        const authRes = await fetch('/api/auth/me');
        if (!authRes.ok) {
          window.location.href = '/login';
          return;
        }

        if (!mounted) return;

        // Load bot config
        const res = await fetch('/api/bot/status');
        if (res.ok && mounted) {
          const data = await res.json();
          if (data.botConfig) {
            const config = data.botConfig;
            setBotRunning(config.is_running || false);
            setSymbol(config.symbol || DEFAULT_SYMBOL);
            setCandleInterval(config.candle_interval || DEFAULT_INTERVAL);
            setMaxTrades(config.max_trades || 3);
            setLeverage(config.leverage || 1);
            setCapital(Number(config.capital) || 10000);
            setDailyPnL(Number(config.daily_pnl || 0));
            setGarchMode(config.garch_mode || 'auto');
            if (config.custom_k_pct !== null) setCustomKPct(Number(config.custom_k_pct));
            setUseOrderBookConfirm(config.use_orderbook_confirm !== false);
          }
          
          // Mark bot config as loaded so chart data can be fetched
          setBotConfigLoaded(true);
          
          // Load trades from database
          let allTradesData: Trade[] = [];
          if (data.allTrades && data.allTrades.length > 0) {
            allTradesData = data.allTrades.map((t: any) => ({
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
          }
          
          // Add external Bybit positions as virtual trades for display
          if (data.bybitPositions && data.bybitPositions.length > 0) {
            const dbSymbols = new Set(allTradesData.filter(t => t.status === 'open').map(t => t.symbol));
            
            // Add external positions (not tracked in database)
            data.bybitPositions.forEach((pos: any) => {
              if (!dbSymbols.has(pos.symbol) && pos.size > 0) {
                // Create a virtual trade object for external Bybit positions
                allTradesData.push({
                  id: `bybit-${pos.symbol}`,
                  time: pos.createdTime || new Date().toISOString(),
                  side: pos.side,
                  entry: pos.avgPrice,
                  tp: pos.takeProfit || pos.avgPrice * (pos.side === 'LONG' ? 1.05 : 0.95),
                  sl: pos.stopLoss || pos.avgPrice * (pos.side === 'LONG' ? 0.95 : 1.05),
                  initialSl: pos.stopLoss || pos.avgPrice * (pos.side === 'LONG' ? 0.95 : 1.05),
                  reason: 'External Position (Bybit)',
                  status: 'open' as const,
                  symbol: pos.symbol,
                  leverage: pos.leverage || 1,
                  positionSize: pos.size,
                  exitPrice: undefined,
                  pnl: pos.unrealisedPnl,
                });
              }
            });
          }
          
          if (mounted && allTradesData.length > 0) setTrades(allTradesData);
          if (data.sessionPnL !== undefined && mounted) setSessionPnL(Number(data.sessionPnL));
        }
      } catch (err) {
        console.error('Failed to load bot status:', err);
        // Even if bot status fails, allow chart to load with defaults
        if (mounted) setBotConfigLoaded(true);
      }
    };

    loadBotStatus();
    
    return () => {
      mounted = false;
    };
  }, []); // Empty deps - run only once on mount

  // Load initial data once, then only when symbol/interval changes
  // IMPORTANT: Wait for bot config to load first to avoid double-painting
  useEffect(() => {
    // Don't load chart data until bot config is loaded
    if (!botConfigLoaded) {
      return;
    }
    
    let mounted = true;
    
    // Clear existing data when symbol changes
    setCandles([]);
    setLevels(null);
    setCurrentPrice(null);
    
    if (onSymbolChange) onSymbolChange(symbol);
    if (onIntervalChange) onIntervalChange(candleInterval);

    const loadData = async () => {
      try {
        // Only show loading on initial load or symbol change, not on polling
        const isInitialLoad = candles.length === 0;
        if (isInitialLoad && mounted) setLoading(true);
        
        // Fetch klines
        let klinesData;
        try {
          const res = await fetch(`/api/klines?symbol=${symbol}&interval=${candleInterval}&limit=200&testnet=false`);
          if (res.ok) {
            klinesData = await res.json();
          } else {
            const testnetRes = await fetch(`/api/klines?symbol=${symbol}&interval=${candleInterval}&limit=200&testnet=true`);
            klinesData = await testnetRes.json();
          }
        } catch (err) {
          const testnetRes = await fetch(`/api/klines?symbol=${symbol}&interval=${candleInterval}&limit=200&testnet=true`);
          klinesData = await testnetRes.json();
        }
        
        if (mounted && klinesData && Array.isArray(klinesData) && klinesData.length > 0) {
          setCandles(klinesData);
          if (onInitialCandlesLoaded) onInitialCandlesLoaded(klinesData);
          const latest = klinesData[klinesData.length - 1];
          if (latest && Number.isFinite(latest.close)) setCurrentPrice(latest.close);
        }

        // Fetch levels
        const levelsRes = await fetch('/api/levels', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            symbol, 
            subdivisions: SUBDIVISIONS,
            testnet: true,
            ...(garchMode === 'custom' && { customKPct }),
          }),
        });
        
        if (mounted && levelsRes.ok) {
          const levelsData = await levelsRes.json();
          setLevels(levelsData);
        }

        if (mounted) setLoading(false);
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : 'Failed to load data');
          setLoading(false);
        }
      }
    };

    loadData();

    // Only poll if bot is running AND WebSocket isn't connected
    // This prevents double polling when WebSocket is active
    if (botRunning && !wsConnected) {
      const intervalId = setInterval(() => {
        if (!wsConnected && mounted) { // Only poll if WebSocket is down
          loadData();
        }
      }, POLL_INTERVAL);
      pollingIntervalRef.current = intervalId;
      
      return () => {
        mounted = false;
        if (pollingIntervalRef.current) {
          clearInterval(pollingIntervalRef.current);
          pollingIntervalRef.current = null;
        }
      };
    }
    
    return () => {
      mounted = false;
    };
  }, [symbol, candleInterval, garchMode, customKPct, botRunning, wsConnected, botConfigLoaded]);

  // Real-time trade updates
  useEffect(() => {
    const eventSource = new EventSource('/api/trades/stream');

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'trades' && data.trades) {
          const dbTrades = data.trades.map((t: any) => ({
            id: t.id,
            time: t.time,
            side: t.side,
            entry: Number(t.entry),
            tp: Number(t.tp),
            sl: Number(t.sl),
            initialSl: Number(t.initialSl),
            reason: t.reason || '',
            status: t.status,
            symbol: t.symbol,
            leverage: Number(t.leverage || leverage),
            positionSize: Number(t.positionSize),
            exitPrice: t.exitPrice ? Number(t.exitPrice) : undefined,
            pnl: t.pnl !== null && t.pnl !== undefined ? Number(t.pnl) : undefined,
          }));
          setTrades(dbTrades);
          tradesRef.current = dbTrades;
        } else if (data.type === 'pnl') {
          if (data.sessionPnL !== undefined) setSessionPnL(Number(data.sessionPnL));
          if (data.dailyPnL !== undefined) setDailyPnL(Number(data.dailyPnL));
        }
      } catch (err) {
        console.error('Error parsing SSE message:', err);
      }
    };

    return () => {
      eventSource.close();
    };
  }, [leverage]);

  // Start/Stop Bot
  const handleQuickToggle = async () => {
    if (botToggling) return; // Prevent multiple clicks
    
    setBotToggling(true);
    
    if (botRunning) {
      try {
        const res = await fetch('/api/bot/stop', { method: 'POST' });
        if (res.ok) {
          const data = await res.json();
          setBotRunning(false);
          if (pollingIntervalRef.current) {
            clearInterval(pollingIntervalRef.current);
            pollingIntervalRef.current = null;
          }
          console.log('Bot stopped successfully');
        } else {
          const data = await res.json();
          console.error('Failed to stop bot:', data.error);
          setError(data.error || 'Failed to stop bot');
          setTimeout(() => setError(null), 5000);
        }
      } catch (err) {
        console.error('Failed to stop bot:', err);
        setError(err instanceof Error ? err.message : 'Failed to stop bot');
        setTimeout(() => setError(null), 5000);
      } finally {
        setBotToggling(false);
      }
    } else {
      try {
        const res = await fetch('/api/bot/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        if (res.ok) {
          const data = await res.json();
          setBotRunning(true);
          console.log('Bot started successfully');
        } else {
          const data = await res.json();
          console.error('Failed to start bot:', data.error);
          setError(data.error || 'Failed to start bot');
          setTimeout(() => setError(null), 5000);
        }
      } catch (err) {
        console.error('Failed to start bot:', err);
        setError(err instanceof Error ? err.message : 'Failed to start bot');
        setTimeout(() => setError(null), 5000);
      } finally {
        setBotToggling(false);
      }
    }
  };

  // Calculate stats
  // Note: trades array now includes both database trades AND external Bybit positions
  const activeTrades = trades.filter(t => t.status === 'open' || t.status === 'pending');
  const openTrades = trades.filter(t => t.status === 'open');
  const closedTrades = trades.filter(t => t.status !== 'open' && t.status !== 'pending');
  const wins = closedTrades.filter(t => t.status === 'tp').length;
  const losses = closedTrades.filter(t => t.status === 'sl').length;
  const winRate = closedTrades.length > 0 ? (wins / closedTrades.length) * 100 : 0;

  const totalUnrealizedPnL = openTrades.reduce((sum, trade) => {
    // For external Bybit positions, use the actual unrealized PnL from Bybit
    if (trade.pnl !== undefined && trade.pnl !== null && trade.id.startsWith('bybit-')) {
      return sum + trade.pnl;
    }
    
    // For database trades, calculate PnL from current price
    if (currentPrice !== null && currentPrice > 0) {
      const positionSize = trade.positionSize || 0;
      const pnl = trade.side === 'LONG' 
        ? (currentPrice - trade.entry) * positionSize
        : (trade.entry - currentPrice) * positionSize;
      return sum + pnl;
    }
    return sum;
  }, 0);

  // Chart markers
  const chartMarkers = useMemo(() => {
    if (signal && signal.signal && signal.touchedLevel && candles.length > 0) {
      return [{
        time: candles[candles.length - 1]?.ts / 1000,
        position: signal.signal === 'LONG' ? ('belowBar' as const) : ('aboveBar' as const),
        color: signal.signal === 'LONG' ? '#10b981' : '#ef4444',
        shape: signal.signal === 'LONG' ? ('arrowUp' as const) : ('arrowDown' as const),
        text: `${signal.signal} @ ${signal.touchedLevel.toFixed(2)}`,
      }];
    }
    return [];
  }, [signal, candles]);

  const openTradesForChart = useMemo(() => {
    return openTrades.map((t) => ({
      entry: t.entry,
      tp: t.tp,
      sl: t.sl,
      side: t.side,
    }));
  }, [openTrades]);

  // Show loading until bot config is loaded AND initial data is ready
  const showFullPageLoading = (!botConfigLoaded || loading) && candles.length === 0 && !currentPrice;
  
  if (showFullPageLoading) {
    return (
      <div className="min-h-screen bg-[#0a0e1a] flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-400 mx-auto mb-4"></div>
          <p className="text-gray-300">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0e1a]">
      <Navigation botRunning={botRunning} onQuickToggle={handleQuickToggle} botToggling={botToggling} />
      
      <main className="pt-20 md:pt-24 pb-24 md:pb-8 px-4 md:px-6">
        <div className="max-w-[1800px] mx-auto space-y-6">
          {/* Hero Metrics */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 md:gap-4">
            <HeroMetric
              label="Bot Status"
              value={botRunning ? 'Active' : 'Inactive'}
              variant={botRunning ? 'success' : 'neutral'}
              icon="⚡"
            />
            <HeroMetric
              label="Active Trades"
              value={`${activeTrades.length}/${maxTrades}`}
              icon="📊"
            />
            <HeroMetric
              label="Session P&L"
              value={formatCurrency(sessionPnL)}
              variant={sessionPnL >= 0 ? 'success' : 'danger'}
              icon="💰"
            />
            <HeroMetric
              label="Daily P&L"
              value={formatCurrency(dailyPnL)}
              variant={dailyPnL >= 0 ? 'success' : 'danger'}
              icon="📅"
            />
            <HeroMetric
              label="Win Rate"
              value={`${winRate.toFixed(0)}%`}
              variant={winRate >= 50 ? 'success' : 'danger'}
              icon="🎯"
            />
            <HeroMetric
              label="Volatility"
              value={levels ? `${(levels.kPct * 100).toFixed(2)}%` : '—'}
              icon="📈"
            />
          </div>

          {/* Error Display */}
          {error && (
            <div className="card p-4 border-red-500/30 bg-red-500/10">
              <div className="flex items-center gap-3">
                <span className="text-2xl">⚠️</span>
                <div>
                  <div className="font-bold text-red-300">Error</div>
                  <div className="text-sm text-red-400">{error}</div>
                </div>
              </div>
            </div>
          )}

          {/* Market Info Cards */}
          <Cards
            price={currentPrice}
            garchPct={levels?.kPct ?? null}
            vwap={levels?.vwap ?? null}
            dOpen={levels?.dOpen ?? null}
            upper={levels?.upper ?? null}
            lower={levels?.lower ?? null}
          />

          {/* Chart */}
          <div className="card p-4 md:p-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
              <div>
                <h2 className="text-xl md:text-2xl font-bold text-white">Price Chart</h2>
                <p className="text-sm text-slate-400">{symbol} • {candleInterval}m interval</p>
              </div>
              <div className="flex items-center gap-3">
                {/* Symbol Selector */}
                <select 
                  value={symbol} 
                  onChange={async (e) => {
                    const newSymbol = e.target.value;
                    setSymbol(newSymbol);
                    // Update bot config
                    try {
                      await fetch('/api/bot/config', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ symbol: newSymbol }),
                      });
                    } catch (err) {
                      console.error('Failed to update symbol:', err);
                    }
                  }}
                  className="px-3 py-2 bg-slate-800/50 border border-slate-700/60 rounded-lg text-sm font-semibold text-white hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  {DEFAULT_SYMBOLS.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
                
                {/* Connection Status */}
                <div className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${
                  isConnected ? 'bg-green-500/20 text-green-300 border border-green-500/30' : 'bg-red-500/20 text-red-300 border border-red-500/30'
                }`}>
                  {isConnected ? '🟢 Live' : '🔴 Offline'}
                </div>
              </div>
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
              openTrades={openTradesForChart}
              onPriceUpdate={setCurrentPrice}
            />
          </div>

          {/* Active Positions */}
          {activeTrades.length > 0 && (
            <div className="card p-4 md:p-6">
              <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                <span className="text-2xl">💼</span>
                Active Positions ({activeTrades.length})
              </h2>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {activeTrades.map((trade) => {
                  // Use Bybit's actual unrealized PnL for external positions
                  let unrealizedPnL = 0;
                  if (trade.pnl !== undefined && trade.pnl !== null && trade.id.startsWith('bybit-')) {
                    unrealizedPnL = trade.pnl;
                  } else if (currentPrice && trade.status === 'open') {
                    unrealizedPnL = trade.side === 'LONG' 
                      ? (currentPrice - trade.entry) * (trade.positionSize || 0)
                      : (trade.entry - currentPrice) * (trade.positionSize || 0);
                  }

                  return (
                    <div key={trade.id} className="card p-4 bg-slate-800/50">
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <span className={`px-2 py-1 rounded text-xs font-semibold ${
                              trade.side === 'LONG' ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30' : 'bg-red-500/20 text-red-400 border border-red-500/30'
                            }`}>
                              {trade.side}
                            </span>
                            <span className="text-white font-bold">{trade.symbol}</span>
                          </div>
                          <div className="text-xs text-slate-400">{new Date(trade.time).toLocaleString()}</div>
                        </div>
                        <div className={`text-right ${unrealizedPnL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          <div className="text-xs font-semibold">Unrealized P&L</div>
                          <div className="text-lg font-bold">{formatCurrency(unrealizedPnL)}</div>
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-3 text-sm">
                        <div>
                          <div className="text-xs text-slate-400">Entry</div>
                          <div className="font-semibold text-white">${trade.entry.toFixed(2)}</div>
                        </div>
                        <div>
                          <div className="text-xs text-slate-400">TP</div>
                          <div className="font-semibold text-green-400">${trade.tp.toFixed(2)}</div>
                        </div>
                        <div>
                          <div className="text-xs text-slate-400">SL</div>
                          <div className="font-semibold text-red-400">${trade.sl.toFixed(2)}</div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Quick Actions */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Link href="/trades" className="card p-6 hover:shadow-xl transition-all duration-300 cursor-pointer">
              <div className="text-3xl mb-2">💹</div>
              <h3 className="text-lg font-bold text-white mb-1">View All Trades</h3>
              <p className="text-sm text-slate-400">Full trade history and performance</p>
            </Link>
            <Link href="/analytics" className="card p-6 hover:shadow-xl transition-all duration-300 cursor-pointer">
              <div className="text-3xl mb-2">📈</div>
              <h3 className="text-lg font-bold text-white mb-1">Analytics</h3>
              <p className="text-sm text-slate-400">Detailed performance insights</p>
            </Link>
            <Link href="/settings" className="card p-6 hover:shadow-xl transition-all duration-300 cursor-pointer">
              <div className="text-3xl mb-2">⚙️</div>
              <h3 className="text-lg font-bold text-white mb-1">Settings</h3>
              <p className="text-sm text-slate-400">Configure bot parameters</p>
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}

function HeroMetric({ label, value, variant, icon }: { label: string; value: string | number; variant?: 'success' | 'danger' | 'neutral'; icon?: string }) {
  const colorClass = variant === 'success' 
    ? 'border-green-500/30 bg-green-500/10 text-green-400' 
    : variant === 'danger'
    ? 'border-red-500/30 bg-red-500/10 text-red-400'
    : 'border-slate-700/50 bg-slate-800/50 text-slate-300';

  return (
    <div className={`card p-4 border ${colorClass} hover:shadow-xl transition-all duration-300`}>
      {icon && <div className="text-2xl mb-2">{icon}</div>}
      <div className="text-xs uppercase tracking-wider text-slate-400 mb-1">{label}</div>
      <div className="text-lg md:text-xl lg:text-2xl font-bold truncate">{value}</div>
    </div>
  );
}

// Wrapper component
export default function Home() {
  const [isReady, setIsReady] = useState(false);
  const [wrapperSymbol, setWrapperSymbol] = useState<string>(DEFAULT_SYMBOL);
  const [wrapperInterval, setWrapperInterval] = useState<string>(DEFAULT_INTERVAL);
  const [initialCandles, setInitialCandles] = useState<Candle[]>([]);

  useEffect(() => {
    setIsReady(true);
  }, []);

  if (!isReady) {
    return (
      <div className="min-h-screen bg-[#0a0e1a] flex items-center justify-center">
        <div className="text-slate-300">Loading...</div>
      </div>
    );
  }

  return (
    <WebSocketProvider symbol={wrapperSymbol} interval={wrapperInterval} initialCandles={initialCandles}>
      <HomeContent 
        onInitialCandlesLoaded={setInitialCandles}
        onSymbolChange={setWrapperSymbol}
        onIntervalChange={setWrapperInterval}
      />
    </WebSocketProvider>
  );
}
