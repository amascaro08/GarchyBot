'use client';

import { useEffect, useState } from 'react';

interface ConnectionIndicatorProps {
  isConnected: boolean;
  connectionStatus: 'connecting' | 'connected' | 'disconnected' | 'error';
  lastUpdateTime: number | null;
  className?: string;
}

/**
 * Real-time connection indicator for trading interface
 * Shows:
 * - Connection status (connected/disconnected/error)
 * - Data freshness (last update time)
 * - Network latency indicator
 */
export default function ConnectionIndicator({
  isConnected,
  connectionStatus,
  lastUpdateTime,
  className = '',
}: ConnectionIndicatorProps) {
  const [timeSinceUpdate, setTimeSinceUpdate] = useState<number>(0);
  const [latency, setLatency] = useState<number | null>(null);

  // Update time since last data update
  useEffect(() => {
    if (!lastUpdateTime) return;

    const interval = setInterval(() => {
      setTimeSinceUpdate(Date.now() - lastUpdateTime);
    }, 100); // Update every 100ms for real-time feel

    return () => clearInterval(interval);
  }, [lastUpdateTime]);

  // Calculate network latency (simple approximation)
  useEffect(() => {
    if (lastUpdateTime) {
      const lat = Date.now() - lastUpdateTime;
      setLatency(lat > 1000 ? lat : null); // Only show if >1s lag
    }
  }, [lastUpdateTime]);

  const getStatusInfo = () => {
    if (connectionStatus === 'connecting') {
      return {
        color: 'bg-yellow-400',
        text: 'Connecting...',
        pulse: true,
        textColor: 'text-yellow-300',
      };
    }
    
    if (connectionStatus === 'error' || !isConnected) {
      return {
        color: 'bg-red-500',
        text: 'Disconnected',
        pulse: true,
        textColor: 'text-red-300',
      };
    }

    // Check data freshness - trading data should update frequently
    if (timeSinceUpdate > 5000) {
      return {
        color: 'bg-orange-500',
        text: 'Stale Data',
        pulse: true,
        textColor: 'text-orange-300',
      };
    }

    if (timeSinceUpdate > 2000) {
      return {
        color: 'bg-yellow-400',
        text: 'Slow Updates',
        pulse: false,
        textColor: 'text-yellow-300',
      };
    }

    return {
      color: 'bg-green-500',
      text: 'Live',
      pulse: false,
      textColor: 'text-green-300',
    };
  };

  const status = getStatusInfo();
  const dataAge = timeSinceUpdate > 1000 
    ? `${(timeSinceUpdate / 1000).toFixed(1)}s ago` 
    : 'just now';

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {/* Status Indicator */}
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-900/60 border border-slate-700/60 backdrop-blur-sm">
        <div className="relative">
          <div className={`w-2 h-2 ${status.color} rounded-full ${status.pulse ? 'animate-pulse' : ''}`}></div>
          {status.pulse && (
            <div className={`absolute inset-0 w-2 h-2 ${status.color} rounded-full animate-ping opacity-75`}></div>
          )}
        </div>
        <div className="text-xs">
          <div className={`${status.textColor} font-bold`}>{status.text}</div>
          {lastUpdateTime && (
            <div className="text-gray-400 text-[10px]">{dataAge}</div>
          )}
        </div>
      </div>

      {/* Latency Warning (only show if significant) */}
      {latency && latency > 1000 && (
        <div className="px-2 py-1 rounded-lg bg-orange-500/10 border border-orange-500/30">
          <div className="text-xs text-orange-300 font-medium">
            Lag: {(latency / 1000).toFixed(1)}s
          </div>
        </div>
      )}
    </div>
  );
}
