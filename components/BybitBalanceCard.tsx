'use client';

import { useEffect, useState } from 'react';
import { formatCurrency } from '@/lib/format';

interface BybitBalance {
  total: number;
  available: number;
  wallet: number;
  unrealizedPnL: number;
  currency: string;
}

interface BybitBalanceCardProps {
  className?: string;
  refreshInterval?: number; // ms, default 30000 (30s)
}

export default function BybitBalanceCard({ 
  className = '', 
  refreshInterval = 30000 
}: BybitBalanceCardProps) {
  const [balance, setBalance] = useState<BybitBalance | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<number>(Date.now());

  const fetchBalance = async () => {
    try {
      const res = await fetch('/api/bybit/balance');
      
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to fetch balance');
      }

      const data = await res.json();
      
      // Validate response structure
      if (!data || !data.balance) {
        console.error('Invalid balance response:', data);
        throw new Error('Invalid response from server');
      }

      setBalance(data.balance);
      setError(null);
      setLastUpdate(Date.now());
    } catch (err) {
      console.error('Error fetching Bybit balance:', err);
      setError(err instanceof Error ? err.message : 'Failed to load balance');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBalance();
    const interval = setInterval(fetchBalance, refreshInterval);
    return () => clearInterval(interval);
  }, [refreshInterval]);

  if (loading) {
    return (
      <div className={`flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-900/60 border border-slate-700/60 backdrop-blur-sm ${className}`}>
        <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-white"></div>
        <span className="text-xs text-slate-400">Loading balance...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div 
        className={`flex items-center gap-2 px-4 py-2 rounded-lg bg-red-500/10 border border-red-500/30 cursor-pointer hover:bg-red-500/20 transition-colors ${className}`}
        onClick={fetchBalance}
        title="Click to retry"
      >
        <span className="text-xs text-red-400">⚠️ {error}</span>
      </div>
    );
  }

  if (!balance) {
    return null;
  }

  const timeSinceUpdate = Math.floor((Date.now() - lastUpdate) / 1000);
  const updateText = timeSinceUpdate < 5 ? 'just now' : `${timeSinceUpdate}s ago`;

  return (
    <div className={`group relative ${className}`}>
      {/* Compact View */}
      <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-indigo-500/10 to-purple-500/10 border border-indigo-500/30 backdrop-blur-sm hover:from-indigo-500/20 hover:to-purple-500/20 transition-all cursor-pointer">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
          <div className="text-xs">
            <div className="text-slate-400 font-medium">Bybit Balance</div>
            <div className="text-indigo-300 font-bold">
              {formatCurrency(balance.available)}
            </div>
          </div>
        </div>
        
        {balance.unrealizedPnL !== 0 && (
          <div className={`text-xs font-semibold ${
            balance.unrealizedPnL >= 0 ? 'text-green-400' : 'text-red-400'
          }`}>
            {balance.unrealizedPnL >= 0 ? '+' : ''}{formatCurrency(balance.unrealizedPnL)}
          </div>
        )}
      </div>

      {/* Tooltip on Hover */}
      <div className="absolute right-0 top-full mt-2 w-64 p-4 rounded-lg bg-slate-900 border border-slate-700 shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50">
        <div className="text-xs font-semibold text-slate-400 mb-3 flex items-center justify-between">
          <span>Bybit Wallet</span>
          <span className="text-[10px] text-slate-500">{updateText}</span>
        </div>
        
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400">Total Equity</span>
            <span className="text-sm font-bold text-white">{formatCurrency(balance.total)}</span>
          </div>
          
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400">Available</span>
            <span className="text-sm font-bold text-indigo-400">{formatCurrency(balance.available)}</span>
          </div>
          
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400">Wallet Balance</span>
            <span className="text-sm font-semibold text-slate-300">{formatCurrency(balance.wallet)}</span>
          </div>
          
          {balance.unrealizedPnL !== 0 && (
            <>
              <div className="border-t border-slate-700 my-2"></div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400">Unrealized P&L</span>
                <span className={`text-sm font-bold ${
                  balance.unrealizedPnL >= 0 ? 'text-green-400' : 'text-red-400'
                }`}>
                  {balance.unrealizedPnL >= 0 ? '+' : ''}{formatCurrency(balance.unrealizedPnL)}
                </span>
              </div>
            </>
          )}
        </div>
        
        <button
          onClick={(e) => {
            e.stopPropagation();
            fetchBalance();
          }}
          className="mt-3 w-full px-3 py-1.5 rounded bg-indigo-500/20 hover:bg-indigo-500/30 text-xs text-indigo-300 font-semibold transition-colors"
        >
          Refresh
        </button>
      </div>
    </div>
  );
}
