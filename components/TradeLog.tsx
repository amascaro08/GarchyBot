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
  status: 'pending' | 'open' | 'tp' | 'sl' | 'breakeven' | 'cancelled';
  exitPrice?: number;
  symbol?: string;
  leverage?: number;
  positionSize?: number;
}

interface WalletSummary {
  coin: string;
  equity: number;
  availableToWithdraw: number;
}

interface TradeLogProps {
  trades: Trade[];
  sessionPnL: number;
  currentPrice: number | null;
  walletInfo?: WalletSummary[] | null;
}

export default function TradeLog({ trades, sessionPnL, currentPrice, walletInfo }: TradeLogProps) {
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

  const getStatusBadge = (status: Trade['status']) => {
    const badges: Record<Trade['status'], string> = {
      pending: 'bg-purple-500/20 text-purple-300 border border-purple-500/30',
      open: 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30',
      tp: 'bg-green-500/20 text-green-400 border border-green-500/30',
      sl: 'bg-red-500/20 text-red-400 border border-red-500/30',
      breakeven: 'bg-gray-500/20 text-gray-400 border border-gray-500/30',
      cancelled: 'bg-gray-500/20 text-gray-400 border border-gray-500/30',
    };
    return badges[status];
  };

  const pendingTrades = trades.filter((t) => t.status === 'pending');
  const openTrades = trades.filter((t) => t.status === 'open');
  const closedTrades = trades.filter((t) => ['tp', 'sl', 'breakeven', 'cancelled'].includes(t.status));
  const totalUnrealizedPnL = openTrades.reduce((sum, trade) => {
    const pnl = calculateUnrealizedPnL(trade);
    return sum + (pnl || 0);
  }, 0);

  const eligibleClosedTrades = closedTrades.filter((t) => t.status !== 'breakeven' && t.status !== 'cancelled');
  const winRate = eligibleClosedTrades.length > 0
    ? (eligibleClosedTrades.filter(t => t.status === 'tp').length / eligibleClosedTrades.length) * 100
    : 0;

  const totalEquity = walletInfo?.reduce((sum, wallet) => sum + (wallet.equity || 0), 0) ?? 0;
  const totalAvailable = walletInfo?.reduce((sum, wallet) => sum + (wallet.availableToWithdraw || 0), 0) ?? 0;

  return (
    <div className="glass-effect rounded-xl p-5 sm:p-6 shadow-2xl border border-slate-700/50 bg-slate-900/70 backdrop-blur-xl space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-700/40 pb-4">
        <div>
          <h3 className="text-xl font-bold text-white mb-1">Trading Performance</h3>
          <p className="text-xs text-gray-400">Real-time portfolio overview</p>
        </div>
        <div className="text-right">
          <div className={`inline-flex items-center gap-2 text-base sm:text-lg font-bold px-4 py-2 rounded-lg border ${
            sessionPnL >= 0
              ? 'bg-green-500/10 border-green-500/40 text-green-300'
              : 'bg-red-500/10 border-red-500/40 text-red-300'
          }`}>
            <span>{sessionPnL >= 0 ? '+' : ''}{formatCurrency(sessionPnL)}</span>
          </div>
          <div className="text-xs text-gray-400 mt-1">Session P&L</div>
        </div>
      </div>

      {walletInfo && walletInfo.length > 0 && (
        <div className="glass-effect rounded-lg border border-cyan-500/30 bg-cyan-500/5 p-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <div className="text-xs font-semibold text-cyan-200 uppercase tracking-wider">Wallet Balances</div>
              <div className="text-sm text-cyan-100">{walletInfo.length} asset{walletInfo.length === 1 ? '' : 's'}</div>
            </div>
            <div className="flex flex-col sm:flex-row sm:items-center sm:gap-6 text-sm text-cyan-100">
              <div>
                <span className="text-xs uppercase tracking-wider text-cyan-300 block">Total Equity</span>
                <span className="font-semibold">{formatCurrency(totalEquity)}</span>
              </div>
              <div>
                <span className="text-xs uppercase tracking-wider text-cyan-300 block">Available</span>
                <span className="font-semibold">{formatCurrency(totalAvailable)}</span>
              </div>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm text-cyan-100">
            {walletInfo.map((wallet) => (
              <div key={wallet.coin} className="flex items-center justify-between bg-slate-900/40 rounded-lg px-3 py-2">
                <span className="font-semibold">{wallet.coin}</span>
                <span className="font-mono text-xs sm:text-sm">
                  {wallet.equity.toFixed(4)} <span className="text-cyan-300">(Avail {wallet.availableToWithdraw.toFixed(4)})</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <StatTile label="Unrealized P&L" value={formatCurrency(totalUnrealizedPnL)} tone={totalUnrealizedPnL >= 0 ? 'positive' : 'negative'} />
        <StatTile label="Active Positions" value={openTrades.length} />
        <StatTile label="Pending Orders" value={pendingTrades.length} />
        <StatTile label="Closed Trades" value={closedTrades.length} />
        <StatTile label="Win Rate" value={`${winRate.toFixed(0)}%`} tone={winRate >= 50 ? 'positive' : undefined} />
        <StatTile label="Trades Today" value={trades.filter(t => t.status !== 'open' && t.status !== 'pending').length} />
      </div>

      <div className="space-y-3">
        {trades.length === 0 && (
          <div className="text-center text-gray-400 text-sm py-4">No trades yet today.</div>
        )}
        {trades.slice(0, 5).map((trade) => {
          const unrealizedPnL = calculateUnrealizedPnL(trade);
          const formattedPnL = unrealizedPnL !== null ? `${unrealizedPnL >= 0 ? '+' : ''}${formatCurrency(unrealizedPnL)}` : '—';

          return (
            <div key={trade.id} className="glass-effect rounded-lg border border-slate-700/40 bg-slate-900/40 p-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-2">
                <div className="flex items-center gap-3">
                  <span className={`px-2 py-1 rounded text-xs font-semibold ${getStatusBadge(trade.status)}`}>{trade.status.toUpperCase()}</span>
                  <span className="text-white font-semibold">{trade.symbol}</span>
                  <span className="text-gray-400 font-mono text-xs">{formatTime(trade.time)}</span>
                </div>
                <div className="text-sm text-gray-300">
                  {trade.side === 'LONG' ? 'Long' : 'Short'} @ <span className="font-semibold text-white">{formatCurrency(trade.entry)}</span>
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs text-gray-300">
                <div>
                  <div className="uppercase tracking-wider text-gray-500">TP</div>
                  <div className="text-green-400 font-semibold">{formatCurrency(trade.tp)}</div>
                </div>
                <div>
                  <div className="uppercase tracking-wider text-gray-500">SL</div>
                  <div className="text-red-400 font-semibold">{formatCurrency(trade.sl)}</div>
                </div>
                <div>
                  <div className="uppercase tracking-wider text-gray-500">Size</div>
                  <div className="font-semibold text-white">{trade.positionSize ? formatCurrency(trade.positionSize) : '—'}</div>
                </div>
                <div>
                  <div className="uppercase tracking-wider text-gray-500">Unrealized</div>
                  <div className={`font-semibold ${unrealizedPnL !== null ? (unrealizedPnL >= 0 ? 'text-green-400' : 'text-red-400') : 'text-gray-400'}`}>{formattedPnL}</div>
                </div>
              </div>
              {trade.reason && (
                <div className="mt-3 text-xs text-gray-400">{trade.reason}</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface StatTileProps {
  label: string;
  value: number | string;
  tone?: 'positive' | 'negative';
}

function StatTile({ label, value, tone }: StatTileProps) {
  const base = 'glass-effect rounded-lg px-4 py-3 border backdrop-blur-xl flex flex-col gap-1';
  const toneClass = tone === 'positive'
    ? 'border-green-500/30 bg-green-500/5 text-green-300'
    : tone === 'negative'
      ? 'border-red-500/30 bg-red-500/5 text-red-300'
      : 'border-slate-700/40 bg-slate-900/40 text-gray-200';

  return (
    <div className={`${base} ${toneClass}`}>
      <div className="text-xs uppercase tracking-wider text-gray-400">{label}</div>
      <div className="text-xl font-semibold">
        {typeof value === 'number' && !Number.isNaN(value) ? value : value}
      </div>
    </div>
  );
}
