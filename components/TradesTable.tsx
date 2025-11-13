'use client';

import { Trade } from './TradeLog';
import type { Candle, LevelsResponse } from '@/lib/types';
import { formatCurrencyNoSymbol } from '@/lib/format';
import { useState } from 'react';
import TradeDetailsModal from './TradeDetailsModal';

interface TradesTableProps {
  trades: Trade[];
  currentPrice: number | null;
  onCloseTrade?: (trade: Trade) => void;
  candles: Candle[];
  symbol: string;
  interval: string;
  levels?: LevelsResponse | null;
}

export default function TradesTable({
  trades,
  currentPrice,
  onCloseTrade,
  candles,
  symbol,
  interval,
  levels,
}: TradesTableProps) {
  const [closingTradeId, setClosingTradeId] = useState<string | null>(null);
  const [selectedTrade, setSelectedTrade] = useState<Trade | null>(null);
  const [showDetailsModal, setShowDetailsModal] = useState(false);

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
    if (trade.status === 'pending') return 'Pending';
    if (trade.status === 'open') return 'Active';
    if (trade.status === 'tp') return 'Win';
    if (trade.status === 'sl') return 'Loss';
    if (trade.status === 'breakeven') return 'Breakeven';
    if (trade.status === 'cancelled') return 'Cancelled';
    return '—';
  };

  const getOutcomeColor = (outcome: string) => {
    switch (outcome) {
      case 'Pending':
        return 'text-purple-300';
      case 'Win':
        return 'text-green-400';
      case 'Loss':
        return 'text-red-400';
      case 'Breakeven':
      case 'Cancelled':
        return 'text-yellow-400';
      case 'Active':
        return 'text-blue-400';
      default:
        return 'text-gray-400';
    }
  };

  const handleCloseTrade = async (trade: Trade) => {
    if (!onCloseTrade) return;

    const confirmed = window.confirm(
      `Are you sure you want to manually close this ${trade.side} trade at ${currentPrice?.toFixed(2) || 'current price'}?`
    );

    if (confirmed) {
      setClosingTradeId(trade.id);
      try {
        await onCloseTrade(trade);
      } finally {
        setClosingTradeId(null);
      }
    }
  };

  const handleTradeClick = (trade: Trade) => {
    setSelectedTrade(trade);
    setShowDetailsModal(true);
  };

  if (trades.length === 0) {
    return (
      <div className="glass-effect rounded-xl p-8 shadow-2xl border-slate-700/50 text-center">
        <p className="text-gray-400">No trades yet</p>
      </div>
    );
  }

  const statusPriority = (status: Trade['status']) => {
    if (status === 'open') return 0;
    if (status === 'pending') return 1;
    return 2;
  };

  const sortedTrades = [...trades].sort((a, b) => {
    const priorityDiff = statusPriority(a.status) - statusPriority(b.status);
    if (priorityDiff !== 0) return priorityDiff;
    return new Date(b.time).getTime() - new Date(a.time).getTime();
  });

  return (
    <div className="glass-effect rounded-xl p-4 sm:p-6 shadow-2xl border-slate-700/50 overflow-x-auto">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xl font-bold text-white">Trades History</h3>
      </div>
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
              <th className="text-center py-3 px-4 text-sm font-semibold text-gray-300">Actions</th>
            </tr>
          </thead>
          <tbody>
            {sortedTrades.map((trade) => {
              const unrealizedPnL = calculateUnrealizedPnL(trade);
              const realizedPnL = calculateRealizedPnL(trade);
              const outcome = getOutcome(trade);
              
              return (
                <tr
                  key={trade.id}
                  className={`border-b border-slate-700/30 hover:bg-slate-700/20 transition-colors ${
                    trade.status === 'open'
                      ? 'bg-blue-500/5'
                      : trade.status === 'pending'
                        ? 'bg-purple-500/5'
                        : ''
                  }`}
                >
                  <td className="py-3 px-4 text-sm font-medium text-white">
                    <button
                      onClick={() => handleTradeClick(trade)}
                      className="hover:text-cyan-400 transition-colors underline decoration-transparent hover:decoration-current"
                    >
                      {trade.symbol || '—'}
                    </button>
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
                    {formatCurrencyNoSymbol(trade.entry)}
                  </td>
                  <td className="py-3 px-4 text-sm text-gray-300 text-right font-mono">
                    {trade.positionSize ? formatCurrencyNoSymbol(trade.positionSize) : '—'}
                  </td>
                  <td className="py-3 px-4 text-sm text-green-400 text-right font-mono">
                    {formatCurrencyNoSymbol(trade.tp)}
                  </td>
                  <td className="py-3 px-4 text-sm text-red-400 text-right font-mono">
                    {formatCurrencyNoSymbol(trade.sl)}
                  </td>
                  <td className="py-3 px-4 text-sm text-gray-300 text-right font-mono">
                    {trade.exitPrice ? formatCurrencyNoSymbol(trade.exitPrice) : '—'}
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
                        {formatCurrencyNoSymbol(realizedPnL)}
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
                        {formatCurrencyNoSymbol(unrealizedPnL)}
                      </span>
                    ) : (
                      <span className="text-sm text-gray-500">—</span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-center">
                    {trade.status === 'open' && (
                      <button
                        onClick={() => handleCloseTrade(trade)}
                        disabled={closingTradeId === trade.id}
                        className="px-2 py-1 text-xs bg-red-500/20 text-red-400 border border-red-500/30 rounded hover:bg-red-500/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        {closingTradeId === trade.id ? 'Closing...' : 'Close'}
                      </button>
                    )}
                    {trade.status === 'pending' && (
                      <button
                        onClick={() => handleCloseTrade(trade)}
                        disabled={closingTradeId === trade.id}
                        className="px-2 py-1 text-xs bg-purple-500/20 text-purple-300 border border-purple-500/30 rounded hover:bg-purple-500/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        {closingTradeId === trade.id ? 'Cancelling...' : 'Cancel'}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Trade Details Modal */}
      <TradeDetailsModal
        trade={selectedTrade}
        isOpen={showDetailsModal}
        onClose={() => {
          setShowDetailsModal(false);
          setSelectedTrade(null);
        }}
        currentPrice={currentPrice}
        candles={candles}
        symbol={symbol}
        interval={interval}
        levels={levels}
      />
    </div>
  );
}
