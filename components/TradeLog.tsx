'use client';

import { formatCurrency } from '@/lib/format';

export interface Trade {
  time: string;
  side: 'LONG' | 'SHORT';
  entry: number;
  tp: number;
  sl: number;
  reason: string;
  status?: 'open' | 'tp' | 'sl' | 'breakeven';
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
    };
    return badges[status as keyof typeof badges] || badges.open;
  };

  const openTrades = trades.filter(t => t.status === 'open');
  const closedTrades = trades.filter(t => t.status !== 'open');
  const totalUnrealizedPnL = openTrades.reduce((sum, trade) => {
    const pnl = calculateUnrealizedPnL(trade);
    return sum + (pnl || 0);
  }, 0);

  return (
    <div className="glass-effect rounded-xl p-4 sm:p-6 shadow-2xl border-slate-700/50">
      <div className="flex justify-between items-center mb-6 pb-4 border-b border-slate-700/50">
        <div>
          <h3 className="text-xl font-bold text-white mb-1">Trade Summary</h3>
          <p className="text-xs text-gray-400">Trading statistics</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className={`text-xl sm:text-2xl font-bold px-4 py-2 rounded-lg ${
            sessionPnL >= 0 
              ? 'bg-green-500/20 text-green-400 border border-green-500/30' 
              : 'bg-red-500/20 text-red-400 border border-red-500/30'
          }`}>
            {sessionPnL >= 0 ? '+' : ''}{formatCurrency(sessionPnL).replace('$', '')}
          </div>
          {totalUnrealizedPnL !== 0 && (
            <div className={`text-sm font-semibold px-3 py-1 rounded ${
              totalUnrealizedPnL >= 0 
                ? 'bg-green-500/10 text-green-300 border border-green-500/20' 
                : 'bg-red-500/10 text-red-300 border border-red-500/20'
            }`}>
              Unrealized: {totalUnrealizedPnL >= 0 ? '+' : ''}{formatCurrency(totalUnrealizedPnL).replace('$', '')}
            </div>
          )}
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="glass-effect rounded-lg p-4 border border-blue-500/30 bg-blue-500/10">
          <div className="text-xs text-gray-400 mb-1">Unrealized P&L</div>
          <div className={`text-2xl font-bold ${
            totalUnrealizedPnL >= 0 ? 'text-green-400' : 'text-red-400'
          }`}>
            {totalUnrealizedPnL >= 0 ? '+' : ''}{formatCurrency(totalUnrealizedPnL).replace('$', '')}
          </div>
        </div>
        <div className="glass-effect rounded-lg p-4 border border-yellow-500/30 bg-yellow-500/10">
          <div className="text-xs text-gray-400 mb-1">Active Trades</div>
          <div className="text-2xl font-bold text-yellow-400">{openTrades.length}</div>
        </div>
        <div className="glass-effect rounded-lg p-4 border border-gray-500/30 bg-gray-500/10">
          <div className="text-xs text-gray-400 mb-1">Closed Trades</div>
          <div className="text-2xl font-bold text-gray-300">{closedTrades.length}</div>
        </div>
      </div>
    </div>
  );
}
