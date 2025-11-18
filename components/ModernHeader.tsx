'use client';

import ConnectionIndicator from './ConnectionIndicator';
import StatusBadge from './StatusBadge';

interface ModernHeaderProps {
  isConnected: boolean;
  connectionStatus: 'connecting' | 'connected' | 'disconnected' | 'error';
  lastUpdateTime: number | null;
  botRunning: boolean;
  currentPrice: number | null;
  symbol: string;
}

export default function ModernHeader({
  isConnected,
  connectionStatus,
  lastUpdateTime,
  botRunning,
  currentPrice,
  symbol,
}: ModernHeaderProps) {
  return (
    <div className="mb-8 animate-fade-in">
      {/* Main Header */}
      <div className="flex items-start justify-between mb-6">
        <div className="flex-1">
          <h1 className="text-5xl font-black mb-3 gradient-text">
            GARCHY
          </h1>
          <p className="text-slate-400 text-sm font-medium">
            Intelligent volatility-based trading system
          </p>
        </div>
        
        {/* Status Indicators */}
        <div className="flex items-center gap-3">
          <ConnectionIndicator
            isConnected={isConnected}
            connectionStatus={connectionStatus}
            lastUpdateTime={lastUpdateTime}
          />
          
          <StatusBadge 
            variant={botRunning ? 'success' : 'neutral'} 
            dot 
            pulse={botRunning}
          >
            {botRunning ? 'Active' : 'Inactive'}
          </StatusBadge>
        </div>
      </div>
      
      {/* Quick Info Bar */}
      <div className="flex items-center gap-4 flex-wrap">
        {/* Symbol */}
        <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-800/40 border border-slate-700/50">
          <span className="text-slate-400 text-xs font-medium">Symbol</span>
          <span className="text-slate-100 text-sm font-bold">{symbol}</span>
        </div>
        
        {/* Current Price */}
        {currentPrice !== null && (
          <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-500/10 border border-indigo-500/30">
            <span className="text-indigo-400 text-xs font-medium">Price</span>
            <span className="text-indigo-300 text-sm font-bold">${currentPrice.toFixed(2)}</span>
          </div>
        )}
        
        {/* Market Status */}
        <StatusBadge variant="success" dot>
          Market Open
        </StatusBadge>
      </div>
    </div>
  );
}
