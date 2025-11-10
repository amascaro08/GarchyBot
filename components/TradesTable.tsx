'use client';

import { Trade } from './TradeLog';

interface TradesTableProps {
  trades: Trade[];
  currentPrice: number | null;
}

export default function TradesTable({ trades, currentPrice }: TradesTableProps) {
  const formatPrice = (val: number) => val.toFixed(2);
  const formatTime = (timeStr: string) => {
    const date = new Date(timeStr);
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
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

  const calculateRealizedPnL = (trade: Trade): number | null => {
    if (trade.status === 'open' || !trade.exitPrice) return null;
    
    const positionSize = trade.positionSize || 0;
    if (trade.side === 'LONG') {
      return (trade.exitPrice - trade.entry) * positionSize;
    } else {
      return (trade.entry - trade.exitPrice) * positionSize;
    }
  };

  const getOutcome = (trade: Trade): string => {
    if (trade.status === 'open') return 'Active';
    if (trade.status === 'tp') return 'Win';
    if (trade.status === 'sl') return 'Loss';
    if (trade.status === 'breakeven') return 'Breakeven';
    return '—';
  };

  const getOutcomeColor = (outcome: string) => {
    switch (outcome) {
      case 'Win':
        return 'text-green-400';
      case 'Loss':
        return 'text-red-400';
      case 'Breakeven':
        return 'text-yellow-400';
      case 'Active':
        return 'text-blue-400';
      default:
        return 'text-gray-400';
    }
  };

  if (trades.length === 0) {
    return (
      <div className="glass-effect rounded-xl p-8 shadow-2xl border-slate-700/50 text-center">
        <p className="text-gray-400">No trades yet</p>
      </div>
    );
  }

  return (
    <div className="glass-effect rounded-xl p-4 sm:p-6 shadow-2xl border-slate-700/50 overflow-x-auto">
      <h3 className="text-xl font-bold text-white mb-4">Trades History</h3>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[800px]">
          <thead>
            <tr className="border-b border-slate-700/50">
              <th className="text-left py-3 px-4 text-sm font-semibold text-gray-300">Asset</th>
              <th className="text-left py-3 px-4 text-sm font-semibold text-gray-300">Time</th>
              <th className="text-left py-3 px-4 text-sm font-semibold text-gray-300">Side</th>
              <th className="text-right py-3 px-4 text-sm font-semibold text-gray-300">Entry</th>
              <th className="text-right py-3 px-4 text-sm font-semibold text-gray-300">Position Size</th>
              <th className="text-right py-3 px-4 text-sm font-semibold text-gray-300">TP Level</th>
              <th className="text-right py-3 px-4 text-sm font-semibold text-gray-300">SL Level</th>
              <th className="text-right py-3 px-4 text-sm font-semibold text-gray-300">Exit</th>
              <th className="text-center py-3 px-4 text-sm font-semibold text-gray-300">Outcome</th>
              <th className="text-right py-3 px-4 text-sm font-semibold text-gray-300">Realized P&L</th>
              <th className="text-right py-3 px-4 text-sm font-semibold text-gray-300">Unrealized P&L</th>
            </tr>
          </thead>
          <tbody>
            {trades.map((trade, idx) => {
              const unrealizedPnL = calculateUnrealizedPnL(trade);
              const realizedPnL = calculateRealizedPnL(trade);
              const outcome = getOutcome(trade);
              
              return (
                <tr
                  key={idx}
                  className={`border-b border-slate-700/30 hover:bg-slate-700/20 transition-colors ${
                    trade.status === 'open' ? 'bg-blue-500/5' : ''
                  }`}
                >
                  <td className="py-3 px-4 text-sm font-medium text-white">
                    {trade.symbol || '—'}
                  </td>
                  <td className="py-3 px-4 text-sm text-gray-300 font-mono">
                    {formatTime(trade.time)}
                  </td>
                  <td className="py-3 px-4">
                    <span
                      className={`inline-block px-2 py-1 rounded text-xs font-semibold ${
                        trade.side === 'LONG'
                          ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                          : 'bg-red-500/20 text-red-400 border border-red-500/30'
                      }`}
                    >
                      {trade.side}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-sm text-white text-right font-mono">
                    {formatPrice(trade.entry)}
                  </td>
                  <td className="py-3 px-4 text-sm text-gray-300 text-right font-mono">
                    {trade.positionSize ? `$${trade.positionSize.toFixed(2)}` : '—'}
                  </td>
                  <td className="py-3 px-4 text-sm text-green-400 text-right font-mono">
                    {formatPrice(trade.tp)}
                  </td>
                  <td className="py-3 px-4 text-sm text-red-400 text-right font-mono">
                    {formatPrice(trade.sl)}
                  </td>
                  <td className="py-3 px-4 text-sm text-gray-300 text-right font-mono">
                    {trade.exitPrice ? formatPrice(trade.exitPrice) : '—'}
                  </td>
                  <td className="py-3 px-4 text-center">
                    <span className={`text-sm font-semibold ${getOutcomeColor(outcome)}`}>
                      {outcome}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-right">
                    {realizedPnL !== null ? (
                      <span
                        className={`text-sm font-semibold font-mono ${
                          realizedPnL >= 0 ? 'text-green-400' : 'text-red-400'
                        }`}
                      >
                        {realizedPnL >= 0 ? '+' : ''}
                        {formatPrice(realizedPnL)}
                      </span>
                    ) : (
                      <span className="text-sm text-gray-500">—</span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-right">
                    {unrealizedPnL !== null ? (
                      <span
                        className={`text-sm font-semibold font-mono ${
                          unrealizedPnL >= 0 ? 'text-green-400' : 'text-red-400'
                        }`}
                      >
                        {unrealizedPnL >= 0 ? '+' : ''}
                        {formatPrice(unrealizedPnL)}
                      </span>
                    ) : (
                      <span className="text-sm text-gray-500">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
