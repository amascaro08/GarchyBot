'use client';

import { useState, useEffect, useMemo } from 'react';
import Navigation from '@/components/Navigation';
import type { Trade } from '@/components/TradeLog';

export default function AnalyticsPage() {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const [timeframe, setTimeframe] = useState<'day' | 'week' | 'month' | 'all'>('week');

  useEffect(() => {
    loadTradeHistory();
  }, []);

  const loadTradeHistory = async () => {
    try {
      const res = await fetch('/api/bot/status');
      if (res.ok) {
        const data = await res.json();
        if (data.allTrades && Array.isArray(data.allTrades)) {
          const formattedTrades = data.allTrades.map((t: any) => ({
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
            leverage: t.leverage,
            positionSize: Number(t.position_size),
            exitPrice: t.exit_price ? Number(t.exit_price) : undefined,
            pnl: t.pnl !== null && t.pnl !== undefined ? Number(t.pnl) : undefined,
          }));
          setTrades(formattedTrades);
        }
      }
    } catch (error) {
      console.error('Failed to load trade history:', error);
    } finally {
      setLoading(false);
    }
  };

  const analytics = useMemo(() => {
    // Filter trades based on timeframe
    const now = new Date();
    const filteredTrades = trades.filter(trade => {
      const tradeDate = new Date(trade.time);
      const daysDiff = (now.getTime() - tradeDate.getTime()) / (1000 * 60 * 60 * 24);
      
      if (timeframe === 'day') return daysDiff <= 1;
      if (timeframe === 'week') return daysDiff <= 7;
      if (timeframe === 'month') return daysDiff <= 30;
      return true;
    });

    const closedTrades = filteredTrades.filter(t => t.status !== 'open' && t.status !== 'pending');
    const wins = closedTrades.filter(t => t.status === 'tp');
    const losses = closedTrades.filter(t => t.status === 'sl');
    const longTrades = closedTrades.filter(t => t.side === 'LONG');
    const shortTrades = closedTrades.filter(t => t.side === 'SHORT');

    const calculatePnL = (trades: Trade[]) => {
      return trades.reduce((sum, trade) => {
        if (!trade.exitPrice) return sum;
        const pnl = trade.side === 'LONG'
          ? (trade.exitPrice - trade.entry) * (trade.positionSize || 0)
          : (trade.entry - trade.exitPrice) * (trade.positionSize || 0);
        return sum + pnl;
      }, 0);
    };

    const totalPnL = calculatePnL(closedTrades);
    const winPnL = calculatePnL(wins);
    const lossPnL = calculatePnL(losses);
    const longPnL = calculatePnL(longTrades);
    const shortPnL = calculatePnL(shortTrades);

    const winRate = closedTrades.length > 0 ? (wins.length / closedTrades.length) * 100 : 0;
    const avgWin = wins.length > 0 ? winPnL / wins.length : 0;
    const avgLoss = losses.length > 0 ? lossPnL / losses.length : 0;
    const profitFactor = lossPnL !== 0 ? Math.abs(winPnL / lossPnL) : winPnL > 0 ? Infinity : 0;
    const avgTrade = closedTrades.length > 0 ? totalPnL / closedTrades.length : 0;
    
    const longWinRate = longTrades.length > 0 ? (longTrades.filter(t => t.status === 'tp').length / longTrades.length) * 100 : 0;
    const shortWinRate = shortTrades.length > 0 ? (shortTrades.filter(t => t.status === 'tp').length / shortTrades.length) * 100 : 0;

    // Best and worst trades
    const tradesWithPnL = closedTrades
      .map(trade => ({
        ...trade,
        calculatedPnL: trade.exitPrice && trade.positionSize
          ? (trade.side === 'LONG' ? (trade.exitPrice - trade.entry) : (trade.entry - trade.exitPrice)) * trade.positionSize
          : 0
      }))
      .filter(t => t.calculatedPnL !== 0);

    const bestTrade = tradesWithPnL.length > 0 ? tradesWithPnL.reduce((best, current) => 
      current.calculatedPnL > best.calculatedPnL ? current : best
    ) : null;

    const worstTrade = tradesWithPnL.length > 0 ? tradesWithPnL.reduce((worst, current) => 
      current.calculatedPnL < worst.calculatedPnL ? current : worst
    ) : null;

    // Daily performance
    const dailyPerformance = closedTrades.reduce((acc, trade) => {
      const date = new Date(trade.time).toISOString().split('T')[0];
      if (!acc[date]) {
        acc[date] = { trades: 0, pnl: 0, wins: 0, losses: 0 };
      }
      acc[date].trades++;
      if (trade.exitPrice && trade.positionSize) {
        const pnl = trade.side === 'LONG'
          ? (trade.exitPrice - trade.entry) * trade.positionSize
          : (trade.entry - trade.exitPrice) * trade.positionSize;
        acc[date].pnl += pnl;
        if (trade.status === 'tp') acc[date].wins++;
        if (trade.status === 'sl') acc[date].losses++;
      }
      return acc;
    }, {} as Record<string, { trades: number; pnl: number; wins: number; losses: number }>);

    return {
      totalTrades: closedTrades.length,
      wins: wins.length,
      losses: losses.length,
      winRate,
      totalPnL,
      avgWin,
      avgLoss,
      profitFactor,
      avgTrade,
      longTrades: longTrades.length,
      shortTrades: shortTrades.length,
      longPnL,
      shortPnL,
      longWinRate,
      shortWinRate,
      bestTrade,
      worstTrade,
      dailyPerformance: Object.entries(dailyPerformance).map(([date, data]) => ({ date, ...data })).sort((a, b) => a.date.localeCompare(b.date)),
    };
  }, [trades, timeframe]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0e1a] flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-400 mx-auto mb-4"></div>
          <p className="text-gray-300">Loading analytics...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0e1a]">
      <Navigation />
      
      <main className="pt-20 md:pt-24 pb-24 md:pb-8 px-4 md:px-6">
        <div className="max-w-[1800px] mx-auto">
          {/* Page Header */}
          <div className="mb-8">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div>
                <h1 className="text-3xl md:text-4xl font-black gradient-text mb-2">Analytics</h1>
                <p className="text-slate-400">Detailed performance insights and statistics</p>
              </div>
              
              {/* Timeframe Selector */}
              <div className="flex gap-2 bg-slate-800/50 p-1.5 rounded-xl border border-slate-700/60">
                {(['day', 'week', 'month', 'all'] as const).map((tf) => (
                  <button
                    key={tf}
                    onClick={() => setTimeframe(tf)}
                    className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-300 ${
                      timeframe === tf
                        ? 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-lg'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {tf === 'all' ? 'All Time' : tf.charAt(0).toUpperCase() + tf.slice(1)}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Key Metrics */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 mb-8">
            <MetricCard label="Total Trades" value={analytics.totalTrades} />
            <MetricCard label="Win Rate" value={`${analytics.winRate.toFixed(1)}%`} variant={analytics.winRate >= 50 ? 'success' : 'danger'} />
            <MetricCard label="Total P&L" value={`$${analytics.totalPnL.toFixed(0)}`} variant={analytics.totalPnL >= 0 ? 'success' : 'danger'} />
            <MetricCard label="Profit Factor" value={analytics.profitFactor === Infinity ? '∞' : analytics.profitFactor.toFixed(2)} variant={analytics.profitFactor >= 1.5 ? 'success' : 'warning'} />
            <MetricCard label="Avg Trade" value={`$${analytics.avgTrade.toFixed(2)}`} variant={analytics.avgTrade >= 0 ? 'success' : 'danger'} />
            <MetricCard label="Wins/Losses" value={`${analytics.wins}/${analytics.losses}`} />
          </div>

          {/* Performance Breakdown */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
            {/* Win/Loss Analysis */}
            <div className="card p-6">
              <h2 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
                <span className="text-2xl">📊</span>
                Win/Loss Analysis
              </h2>
              <div className="space-y-4">
                <div>
                  <div className="flex justify-between text-sm mb-2">
                    <span className="text-slate-400">Win Rate</span>
                    <span className="text-green-400 font-bold">{analytics.winRate.toFixed(1)}%</span>
                  </div>
                  <div className="w-full bg-slate-800/50 rounded-full h-3">
                    <div className="bg-gradient-to-r from-green-600 to-green-400 h-3 rounded-full transition-all duration-500" style={{ width: `${analytics.winRate}%` }} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4 pt-4">
                  <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-4">
                    <div className="text-sm text-slate-400 mb-1">Avg Win</div>
                    <div className="text-2xl font-bold text-green-400">${analytics.avgWin.toFixed(2)}</div>
                  </div>
                  <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4">
                    <div className="text-sm text-slate-400 mb-1">Avg Loss</div>
                    <div className="text-2xl font-bold text-red-400">${Math.abs(analytics.avgLoss).toFixed(2)}</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Long vs Short */}
            <div className="card p-6">
              <h2 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
                <span className="text-2xl">⚖️</span>
                Long vs Short Performance
              </h2>
              <div className="space-y-6">
                <div>
                  <div className="flex justify-between text-sm mb-2">
                    <span className="text-slate-400">Long Trades</span>
                    <span className="text-blue-400 font-bold">{analytics.longTrades} trades</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3">
                      <div className="text-xs text-slate-400">Win Rate</div>
                      <div className="text-lg font-bold text-blue-400">{analytics.longWinRate.toFixed(1)}%</div>
                    </div>
                    <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3">
                      <div className="text-xs text-slate-400">P&L</div>
                      <div className={`text-lg font-bold ${analytics.longPnL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        ${analytics.longPnL.toFixed(0)}
                      </div>
                    </div>
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-sm mb-2">
                    <span className="text-slate-400">Short Trades</span>
                    <span className="text-red-400 font-bold">{analytics.shortTrades} trades</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3">
                      <div className="text-xs text-slate-400">Win Rate</div>
                      <div className="text-lg font-bold text-red-400">{analytics.shortWinRate.toFixed(1)}%</div>
                    </div>
                    <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3">
                      <div className="text-xs text-slate-400">P&L</div>
                      <div className={`text-lg font-bold ${analytics.shortPnL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        ${analytics.shortPnL.toFixed(0)}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Best and Worst Trades */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
            {/* Best Trade */}
            <div className="card p-6 border-green-500/30 bg-green-500/5">
              <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                <span className="text-2xl">🏆</span>
                Best Trade
              </h2>
              {analytics.bestTrade ? (
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-slate-400">Symbol</span>
                    <span className="text-white font-bold">{analytics.bestTrade.symbol}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-slate-400">Side</span>
                    <span className={`px-2 py-1 rounded text-xs font-semibold ${
                      analytics.bestTrade.side === 'LONG' ? 'bg-blue-500/20 text-blue-400' : 'bg-red-500/20 text-red-400'
                    }`}>
                      {analytics.bestTrade.side}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-slate-400">Entry → Exit</span>
                    <span className="text-white font-mono">${analytics.bestTrade.entry.toFixed(2)} → ${analytics.bestTrade.exitPrice?.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between items-center pt-3 border-t border-green-500/30">
                    <span className="text-slate-400">Profit</span>
                    <span className="text-2xl font-bold text-green-400">+${analytics.bestTrade.calculatedPnL.toFixed(2)}</span>
                  </div>
                </div>
              ) : (
                <p className="text-slate-400">No profitable trades yet</p>
              )}
            </div>

            {/* Worst Trade */}
            <div className="card p-6 border-red-500/30 bg-red-500/5">
              <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                <span className="text-2xl">⚠️</span>
                Worst Trade
              </h2>
              {analytics.worstTrade ? (
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-slate-400">Symbol</span>
                    <span className="text-white font-bold">{analytics.worstTrade.symbol}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-slate-400">Side</span>
                    <span className={`px-2 py-1 rounded text-xs font-semibold ${
                      analytics.worstTrade.side === 'LONG' ? 'bg-blue-500/20 text-blue-400' : 'bg-red-500/20 text-red-400'
                    }`}>
                      {analytics.worstTrade.side}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-slate-400">Entry → Exit</span>
                    <span className="text-white font-mono">${analytics.worstTrade.entry.toFixed(2)} → ${analytics.worstTrade.exitPrice?.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between items-center pt-3 border-t border-red-500/30">
                    <span className="text-slate-400">Loss</span>
                    <span className="text-2xl font-bold text-red-400">${analytics.worstTrade.calculatedPnL.toFixed(2)}</span>
                  </div>
                </div>
              ) : (
                <p className="text-slate-400">No losing trades yet</p>
              )}
            </div>
          </div>

          {/* Daily Performance */}
          {analytics.dailyPerformance.length > 0 && (
            <div className="card p-6">
              <h2 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
                <span className="text-2xl">📅</span>
                Daily Performance
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[600px]">
                  <thead>
                    <tr className="border-b border-slate-700/50">
                      <th className="text-left py-3 px-4 text-sm font-semibold text-slate-300">Date</th>
                      <th className="text-center py-3 px-4 text-sm font-semibold text-slate-300">Trades</th>
                      <th className="text-center py-3 px-4 text-sm font-semibold text-slate-300">Wins</th>
                      <th className="text-center py-3 px-4 text-sm font-semibold text-slate-300">Losses</th>
                      <th className="text-right py-3 px-4 text-sm font-semibold text-slate-300">P&L</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analytics.dailyPerformance.slice(-10).reverse().map((day) => (
                      <tr key={day.date} className="border-b border-slate-700/30 hover:bg-slate-800/50 transition-colors">
                        <td className="py-3 px-4 text-sm text-white">{new Date(day.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                        <td className="py-3 px-4 text-sm text-center text-slate-300">{day.trades}</td>
                        <td className="py-3 px-4 text-sm text-center text-green-400">{day.wins}</td>
                        <td className="py-3 px-4 text-sm text-center text-red-400">{day.losses}</td>
                        <td className="py-3 px-4 text-sm text-right font-mono">
                          <span className={`font-semibold ${day.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {day.pnl >= 0 ? '+' : ''}${day.pnl.toFixed(2)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

function MetricCard({ label, value, variant }: { label: string; value: number | string; variant?: 'success' | 'danger' | 'warning' }) {
  const colorClass = variant === 'success' 
    ? 'border-green-500/30 bg-green-500/10 text-green-400' 
    : variant === 'danger'
    ? 'border-red-500/30 bg-red-500/10 text-red-400'
    : variant === 'warning'
    ? 'border-yellow-500/30 bg-yellow-500/10 text-yellow-400'
    : 'border-slate-700/50 bg-slate-800/50 text-slate-300';

  return (
    <div className={`card p-4 border ${colorClass}`}>
      <div className="text-xs uppercase tracking-wider text-slate-400 mb-1">{label}</div>
      <div className="text-xl md:text-2xl font-bold">{value}</div>
    </div>
  );
}
