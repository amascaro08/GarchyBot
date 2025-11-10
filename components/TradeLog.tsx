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
}

export default function TradeLog({ trades, sessionPnL }: TradeLogProps) {
  const formatPrice = (val: number) => val.toFixed(2);
  const formatTime = (timeStr: string) => {
    const date = new Date(timeStr);
    return date.toLocaleTimeString();
  };

  return (
    <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-semibold text-white">Trade Log</h3>
        <div className={`text-lg font-bold ${sessionPnL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
          P&L: {sessionPnL >= 0 ? '+' : ''}{sessionPnL.toFixed(2)}
        </div>
      </div>
      <div className="space-y-2 max-h-96 overflow-y-auto">
        {trades.length === 0 ? (
          <div className="text-gray-400 text-center py-8">No trades yet</div>
        ) : (
          trades.map((trade, idx) => (
            <div
              key={idx}
              className={`p-3 rounded border ${
                trade.side === 'LONG'
                  ? 'bg-blue-900/20 border-blue-700'
                  : 'bg-red-900/20 border-red-700'
              }`}
            >
              <div className="flex justify-between items-start mb-1">
                <span className={`font-semibold ${trade.side === 'LONG' ? 'text-blue-400' : 'text-red-400'}`}>
                  {trade.side}
                </span>
                <span className="text-gray-400 text-sm">{formatTime(trade.time)}</span>
              </div>
              <div className="text-sm text-gray-300 space-y-1">
                <div>Entry: {formatPrice(trade.entry)}</div>
                <div className="flex gap-4">
                  <span className="text-green-400">TP: {formatPrice(trade.tp)}</span>
                  <span className="text-red-400">SL: {formatPrice(trade.sl)}</span>
                </div>
                <div className="text-xs text-gray-400 mt-1">{trade.reason}</div>
                {trade.status && (
                  <div className={`text-xs font-semibold mt-1 ${
                    trade.status === 'tp' ? 'text-green-400' :
                    trade.status === 'sl' ? 'text-red-400' :
                    'text-yellow-400'
                  }`}>
                    Status: {trade.status.toUpperCase()}
                    {trade.exitPrice && ` @ ${formatPrice(trade.exitPrice)}`}
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
