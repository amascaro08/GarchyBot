'use client';

import { useState, useEffect } from 'react';
import Navigation from '@/components/Navigation';
import { formatCurrencyNoSymbol } from '@/lib/format';
import type { Trade } from '@/components/TradeLog';

interface TradeStats {
  totalTrades: number;
  winTrades: number;
  lossTrades: number;
  breakevenTrades: number;
  winRate: number;
  totalPnL: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
}

export default function TradesPage() {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [filteredTrades, setFilteredTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [sideFilter, setSideFilter] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => {
    loadTradeHistory();
  }, []);

  useEffect(() => {
    filterTrades();
  }, [trades, searchTerm, statusFilter, sideFilter, dateFrom, dateTo]);

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

  const filterTrades = () => {
    let filtered = trades;

    if (searchTerm) {
      filtered = filtered.filter(trade =>
        (trade.symbol || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (trade.reason || '').toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    if (statusFilter !== 'all') {
      filtered = filtered.filter(trade => trade.status === statusFilter);
    }

    if (sideFilter !== 'all') {
      filtered = filtered.filter(trade => trade.side === sideFilter);
    }

    if (dateFrom || dateTo) {
      filtered = filtered.filter(trade => {
        const tradeDate = new Date(trade.time).toISOString().split('T')[0];
        const fromCheck = !dateFrom || tradeDate >= dateFrom;
        const toCheck = !dateTo || tradeDate <= dateTo;
        return fromCheck && toCheck;
      });
    }

    setFilteredTrades(filtered);
  };

  const calculateStats = (): TradeStats => {
    const closedTrades = filteredTrades.filter(t => t.status !== 'open' && t.status !== 'pending');
    const winTrades = closedTrades.filter(t => t.status === 'tp');
    const lossTrades = closedTrades.filter(t => t.status === 'sl');
    const breakevenTrades = closedTrades.filter(t => t.status === 'breakeven');

    const totalPnL = closedTrades.reduce((sum, trade) => {
      if (!trade.exitPrice) return sum;
      const pnl = trade.side === 'LONG'
        ? (trade.exitPrice - trade.entry) * (trade.positionSize || 0)
        : (trade.entry - trade.exitPrice) * (trade.positionSize || 0);
      return sum + pnl;
    }, 0);

    const totalWins = winTrades.reduce((sum, trade) => {
      if (!trade.exitPrice) return sum;
      const pnl = trade.side === 'LONG'
        ? (trade.exitPrice - trade.entry) * (trade.positionSize || 0)
        : (trade.entry - trade.exitPrice) * (trade.positionSize || 0);
      return sum + pnl;
    }, 0);

    const totalLosses = lossTrades.reduce((sum, trade) => {
      if (!trade.exitPrice) return sum;
      const pnl = trade.side === 'LONG'
        ? (trade.exitPrice - trade.entry) * (trade.positionSize || 0)
        : (trade.entry - trade.exitPrice) * (trade.positionSize || 0);
      return sum + pnl;
    }, 0);

    return {
      totalTrades: closedTrades.length,
      winTrades: winTrades.length,
      lossTrades: lossTrades.length,
      breakevenTrades: breakevenTrades.length,
      winRate: closedTrades.length > 0 ? (winTrades.length / closedTrades.length) * 100 : 0,
      totalPnL,
      avgWin: winTrades.length > 0 ? totalWins / winTrades.length : 0,
      avgLoss: lossTrades.length > 0 ? totalLosses / lossTrades.length : 0,
      profitFactor: totalLosses !== 0 ? Math.abs(totalWins / totalLosses) : totalWins > 0 ? Infinity : 0,
    };
  };

  const exportTrades = () => {
    const csvContent = [
      ['Symbol', 'Side', 'Entry Time', 'Entry Price', 'Exit Price', 'Status', 'P&L', 'Position Size', 'Reason'].join(','),
      ...filteredTrades.map(trade => {
        const pnl = trade.exitPrice && trade.positionSize ?
          (trade.side === 'LONG' ? (trade.exitPrice - trade.entry) : (trade.entry - trade.exitPrice)) * trade.positionSize : 0;
        return [
          trade.symbol,
          trade.side,
          trade.time,
          trade.entry,
          trade.exitPrice || '',
          trade.status,
          pnl.toFixed(2),
          trade.positionSize || '',
          `"${trade.reason}"`
        ].join(',');
      })
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `trades-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const stats = calculateStats();

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0e1a] flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-400 mx-auto mb-4"></div>
          <p className="text-gray-300">Loading trades...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0e1a]">
      <Navigation />
      
      {/* Main Content with padding for nav */}
      <main className="pt-20 md:pt-24 pb-24 md:pb-8 px-4 md:px-6">
        <div className="max-w-[1800px] mx-auto">
          {/* Page Header */}
          <div className="mb-8">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
              <div>
                <h1 className="text-3xl md:text-4xl font-black gradient-text mb-2">Trade History</h1>
                <p className="text-slate-400">Track all your trading activity and performance</p>
              </div>
              <button
                onClick={exportTrades}
                className="px-6 py-3 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-xl font-semibold shadow-lg shadow-indigo-500/30 hover:shadow-indigo-500/50 transition-all duration-300"
              >
                📥 Export CSV
              </button>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3 md:gap-4">
              <StatCard label="Total" value={stats.totalTrades} />
              <StatCard label="Wins" value={stats.winTrades} variant="success" />
              <StatCard label="Losses" value={stats.lossTrades} variant="danger" />
              <StatCard label="Breakeven" value={stats.breakevenTrades} variant="warning" />
              <StatCard label="Win Rate" value={`${stats.winRate.toFixed(0)}%`} variant={stats.winRate >= 50 ? 'success' : 'danger'} />
              <StatCard label="Total P&L" value={`$${stats.totalPnL.toFixed(0)}`} variant={stats.totalPnL >= 0 ? 'success' : 'danger'} />
              <StatCard label="Avg Win" value={`$${stats.avgWin.toFixed(0)}`} variant="success" />
              <StatCard label="Avg Loss" value={`$${Math.abs(stats.avgLoss).toFixed(0)}`} variant="danger" />
            </div>
          </div>

          {/* Filters */}
          <div className="card p-4 md:p-6 mb-6">
            <button
              onClick={() => setShowFilters(!showFilters)}
              className="md:hidden w-full flex items-center justify-between mb-4 text-slate-300 font-semibold"
            >
              <span>🔍 Filters</span>
              <span>{showFilters ? '▲' : '▼'}</span>
            </button>

            <div className={`${showFilters ? 'block' : 'hidden md:block'} space-y-4 md:space-y-0`}>
              <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-slate-300 mb-2">Search</label>
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Symbol or reason..."
                    className="input w-full"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Status</label>
                  <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="select w-full">
                    <option value="all">All</option>
                    <option value="tp">Wins</option>
                    <option value="sl">Losses</option>
                    <option value="breakeven">Breakeven</option>
                    <option value="open">Open</option>
                    <option value="pending">Pending</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Side</label>
                  <select value={sideFilter} onChange={(e) => setSideFilter(e.target.value)} className="select w-full">
                    <option value="all">All</option>
                    <option value="LONG">Long</option>
                    <option value="SHORT">Short</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">From</label>
                  <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="input w-full" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">To</label>
                  <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="input w-full" />
                </div>
              </div>
              <button
                onClick={() => {
                  setSearchTerm('');
                  setStatusFilter('all');
                  setSideFilter('all');
                  setDateFrom('');
                  setDateTo('');
                }}
                className="mt-4 md:mt-0 w-full md:w-auto px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg transition-colors"
              >
                Clear Filters
              </button>
            </div>
          </div>

          {/* Trades Table */}
          <div className="card p-4 md:p-6 overflow-x-auto">
            {filteredTrades.length === 0 ? (
              <div className="text-center py-16">
                <div className="text-6xl mb-4">📊</div>
                <p className="text-slate-400 text-lg">No trades found</p>
                <p className="text-slate-500 text-sm mt-2">Try adjusting your filters</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[800px]">
                  <thead>
                    <tr className="border-b border-slate-700/50">
                      <th className="text-left py-3 px-4 text-sm font-semibold text-slate-300">Symbol</th>
                      <th className="text-left py-3 px-4 text-sm font-semibold text-slate-300">Time</th>
                      <th className="text-left py-3 px-4 text-sm font-semibold text-slate-300">Side</th>
                      <th className="text-right py-3 px-4 text-sm font-semibold text-slate-300">Entry</th>
                      <th className="text-right py-3 px-4 text-sm font-semibold text-slate-300">Exit</th>
                      <th className="text-center py-3 px-4 text-sm font-semibold text-slate-300">Status</th>
                      <th className="text-right py-3 px-4 text-sm font-semibold text-slate-300">P&L</th>
                      <th className="text-right py-3 px-4 text-sm font-semibold text-slate-300">Size</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredTrades.map((trade) => {
                      const pnl = trade.exitPrice && trade.positionSize ?
                        (trade.side === 'LONG' ? (trade.exitPrice - trade.entry) : (trade.entry - trade.exitPrice)) * trade.positionSize : null;

                      return (
                        <tr key={trade.id} className="border-b border-slate-700/30 hover:bg-slate-800/50 transition-colors">
                          <td className="py-3 px-4 text-sm font-medium text-white">{trade.symbol}</td>
                          <td className="py-3 px-4 text-sm text-slate-300 font-mono">
                            {new Date(trade.time).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </td>
                          <td className="py-3 px-4">
                            <span className={`inline-block px-2 py-1 rounded text-xs font-semibold ${
                              trade.side === 'LONG' ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30' : 'bg-red-500/20 text-red-400 border border-red-500/30'
                            }`}>
                              {trade.side}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-sm text-white text-right font-mono">${trade.entry.toFixed(2)}</td>
                          <td className="py-3 px-4 text-sm text-slate-300 text-right font-mono">
                            {trade.exitPrice ? `$${trade.exitPrice.toFixed(2)}` : '—'}
                          </td>
                          <td className="py-3 px-4 text-center">
                            <StatusBadge status={trade.status} />
                          </td>
                          <td className="py-3 px-4 text-right">
                            {pnl !== null ? (
                              <span className={`text-sm font-semibold font-mono ${pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                {pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}
                              </span>
                            ) : (
                              <span className="text-sm text-slate-500">—</span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-sm text-slate-300 text-right font-mono">
                            {trade.positionSize ? trade.positionSize.toFixed(4) : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

function StatCard({ label, value, variant }: { label: string; value: number | string; variant?: 'success' | 'danger' | 'warning' }) {
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

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    pending: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
    open: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
    tp: 'bg-green-500/20 text-green-300 border-green-500/30',
    sl: 'bg-red-500/20 text-red-300 border-red-500/30',
    breakeven: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
    cancelled: 'bg-gray-500/20 text-gray-300 border-gray-500/30',
  };

  const labels: Record<string, string> = {
    pending: 'Pending',
    open: 'Open',
    tp: 'Win',
    sl: 'Loss',
    breakeven: 'BE',
    cancelled: 'Cancelled',
  };

  return (
    <span className={`inline-block px-2 py-1 rounded text-xs font-semibold border ${styles[status] || styles.cancelled}`}>
      {labels[status] || status}
    </span>
  );
}
