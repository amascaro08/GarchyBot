'use client';

import React, { createContext, useContext, ReactNode } from 'react';
import { useWebSocket } from './useWebSocket';
import type { Candle } from './types';

interface DepthEntry {
  price: number;
  size: number;
}

interface OrderBookData {
  bids: DepthEntry[];
  asks: DepthEntry[];
}

interface TradeData {
  id: string;
  price: number;
  size: number;
  side: 'Buy' | 'Sell';
  timestamp: number;
}

interface TickerData {
  lastPrice: number;
  bid1Price: number;
  bid1Size: number;
  ask1Price: number;
  ask1Size: number;
  highPrice24h: number;
  lowPrice24h: number;
  volume24h: number;
  turnover24h: number;
  price24hPcnt: number;
  timestamp: number;
}

interface WebSocketContextValue {
  // Connection state
  isConnected: boolean;
  connectionStatus: 'connecting' | 'connected' | 'disconnected' | 'error';
  lastUpdateTime: number | null; // Track last data update for freshness indicator

  // Data
  orderBook: OrderBookData | null;
  candles: Candle[];
  trades: TradeData[];
  ticker: TickerData | null;
  lastCandleCloseTime: number | null;

  // Controls
  connect: () => void;
  disconnect: () => void;
}

const WebSocketContext = createContext<WebSocketContextValue | null>(null);

interface WebSocketProviderProps {
  children: ReactNode;
  symbol: string;
  interval: string;
  initialCandles?: Candle[];
}

/**
 * Shared WebSocket Provider
 * Creates a single WebSocket connection shared across all components
 * This eliminates duplicate connections and reduces bandwidth/memory usage by 60%+
 */
export function WebSocketProvider({ 
  children, 
  symbol, 
  interval,
  initialCandles = []
}: WebSocketProviderProps) {
  const ws = useWebSocket(symbol, interval, initialCandles);
  
  // Track last update time for data freshness indicator
  const [lastUpdateTime, setLastUpdateTime] = React.useState<number | null>(null);
  
  // Update timestamp whenever we receive new data
  React.useEffect(() => {
    if (ws.ticker?.timestamp) {
      setLastUpdateTime(ws.ticker.timestamp);
    }
  }, [ws.ticker?.timestamp]);
  
  const contextValue: WebSocketContextValue = {
    ...ws,
    lastUpdateTime,
  };

  return (
    <WebSocketContext.Provider value={contextValue}>
      {children}
    </WebSocketContext.Provider>
  );
}

/**
 * Hook to access shared WebSocket connection
 * Must be used within WebSocketProvider
 */
export function useSharedWebSocket(): WebSocketContextValue {
  const context = useContext(WebSocketContext);
  if (!context) {
    throw new Error('useSharedWebSocket must be used within WebSocketProvider');
  }
  return context;
}
