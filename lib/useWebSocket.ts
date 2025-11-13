'use client';

import { useRef, useCallback, useEffect, useState } from 'react';
import type { Candle } from '@/lib/types';

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

interface MarketData {
  symbol: string;
  candles: Candle[];
  orderBook: OrderBookData | null;
  timestamp: number;
}

interface WebSocketHook {
  // Connection state
  isConnected: boolean;
  connectionStatus: 'connecting' | 'connected' | 'disconnected' | 'error';

  // Data
  orderBook: OrderBookData | null;
  candles: Candle[];
  trades: TradeData[];

  // Controls
  connect: () => void;
  disconnect: () => void;
}

// Bybit WebSocket URLs
const BYBIT_WS_TESTNET = 'wss://stream-testnet.bybit.com/v5/public/linear';
const BYBIT_WS_MAINNET = 'wss://stream.bybit.com/v5/public/linear';

const VALID_INTERVALS = new Set([
  '1', '3', '5', '15', '60', '120', '240', 'D', 'W', 'M'
]);

export function useWebSocket(symbol: string, interval: string = '5', initialCandles: Candle[] = []): WebSocketHook {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastCandleRef = useRef<Candle | null>(null);
  const intervalRef = useRef<string>(interval);

  const [isConnected, setIsConnected] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected' | 'error'>('disconnected');
  const [orderBook, setOrderBook] = useState<OrderBookData | null>(null);
  const [candles, setCandles] = useState<Candle[]>(initialCandles);

  // Update candles state when initialCandles changes (but don't reset if we already have WS data)
  useEffect(() => {
    if (initialCandles.length > 0 && candles.length === 0) {
      setCandles(initialCandles);
    }
  }, [initialCandles, candles.length]);

  useEffect(() => {
    intervalRef.current = interval;
    setCandles(initialCandles.length > 0 ? initialCandles : []);
    setOrderBook(null);
    setTrades([]);
    lastCandleRef.current = null;
    setIsConnected(false);
    setConnectionStatus('connecting');
  }, [symbol, interval, initialCandles]);
  const [trades, setTrades] = useState<TradeData[]>([]);

  // Get WebSocket URL based on environment
  const getWsUrl = () => {
    const isProduction = process.env.NODE_ENV === 'production';
    return isProduction ? BYBIT_WS_MAINNET : BYBIT_WS_TESTNET;
  };

  // Ping to keep connection alive
  const startPing = () => {
    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current);
    }

    pingIntervalRef.current = setInterval(() => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        try {
          wsRef.current.send(JSON.stringify({ op: 'ping' }));
        } catch (error) {
          console.error('Failed to send ping:', error);
        }
      }
    }, 20000); // Ping every 20 seconds
  };

  // Stop ping interval
  const stopPing = () => {
    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = null;
    }
  };

  // Reconnect logic with exponential backoff
  const reconnect = useCallback((attempt: number = 1) => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }

    const delay = Math.min(1000 * Math.pow(2, attempt), 30000); // Max 30 seconds

    reconnectTimeoutRef.current = setTimeout(() => {
      // console.log(`Reconnecting WebSocket for ${symbol}, attempt ${attempt}`); // Disabled to reduce console spam
      connect();
    }, delay);
  }, [symbol]);

  // Connect to WebSocket
  const connect = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      return;
    }

    setConnectionStatus('connecting');

    try {
      const ws = new WebSocket(getWsUrl());
      wsRef.current = ws;

      ws.onopen = () => {
        // console.log(`WebSocket connected for ${symbol}`); // Disabled to reduce console spam
        setIsConnected(true);
        setConnectionStatus('connected');

        // Clear any reconnect timer
        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current);
          reconnectTimeoutRef.current = null;
        }

        // Start ping interval
        startPing();

        // Subscribe to streams
        const klineInterval = VALID_INTERVALS.has(intervalRef.current) ? intervalRef.current : '5';
        const subscriptions = [
          `orderbook.50.${symbol}`, // Order book depth 50
          `kline.${klineInterval}.${symbol}`,      // Candles
          `publicTrade.${symbol}`, // Recent trades
        ];

        ws.send(JSON.stringify({
          op: 'subscribe',
          args: subscriptions
        }));
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);

          // Handle pong response
          if (message.op === 'pong') {
            return;
          }

          // Handle subscription confirmation
          if (message.op === 'subscribe' || message.op === 'unsubscribe') {
            if (!message.success) {
              // Only log errors, not successful subscriptions
              console.error(`${message.op === 'subscribe' ? 'Subscription' : 'Unsubscription'} failed for ${symbol}:`, message.retMsg);
            }
            // console.log(`${message.op === 'subscribe' ? 'Subscribed' : 'Unsubscribed'} to ${symbol} streams`); // Disabled to reduce console spam
            return;
          }

          // Handle error messages - only log if it's a real error (not just no data)
          if (message.retCode && message.retCode !== 0) {
            // Reduce error logging for common non-error codes
            if (message.retCode !== 10001 && message.retCode !== 10002) { // Heartbeat related
              console.error(`WebSocket error for ${symbol}:`, message.retMsg);
            }
            return;
          }

          // Process stream data only if we have valid data
          if (message.topic && message.data) {
            if (message.topic.startsWith('orderbook.')) {
              handleOrderBookMessage(message);
            } else if (message.topic.startsWith('kline.')) {
              handleKlineMessage(message);
            } else if (message.topic.startsWith('publicTrade.')) {
              handleTradeMessage(message);
            }
          }
        } catch (error) {
          // Reduce console error spam - only log parsing errors occasionally
          if (Math.random() < 0.01) { // Log only 1% of parsing errors
            console.error('Error processing WebSocket message:', error);
          }
        }
      };

      ws.onclose = (event) => {
        // console.log(`WebSocket closed for ${symbol}, code: ${event.code}, reason: ${event.reason}`); // Disabled to reduce console spam
        setIsConnected(false);
        setConnectionStatus('disconnected');

        stopPing();

        // Attempt to reconnect unless it was a normal closure
        if (event.code !== 1000) {
          reconnect(1);
        }
      };

      ws.onerror = (error) => {
        // Only log WebSocket errors occasionally to reduce console spam
        if (Math.random() < 0.1) { // Log only 10% of connection errors
          console.error(`WebSocket error for ${symbol}:`, error);
        }
        setConnectionStatus('error');
      };

    } catch (error) {
      console.error(`Failed to create WebSocket connection for ${symbol}:`, error);
      setConnectionStatus('error');
      reconnect(1);
    }
  }, [symbol, reconnect]);

  // Disconnect WebSocket
  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    stopPing();

    if (wsRef.current) {
      try {
        if (wsRef.current.readyState === WebSocket.OPEN) {
          // Unsubscribe before closing
          const klineInterval = VALID_INTERVALS.has(intervalRef.current) ? intervalRef.current : '5';
          wsRef.current.send(JSON.stringify({
            op: 'unsubscribe',
            args: [`orderbook.50.${symbol}`, `kline.${klineInterval}.${symbol}`, `publicTrade.${symbol}`]
          }));
        }
        wsRef.current.close();
      } catch (error) {
        console.error('Error closing WebSocket:', error);
      }
      wsRef.current = null;
    }

    setIsConnected(false);
    setConnectionStatus('disconnected');
  }, [symbol]);

  // Handle order book messages
  const handleOrderBookMessage = (message: any) => {
    try {
      const { a: asksRaw = [], b: bidsRaw = [] } = message.data;

      if (!Array.isArray(asksRaw) || !Array.isArray(bidsRaw)) {
        return;
      }

      const asks = asksRaw
        .map((x: any) => ({ price: parseFloat(x[0]), size: parseFloat(x[1]) }))
        .filter((e: DepthEntry) => !isNaN(e.price) && !isNaN(e.size) && e.price > 0 && e.size > 0)
        .sort((a, b) => a.price - b.price); // Sort asks ascending

      const bids = bidsRaw
        .map((x: any) => ({ price: parseFloat(x[0]), size: parseFloat(x[1]) }))
        .filter((e: DepthEntry) => !isNaN(e.price) && !isNaN(e.size) && e.price > 0 && e.size > 0)
        .sort((a, b) => b.price - a.price); // Sort bids descending

      if (asks.length > 0 && bids.length > 0) {
        setOrderBook({ bids, asks });
      }
    } catch (error) {
      console.error('Error processing order book message:', error);
    }
  };

  // Handle kline messages
  const handleKlineMessage = (message: any) => {
    try {
      if (!Array.isArray(message.data)) return;

      // Process each kline update
      message.data.forEach((klineData: any) => {
        const candle: Candle = {
          ts: parseInt(klineData.start),
          open: parseFloat(klineData.open),
          high: parseFloat(klineData.high),
          low: parseFloat(klineData.low),
          close: parseFloat(klineData.close),
          volume: parseFloat(klineData.volume),
        };

        // Validate candle data
        if (isNaN(candle.ts) || isNaN(candle.open) || isNaN(candle.high) ||
            isNaN(candle.low) || isNaN(candle.close) || isNaN(candle.volume)) {
          return;
        }

        setCandles(prevCandles => {
          // Check if this is an update to the last candle or a new one
          const lastCandle = prevCandles[prevCandles.length - 1];

          if (lastCandle && lastCandle.ts === candle.ts) {
            // Update the last candle
            const updatedCandles = [...prevCandles];
            updatedCandles[updatedCandles.length - 1] = candle;
            return updatedCandles;
          } else {
            // Add new candle, keep only last 200
            const newCandles = [...prevCandles, candle];
            return newCandles.slice(-200);
          }
        });
      });
    } catch (error) {
      console.error('Error processing kline message:', error);
    }
  };

  // Handle trade messages
  const handleTradeMessage = (message: any) => {
    try {
      if (!Array.isArray(message.data)) return;

      const newTrades = message.data.map((tradeData: any) => ({
        id: tradeData.i || `${tradeData.T}-${tradeData.p}`,
        price: parseFloat(tradeData.p),
        size: parseFloat(tradeData.v),
        side: tradeData.S === 'Buy' ? 'Buy' as const : 'Sell' as const,
        timestamp: parseInt(tradeData.T),
      })).filter((trade: TradeData) =>
        !isNaN(trade.price) && !isNaN(trade.size) && !isNaN(trade.timestamp)
      );

      if (newTrades.length > 0) {
        setTrades(prevTrades => {
          // Add new trades and keep only last 100
          const updatedTrades = [...prevTrades, ...newTrades];
          return updatedTrades.slice(-100);
        });
      }
    } catch (error) {
      console.error('Error processing trade message:', error);
    }
  };

  // Auto-connect when symbol changes
  useEffect(() => {
    connect();

    return () => {
      disconnect();
    };
  }, [symbol, interval, connect, disconnect]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return {
    isConnected,
    connectionStatus,
    orderBook,
    candles,
    trades,
    connect,
    disconnect,
  };
}