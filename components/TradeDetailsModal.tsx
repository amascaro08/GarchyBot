'use client';

import { Trade } from './TradeLog';
import { formatCurrencyNoSymbol } from '@/lib/format';
import type { Candle, LevelsResponse } from '@/lib/types';
import dynamic from 'next/dynamic';

const Chart = dynamic(() => import('./Chart'), { ssr: false });

interface TradeDetailsModalProps {
  trade: Trade | null;
  isOpen: boolean;
  onClose: () => void;
  currentPrice?: number | null;
  candles: Candle[];
  symbol: string;
  interval: string;
  levels?: LevelsResponse | null;
}

export default function TradeDetailsModal({
  trade,
  isOpen,
  onClose,
  currentPrice,
  candles,
  symbol,
  interval,
  levels,
}: TradeDetailsModalProps) {
  if (!isOpen || !trade) return null;

  const statusColorMap: Record<Trade['status'], string> = {
    pending: 'text-purple-300',
    open: 'text-blue-400',
    tp: 'text-green-400',
    sl: 'text-red-400',
    breakeven: 'text-yellow-400',
    cancelled: 'text-gray-400',
  };

  const statusLabelMap: Record<Trade['status'], string> = {
    pending: 'Limit Pending',
    open: 'Active',
    tp: 'Take Profit',
    sl: 'Stop Loss',
    breakeven: 'Breakeven',
    cancelled: 'Cancelled',
  };

  const calculatePnL = () => {
    if (trade.status === 'open') {
      if (!currentPrice) return null;
      return trade.side === 'LONG'
        ? (currentPrice - trade.entry) * (trade.positionSize || 0)
        : (trade.entry - currentPrice) * (trade.positionSize || 0);
    }

    if (!trade.exitPrice) return null;
    return trade.side === 'LONG'
      ? (trade.exitPrice - trade.entry) * (trade.positionSize || 0)
      : (trade.entry - trade.exitPrice) * (trade.positionSize || 0);
  };

  const pnl = calculatePnL();

  const getLevelTouched = () => {
    if (trade.reason.includes('D1')) return 'D1 (First Lower Level)';
    if (trade.reason.includes('D2')) return 'D2 (Second Lower Level)';
    if (trade.reason.includes('D3')) return 'D3 (Third Lower Level)';
    if (trade.reason.includes('D4')) return 'D4 (Fourth Lower Level)';
    if (trade.reason.includes('U1')) return 'U1 (First Upper Level)';
    if (trade.reason.includes('U2')) return 'U2 (Second Upper Level)';
    if (trade.reason.includes('U3')) return 'U3 (Third Upper Level)';
    if (trade.reason.includes('U4')) return 'U4 (Fourth Upper Level)';
    if (trade.reason.includes('daily open')) return 'Daily Open Level';
    return 'Unknown Level';
  };

  const getConfirmationDetails = () => {
    const confirmations = [];

    if (trade.reason.includes('VWAP')) {
      confirmations.push('Price above/below VWAP');
    }

    if (trade.reason.includes('order book') || trade.reason.includes('liquidity')) {
      confirmations.push('Order book liquidity wall detected');
    }

    if (trade.reason.includes('bias')) {
      confirmations.push('Clear directional bias confirmed');
    }

    return confirmations.length > 0 ? confirmations : ['Level touch signal'];
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="glass-effect rounded-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-bold text-white">Trade Details</h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-white transition-colors"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Trade Overview */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-gray-300">Symbol:</span>
                <span className="text-white font-semibold">{trade.symbol}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-300">Side:</span>
                <span className={`font-semibold ${trade.side === 'LONG' ? 'text-green-400' : 'text-red-400'}`}>
                  {trade.side}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-300">Status:</span>
                <span className={`font-semibold ${statusColorMap[trade.status]}`}>
                  {statusLabelMap[trade.status]}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-300">Entry Time:</span>
                <span className="text-white font-mono">
                  {new Date(trade.time).toLocaleString('en-US', {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  })}
                </span>
              </div>
              {trade.exitPrice && (
                <div className="flex items-center justify-between">
                  <span className="text-gray-300">Exit Time:</span>
                  <span className="text-white font-mono">
                    {new Date(Date.now()).toLocaleString('en-US', {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    })}
                  </span>
                </div>
              )}
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-gray-300">Entry Price:</span>
                <span className="text-white font-semibold font-mono">
                  ${formatCurrencyNoSymbol(trade.entry)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-300">Position Size:</span>
                <span className="text-white font-semibold font-mono">
                  {trade.positionSize ? formatCurrencyNoSymbol(trade.positionSize) : '—'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-300">Take Profit:</span>
                <span className="text-green-400 font-semibold font-mono">
                  ${formatCurrencyNoSymbol(trade.tp)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-300">Stop Loss:</span>
                <span className="text-red-400 font-semibold font-mono">
                  ${formatCurrencyNoSymbol(trade.sl)}
                </span>
              </div>
              {trade.exitPrice && (
                <div className="flex items-center justify-between">
                  <span className="text-gray-300">Exit Price:</span>
                  <span className="text-white font-semibold font-mono">
                    ${formatCurrencyNoSymbol(trade.exitPrice)}
                  </span>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-gray-300">P&L:</span>
                {pnl !== null ? (
                  <span className={`font-semibold font-mono ${pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {pnl >= 0 ? '+' : ''}${formatCurrencyNoSymbol(pnl)}
                  </span>
                ) : (
                  <span className="text-gray-400">—</span>
                )}
              </div>
            </div>
          </div>

          {/* Trade Execution Details */}
          <div className="mb-6">
            <h3 className="text-lg font-semibold text-white mb-4">Execution Details</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-3">
                <div>
                  <span className="text-gray-300 text-sm">Level Touched:</span>
                  <p className="text-white font-medium">{getLevelTouched()}</p>
                </div>
                <div>
                  <span className="text-gray-300 text-sm">Trigger Reason:</span>
                  <p className="text-white font-medium">{trade.reason}</p>
                </div>
              </div>
              <div className="space-y-3">
                <div>
                  <span className="text-gray-300 text-sm">Confirmations:</span>
                  <ul className="text-white text-sm space-y-1">
                    {getConfirmationDetails().map((confirmation, idx) => (
                      <li key={idx} className="flex items-center">
                        <svg className="w-4 h-4 text-green-400 mr-2" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                        {confirmation}
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <span className="text-gray-300 text-sm">Leverage:</span>
                  <p className="text-white font-medium">{trade.leverage}x</p>
                </div>
              </div>
            </div>
          </div>

          {/* Chart Preview */}
          {candles.length > 0 && (
            <div className="mb-6">
              <h3 className="text-lg font-semibold text-white mb-4">Price Action</h3>
              <div className="glass-effect rounded-xl border border-slate-700/60 overflow-hidden">
                <Chart
                  key={trade.id}
                  candles={candles}
                  dOpen={levels?.dOpen ?? null}
                  vwap={levels?.vwap ?? null}
                  vwapLine={levels?.vwapLine}
                  upLevels={levels?.upLevels ?? []}
                  dnLevels={levels?.dnLevels ?? []}
                  upper={levels?.upper ?? null}
                  lower={levels?.lower ?? null}
                  symbol={symbol}
                  interval={interval}
                  openTrades={[
                    {
                      entry: trade.entry,
                      tp: trade.tp,
                      sl: trade.sl,
                      side: trade.side,
                    },
                  ]}
                  markers={[
                    {
                      time: Math.floor(new Date(trade.time).getTime() / 1000),
                      position: trade.side === 'LONG' ? 'belowBar' : 'aboveBar',
                      color: trade.side === 'LONG' ? '#10b981' : '#ef4444',
                      shape: trade.side === 'LONG' ? 'arrowUp' : 'arrowDown',
                      text: `${trade.side} entry`,
                    },
                  ]}
                  height={400}
                />
              </div>
            </div>
          )}

          {/* Close Button */}
          <div className="flex justify-end">
            <button
              onClick={onClose}
              className="px-6 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}