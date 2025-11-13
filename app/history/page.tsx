'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
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

export default function HistoryPage() {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [filteredTrades, setFilteredTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [sideFilter, setSideFilter] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

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
          }));
          setTrades(formattedTrades);
        } else {
          console.warn('No trades data found in response:', data);
          setTrades([]);
        }
      } else {
        console.error('Failed to fetch trade history, status:', res.status);
        setTrades([]);
      }
    } catch (error) {
      console.error('Failed to load trade history:', error);
      setTrades([]);
    } finally {
      setLoading(false);
    }
  };

  const filterTrades = () => {
    let filtered = trades;

    // Search term filter
    if (searchTerm) {
      filtered = filtered.filter(trade =>
        (trade.symbol || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (trade.reason || '').toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    // Status filter
    if (statusFilter !== 'all') {
      filtered = filtered.filter(trade => trade.status === statusFilter);
    }

    // Side filter
    if (sideFilter !== 'all') {
      filtered = filtered.filter(trade => trade.side === sideFilter);
    }

    // Date range filter
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
    const closedTrades = filteredTrades.filter(t => t.status !== 'open');
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
    a.download = `trade-history-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const stats = calculateStats();

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cyan-400 mx-auto mb-4"></div>
          <p className="text-gray-300">Loading trade history...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 text-white p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-4">
              <Link href="/" className="text-cyan-400 hover:text-cyan-300 transition-colors">
                ← Back to Dashboard
              </Link>
              <h1 className="text-3xl font-bold">Trade History</h1>
            </div>
            <button
              onClick={exportTrades}
              className="px-4 py-2 bg-cyan-600 hover:bg-cyan-700 text-white rounded-lg transition-colors"
            >
              Export CSV
            </button>
          </div>

          {/* Stats Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-4 mb-6">
            <div className="glass-effect rounded-xl p-4 text-center">
              <div className="text-2xl font-bold text-cyan-400">{stats.totalTrades}</div>
              <div className="text-sm text-gray-300">Total Trades</div>
            </div>
            <div className="glass-effect rounded-xl p-4 text-center">
              <div className="text-2xl font-bold text-green-400">{stats.winTrades}</div>
              <div className="text-sm text-gray-300">Wins</div>
            </div>
            <div className="glass-effect rounded-xl p-4 text-center">
              <div className="text-2xl font-bold text-red-400">{stats.lossTrades}</div>
              <div className="text-sm text-gray-300">Losses</div>
            </div>
            <div className="glass-effect rounded-xl p-4 text-center">
              <div className="text-2xl font-bold text-yellow-400">{stats.breakevenTrades}</div>
              <div className="text-sm text-gray-300">Breakeven</div>
            </div>
            <div className="glass-effect rounded-xl p-4 text-center">
              <div className="text-2xl font-bold text-blue-400">{stats.winRate.toFixed(1)}%</div>
              <div className="text-sm text-gray-300">Win Rate</div>
            </div>
            <div className={`glass-effect rounded-xl p-4 text-center ${stats.totalPnL >= 0 ? 'border-green-500/30' : 'border-red-500/30'}`}>
              <div className={`text-2xl font-bold ${stats.totalPnL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {stats.totalPnL >= 0 ? '+' : ''}{formatCurrencyNoSymbol(stats.totalPnL)}
              </div>
              <div className="text-sm text-gray-300">Total P&L</div>
            </div>
            <div className="glass-effect rounded-xl p-4 text-center">
              <div className="text-2xl font-bold text-green-400">{formatCurrencyNoSymbol(stats.avgWin)}</div>
              <div className="text-sm text-gray-300">Avg Win</div>
            </div>
            <div className="glass-effect rounded-xl p-4 text-center">
              <div className="text-2xl font-bold text-red-400">{formatCurrencyNoSymbol(Math.abs(stats.avgLoss))}</div>
              <div className="text-sm text-gray-300">Avg Loss</div>
            </div>
          </div>

          {/* Filters */}
          <div className="glass-effect rounded-xl p-6 mb-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Search</label>
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Symbol or reason..."
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white placeholder-gray-400 focus:border-cyan-400 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Status</label>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white focus:border-cyan-400 focus:outline-none"
                >
                  <option value="all">All Status</option>
                  <option value="tp">Win</option>
                  <option value="sl">Loss</option>
                  <option value="breakeven">Breakeven</option>
                  <option value="open">Open</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Side</label>
                <select
                  value={sideFilter}
                  onChange={(e) => setSideFilter(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white focus:border-cyan-400 focus:outline-none"
                >
                  <option value="all">All Sides</option>
                  <option value="LONG">Long</option>
                  <option value="SHORT">Short</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">From Date</label>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white focus:border-cyan-400 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">To Date</label>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white focus:border-cyan-400 focus:outline-none"
                />
              </div>
              <div className="flex items-end">
                <button
                  onClick={() => {
                    setSearchTerm('');
                    setStatusFilter('all');
                    setSideFilter('all');
                    setDateFrom('');
                    setDateTo('');
                  }}
                  className="w-full px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors"
                >
                  Clear Filters
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Trades Table */}
        <div className="glass-effect rounded-xl p-6 overflow-x-auto">
          {filteredTrades.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-gray-400">No trades found matching your filters</p>
            </div>
          ) : (
            <table className="w-full min-w-[1000px]">
              <thead>
                <tr className="border-b border-slate-700/50">
                  <th className="text-left py-3 px-4 text-sm font-semibold text-gray-300">Symbol</th>
                  <th className="text-left py-3 px-4 text-sm font-semibold text-gray-300">Time</th>
                  <th className="text-left py-3 px-4 text-sm font-semibold text-gray-300">Side</th>
                  <th className="text-right py-3 px-4 text-sm font-semibold text-gray-300">Entry</th>
                  <th className="text-right py-3 px-4 text-sm font-semibold text-gray-300">Exit</th>
                  <th className="text-center py-3 px-4 text-sm font-semibold text-gray-300">Status</th>
                  <th className="text-right py-3 px-4 text-sm font-semibold text-gray-300">P&L</th>
                  <th className="text-right py-3 px-4 text-sm font-semibold text-gray-300">Position Size</th>
                  <th className="text-left py-3 px-4 text-sm font-semibold text-gray-300">Reason</th>
                </tr>
              </thead>
              <tbody>
                {filteredTrades.map((trade, idx) => {
                  const pnl = trade.exitPrice && trade.positionSize ?
                    (trade.side === 'LONG' ? (trade.exitPrice - trade.entry) : (trade.entry - trade.exitPrice)) * trade.positionSize : null;

                  const getStatusColor = (status: string | undefined) => {
                    switch (status) {
                      case 'tp': return 'text-green-400';
                      case 'sl': return 'text-red-400';
                      case 'breakeven': return 'text-yellow-400';
                      case 'open': return 'text-blue-400';
                      default: return 'text-gray-400';
                    }
                  };

                  const getStatusText = (status: string | undefined) => {
                    switch (status) {
                      case 'tp': return 'Win';
                      case 'sl': return 'Loss';
                      case 'breakeven': return 'Breakeven';
                      case 'open': return 'Open';
                      default: return status || 'Unknown';
                    }
                  };

                  return (
                    <tr key={idx} className="border-b border-slate-700/30 hover:bg-slate-700/20 transition-colors">
                      <td className="py-3 px-4 text-sm font-medium text-white">{trade.symbol}</td>
                      <td className="py-3 px-4 text-sm text-gray-300 font-mono">
                        {new Date(trade.time).toLocaleString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                        })}
                      </td>
                      <td className="py-3 px-4">
                        <span className={`inline-block px-2 py-1 rounded text-xs font-semibold ${
                          trade.side === 'LONG'
                            ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                            : 'bg-red-500/20 text-red-400 border border-red-500/30'
                        }`}>
                          {trade.side}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-sm text-white text-right font-mono">
                        {formatCurrencyNoSymbol(trade.entry)}
                      </td>
                      <td className="py-3 px-4 text-sm text-gray-300 text-right font-mono">
                        {trade.exitPrice ? formatCurrencyNoSymbol(trade.exitPrice) : '—'}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span className={`text-sm font-semibold ${getStatusColor(trade.status)}`}>
                          {getStatusText(trade.status)}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        {pnl !== null ? (
                          <span className={`text-sm font-semibold font-mono ${pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {pnl >= 0 ? '+' : ''}{formatCurrencyNoSymbol(pnl)}
                          </span>
                        ) : (
                          <span className="text-sm text-gray-500">—</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-sm text-gray-300 text-right font-mono">
                        {trade.positionSize ? formatCurrencyNoSymbol(trade.positionSize) : '—'}
                      </td>
                      <td className="py-3 px-4 text-sm text-gray-300 max-w-xs truncate" title={trade.reason}>
                        {trade.reason || '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}