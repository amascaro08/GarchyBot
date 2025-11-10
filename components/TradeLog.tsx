'use client';

export interface Trade {
  time: string;
  side: 'LONG' | 'SHORT';
  entry: number;
  tp: number;
  sl: number;
  reason: string;
  status?: 'open' | 'tp' | 'sl' | 'breakeven';
  exitPrice?: number;
}

interface TradeLogProps {
  trades: Trade[];
  sessionPnL: number;
  currentPrice: number | null;
}

export default function TradeLog({ trades, sessionPnL, currentPrice }: TradeLogProps) {
  const formatPrice = (val: number) => val.toFixed(2);
  const formatTime = (timeStr: string) => {
    const date = new Date(timeStr);
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  const calculateUnrealizedPnL = (trade: Trade): number | null => {
    if (trade.status !== 'open' || currentPrice === null) return null;
    
    if (trade.side === 'LONG') {
      return currentPrice - trade.entry;
    } else {
      return trade.entry - currentPrice;
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
  const totalUnrealizedPnL = openTrades.reduce((sum, trade) => {
    const pnl = calculateUnrealizedPnL(trade);
    return sum + (pnl || 0);
  }, 0);

  return (
    <div className="glass-effect rounded-xl p-4 sm:p-6 shadow-2xl border-slate-700/50">
      <div className="flex justify-between items-center mb-6 pb-4 border-b border-slate-700/50">
        <div>
          <h3 className="text-xl font-bold text-white mb-1">Trade Log</h3>
          <p className="text-xs text-gray-400">Active trading signals</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className={`text-xl sm:text-2xl font-bold px-4 py-2 rounded-lg ${
            sessionPnL >= 0 
              ? 'bg-green-500/20 text-green-400 border border-green-500/30' 
              : 'bg-red-500/20 text-red-400 border border-red-500/30'
          }`}>
            {sessionPnL >= 0 ? '+' : ''}{sessionPnL.toFixed(2)}
          </div>
          {totalUnrealizedPnL !== 0 && (
            <div className={`text-sm font-semibold px-3 py-1 rounded ${
              totalUnrealizedPnL >= 0 
                ? 'bg-green-500/10 text-green-300 border border-green-500/20' 
                : 'bg-red-500/10 text-red-300 border border-red-500/20'
            }`}>
              Unrealized: {totalUnrealizedPnL >= 0 ? '+' : ''}{totalUnrealizedPnL.toFixed(2)}
            </div>
          )}
        </div>
      </div>
      <div className="space-y-3 max-h-96 overflow-y-auto custom-scrollbar">
        {trades.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-gray-400 mb-2">
              <svg className="w-12 h-12 mx-auto opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <p className="text-gray-400 font-medium">No trades yet</p>
            <p className="text-gray-500 text-sm mt-1">Waiting for trading signals...</p>
          </div>
        ) : (
          trades.map((trade, idx) => {
            const unrealizedPnL = calculateUnrealizedPnL(trade);
            return (
              <div
                key={idx}
                className={`glass-effect rounded-lg p-4 border transition-all duration-200 card-hover ${
                  trade.side === 'LONG'
                    ? 'bg-blue-500/10 border-blue-500/30'
                    : 'bg-red-500/10 border-red-500/30'
                }`}
              >
                <div className="flex justify-between items-start mb-3">
                  <div className="flex items-center gap-2">
                    <span className={`font-bold text-sm px-2.5 py-1 rounded ${
                      trade.side === 'LONG'
                        ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                        : 'bg-red-500/20 text-red-400 border border-red-500/30'
                    }`}>
                      {trade.side}
                    </span>
                    {trade.status && (
                      <span className={`text-xs font-semibold px-2 py-1 rounded border ${getStatusBadge(trade.status)}`}>
                        {trade.status.toUpperCase()}
                      </span>
                    )}
                  </div>
                  <span className="text-gray-400 text-xs font-mono">{formatTime(trade.time)}</span>
                </div>
                <div className="grid grid-cols-2 gap-3 mb-2">
                  <div>
                    <div className="text-xs text-gray-400 mb-1">Entry</div>
                    <div className="text-sm font-semibold text-white">{formatPrice(trade.entry)}</div>
                  </div>
                  {trade.exitPrice ? (
                    <div>
                      <div className="text-xs text-gray-400 mb-1">Exit</div>
                      <div className="text-sm font-semibold text-white">{formatPrice(trade.exitPrice)}</div>
                    </div>
                  ) : unrealizedPnL !== null ? (
                    <div>
                      <div className="text-xs text-gray-400 mb-1">Unrealized P&L</div>
                      <div className={`text-sm font-semibold ${
                        unrealizedPnL >= 0 ? 'text-green-400' : 'text-red-400'
                      }`}>
                        {unrealizedPnL >= 0 ? '+' : ''}{formatPrice(unrealizedPnL)}
                      </div>
                    </div>
                  ) : null}
                </div>
                <div className="flex gap-4 mb-2">
                  <div className="flex-1">
                    <div className="text-xs text-gray-400 mb-1">Take Profit</div>
                    <div className="text-sm font-semibold text-green-400">{formatPrice(trade.tp)}</div>
                  </div>
                  <div className="flex-1">
                    <div className="text-xs text-gray-400 mb-1">Stop Loss</div>
                    <div className="text-sm font-semibold text-red-400">{formatPrice(trade.sl)}</div>
                  </div>
                </div>
                <div className="mt-3 pt-3 border-t border-slate-700/30">
                  <div className="text-xs text-gray-400 italic">{trade.reason}</div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
