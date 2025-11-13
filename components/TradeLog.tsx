'use client';

import { formatCurrency } from '@/lib/format';

export interface Trade {
  id: string;
  time: string;
  side: 'LONG' | 'SHORT';
  entry: number;
  tp: number;
  sl: number;
  initialSl: number;
  reason: string;
  status?: 'open' | 'tp' | 'sl' | 'breakeven' | 'cancelled';
  exitPrice?: number;
  symbol?: string;
  leverage?: number;
  positionSize?: number;
}

interface TradeLogProps {
  trades: Trade[];
  sessionPnL: number;
  currentPrice: number | null;
}

export default function TradeLog({ trades, sessionPnL, currentPrice }: TradeLogProps) {
  const formatTime = (timeStr: string) => {
    const date = new Date(timeStr);
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  const calculateUnrealizedPnL = (trade: Trade): number | null => {
    if (trade.status !== 'open' || currentPrice === null) return null;
    
    const positionSize = trade.positionSize || 0;
    if (trade.side === 'LONG') {
      return (currentPrice - trade.entry) * positionSize;
    } else {
      return (trade.entry - currentPrice) * positionSize;
    }
  };

  const getStatusBadge = (status: string) => {
    const badges = {
      open: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
      tp: 'bg-green-500/20 text-green-400 border-green-500/30',
      sl: 'bg-red-500/20 text-red-400 border-red-500/30',
      breakeven: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
      cancelled: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
    };
    return badges[status as keyof typeof badges] || badges.open;
  };

  const openTrades = trades.filter(t => t.status === 'open');
  const closedTrades = trades.filter(t => t.status !== 'open');
  const totalUnrealizedPnL = openTrades.reduce((sum, trade) => {
    const pnl = calculateUnrealizedPnL(trade);
    return sum + (pnl || 0);
  }, 0);

  // Calculate win rate
  const winRate = closedTrades.length > 0
    ? (closedTrades.filter(t => (t.status === 'tp' && t.side === 'LONG') || (t.status === 'sl' && t.side === 'SHORT') ||
                               (t.status === 'tp' && t.side === 'SHORT') || (t.status === 'sl' && t.side === 'LONG')).length / closedTrades.length) * 100
    : 0;

  return (
    <div className="glass-effect rounded-xl p-4 sm:p-6 shadow-2xl border-slate-700/50">
      <div className="flex justify-between items-center mb-6 pb-4 border-b border-slate-700/50">
        <div>
          <h3 className="text-xl font-bold text-white mb-1">Trading Performance</h3>
          <p className="text-xs text-gray-400">Real-time portfolio overview</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className={`text-2xl sm:text-3xl font-bold px-6 py-3 rounded-xl ${
            sessionPnL >= 0
              ? 'bg-gradient-to-r from-green-500/20 to-emerald-500/20 text-green-400 border border-green-500/30'
              : 'bg-gradient-to-r from-red-500/20 to-rose-500/20 text-red-400 border border-red-500/30'
          }`}>
            {sessionPnL >= 0 ? '+' : ''}{formatCurrency(sessionPnL).replace('$', '')}
          </div>
          <div className="text-xs text-gray-400">
            Session P&L
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="glass-effect rounded-lg p-4 border border-blue-500/30 bg-blue-500/10 hover:bg-blue-500/15 transition-all duration-300">
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs text-gray-400 font-medium">Unrealized P&L</div>
            <div className={`w-2 h-2 rounded-full ${totalUnrealizedPnL >= 0 ? 'bg-green-400' : 'bg-red-400'}`}></div>
          </div>
          <div className={`text-xl font-bold ${
            totalUnrealizedPnL >= 0 ? 'text-green-400' : 'text-red-400'
          }`}>
            {totalUnrealizedPnL >= 0 ? '+' : ''}{formatCurrency(totalUnrealizedPnL).replace('$', '')}
          </div>
        </div>

        <div className="glass-effect rounded-lg p-4 border border-yellow-500/30 bg-yellow-500/10 hover:bg-yellow-500/15 transition-all duration-300">
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs text-gray-400 font-medium">Active Positions</div>
            <div className="w-2 h-2 rounded-full bg-yellow-400"></div>
          </div>
          <div className="text-xl font-bold text-yellow-400">{openTrades.length}</div>
        </div>

        <div className="glass-effect rounded-lg p-4 border border-gray-500/30 bg-gray-500/10 hover:bg-gray-500/15 transition-all duration-300">
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs text-gray-400 font-medium">Total Trades</div>
            <div className="w-2 h-2 rounded-full bg-gray-400"></div>
          </div>
          <div className="text-xl font-bold text-gray-300">{closedTrades.length}</div>
        </div>

        <div className="glass-effect rounded-lg p-4 border border-purple-500/30 bg-purple-500/10 hover:bg-purple-500/15 transition-all duration-300">
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs text-gray-400 font-medium">Win Rate</div>
            <div className={`w-2 h-2 rounded-full ${winRate >= 50 ? 'bg-green-400' : 'bg-red-400'}`}></div>
          </div>
          <div className={`text-xl font-bold ${winRate >= 50 ? 'text-green-400' : 'text-red-400'}`}>
            {winRate.toFixed(0)}%
          </div>
        </div>
      </div>

      {/* Performance indicators */}
      <div className="space-y-3">
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-400">Avg Trade Size</span>
          <span className="text-white font-medium">
            {closedTrades.length > 0
              ? formatCurrency(closedTrades.reduce((sum, t) => sum + (t.positionSize || 0), 0) / closedTrades.length)
              : '$0'
            }
          </span>
        </div>

        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-400">Max Drawdown</span>
          <span className="text-red-400 font-medium">
            {/* Calculate max drawdown from closed trades */}
            {(() => {
              if (closedTrades.length === 0) return '$0';

              let maxDrawdown = 0;
              let peak = 0;
              let cumulative = 0;

              for (const trade of closedTrades) {
                const pnl = (trade.status === 'tp' && trade.side === 'LONG') ||
                           (trade.status === 'sl' && trade.side === 'SHORT') ||
                           (trade.status === 'tp' && trade.side === 'SHORT') ||
                           (trade.status === 'sl' && trade.side === 'LONG')
                           ? (trade.positionSize || 0)
                           : -(trade.positionSize || 0);

                cumulative += pnl;
                if (cumulative > peak) {
                  peak = cumulative;
                } else if (peak - cumulative > maxDrawdown) {
                  maxDrawdown = peak - cumulative;
                }
              }

              return formatCurrency(maxDrawdown).replace('$', '');
            })()}
          </span>
        </div>

        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-400">Trades Today</span>
          <span className="text-cyan-400 font-medium">
            {trades.filter(t => t.status !== 'open').length}
          </span>
        </div>
      </div>
    </div>
  );
}
