import { Server as HTTPServer } from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import { getKlines } from '@/lib/bybit';
import { getOrderBookSnapshot } from '@/lib/orderbook';
import type { Candle, LevelsResponse } from '@/lib/types';
import WebSocket from 'ws';

interface MarketData {
  symbol: string;
  candles: Candle[];
  orderBook: {
    bids: Array<{ price: number; size: number }>;
    asks: Array<{ price: number; size: number }>;
  } | null;
  levels: LevelsResponse | null;
  timestamp: number;
}

interface RealtimeData {
  symbol: string;
  type: 'kline' | 'orderbook' | 'trade';
  data: any;
  timestamp: number;
}

let io: SocketIOServer | null = null;
const bybitSockets: Record<string, WebSocket> = {};
const pingIntervals: Record<string, NodeJS.Timeout> = {};
const symbolSubscriptions: Record<string, Set<string>> = {};

export function initializeWebSocketServer(server: HTTPServer) {
  io = new SocketIOServer(server, {
    cors: {
      origin: process.env.NODE_ENV === 'production' ? '*' : true,
      methods: ['GET', 'POST'],
      credentials: true
    },
    transports: ['websocket', 'polling'],
    allowEIO3: true,
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  io.on('connection', (socket: Socket) => {
    console.log(`Client connected: ${socket.id}`);

    // Handle subscription to market data
    socket.on('subscribe-market-data', async (data: { symbol: string; interval: string }) => {
      const { symbol, interval } = data;
      console.log(`Client ${socket.id} subscribing to ${symbol} with interval ${interval}`);

      // Join symbol-specific room
      socket.join(`market-${symbol}`);

      // Send initial data
      try {
        await sendMarketDataToClient(socket, symbol, interval);
      } catch (error) {
        console.error(`Error sending initial data for ${symbol}:`, error);
        socket.emit('market-data-error', {
          symbol,
          error: 'Failed to fetch initial market data'
        });
      }

      // Set up periodic updates (every 5 seconds)
      const intervalId = setInterval(async () => {
        try {
          await sendMarketDataToClient(socket, symbol, interval);
        } catch (error) {
          console.error(`Error sending periodic data for ${symbol}:`, error);
        }
      }, 5000);

      // Store interval ID for cleanup
      socket.data.marketInterval = intervalId;
    });

    // Handle subscription to trades data
    socket.on('subscribe-trades', (data: { symbol: string }) => {
      const { symbol } = data;
      console.log(`Client ${socket.id} subscribing to trades for ${symbol}`);

      socket.join(`trades-${symbol}`);

      // Send initial trades data from database
      // This will be handled by the trade management system
    });

    // Handle unsubscription
    socket.on('unsubscribe-market-data', (data: { symbol: string }) => {
      const { symbol } = data;
      console.log(`Client ${socket.id} unsubscribing from ${symbol}`);

      socket.leave(`market-${symbol}`);
    });

    socket.on('unsubscribe-trades', (data: { symbol: string }) => {
      const { symbol } = data;
      socket.leave(`trades-${symbol}`);
    });

    socket.on('disconnect', () => {
      console.log(`Client disconnected: ${socket.id}`);

      // Clear any intervals
      if (socket.data.marketInterval) {
        clearInterval(socket.data.marketInterval);
      }
    });
  });

  console.log('WebSocket server initialized');
}

async function sendMarketDataToClient(socket: Socket, symbol: string, interval: string) {
  try {
    // Fetch latest klines data
    const isProduction = process.env.NODE_ENV === 'production';
    const candles = await getKlines(symbol, interval as '1' | '3' | '5' | '15' | '60' | '120' | '240' | 'D' | 'W' | 'M', 200, !isProduction); // Use mainnet in production

    // Get order book snapshot
    const orderBookSnapshot = getOrderBookSnapshot(symbol);

    // Prepare market data
    const marketData: MarketData = {
      symbol,
      candles,
      orderBook: orderBookSnapshot ? {
        bids: orderBookSnapshot.bids.slice(0, 10), // Top 10 bids
        asks: orderBookSnapshot.asks.slice(0, 10)  // Top 10 asks
      } : null,
      levels: null, // Will be populated by levels API
      timestamp: Date.now()
    };

    // Send to client
    socket.emit('market-data-update', marketData);

  } catch (error) {
    console.error(`Error fetching market data for ${symbol}:`, error);
    socket.emit('market-data-error', {
      symbol,
      error: 'Failed to fetch market data'
    });
  }
}

// Function to broadcast trades updates
export function broadcastTradesUpdate(symbol: string, trades: any[]) {
  if (io) {
    io.to(`trades-${symbol}`).emit('trades-update', {
      symbol,
      trades,
      timestamp: Date.now()
    });
  }
}

// Function to broadcast levels updates
export function broadcastLevelsUpdate(symbol: string, levels: LevelsResponse) {
  if (io) {
    io.to(`market-${symbol}`).emit('levels-update', {
      symbol,
      levels,
      timestamp: Date.now()
    });
  }
}

// Function to broadcast signal updates
export function broadcastSignalUpdate(symbol: string, signal: any) {
  if (io) {
    io.to(`market-${symbol}`).emit('signal-update', {
      symbol,
      signal,
      timestamp: Date.now()
    });
  }
}

// Function to broadcast real-time market data
export function broadcastRealtimeData(symbol: string, type: 'kline' | 'orderbook' | 'trade', data: any) {
  if (io) {
    io.to(`market-${symbol}`).emit('realtime-data', {
      symbol,
      type,
      data,
      timestamp: Date.now()
    });
  }
}

// Initialize Bybit WebSocket connections for real-time data
function initializeBybitWebSocket(symbol: string) {
  if (bybitSockets[symbol]) {
    return; // Already connected
  }

  const isProduction = process.env.NODE_ENV === 'production';
  const wsUrl = isProduction ? 'wss://stream.bybit.com/v5/public/linear' : 'wss://stream-testnet.bybit.com/v5/public/linear';
  const ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log(`Bybit WebSocket opened for ${symbol}`);

    // Subscribe to real-time klines (1-minute for more real-time updates)
    const klineSub = {
      op: 'subscribe',
      args: [`kline.1.${symbol}`]
    };
    ws.send(JSON.stringify(klineSub));

    // Subscribe to order book updates
    const orderbookSub = {
      op: 'subscribe',
      args: [`orderbook.50.${symbol}`]
    };
    ws.send(JSON.stringify(orderbookSub));

    // Set up ping interval to keep connection alive
    pingIntervals[symbol] = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
      }
    }, 30000); // Ping every 30 seconds
  };

  ws.onmessage = (event) => {
    try {
      if (event.data === 'pong') {
        return; // Handle pong responses
      }

      const data = event.data.toString();
      const msg = JSON.parse(data);

      if (msg.success === false) {
        console.error(`Bybit WebSocket subscription failed for ${symbol}:`, msg.ret_msg);
        return;
      }

      if (msg.topic && msg.data) {
        // Handle kline updates
        if (msg.topic.startsWith('kline.')) {
          const klineData = msg.data[0];
          if (klineData) {
            const candle: Candle = {
              ts: parseInt(klineData.start),
              open: parseFloat(klineData.open),
              high: parseFloat(klineData.high),
              low: parseFloat(klineData.low),
              close: parseFloat(klineData.close),
              volume: parseFloat(klineData.volume)
            };
            broadcastRealtimeData(symbol, 'kline', candle);
          }
        }

        // Handle order book updates
        else if (msg.topic.startsWith('orderbook.')) {
          const orderBookData = {
            bids: msg.data.b?.slice(0, 10).map((b: any) => ({
              price: parseFloat(b[0]),
              size: parseFloat(b[1])
            })) || [],
            asks: msg.data.a?.slice(0, 10).map((a: any) => ({
              price: parseFloat(a[0]),
              size: parseFloat(a[1])
            })) || []
          };
          broadcastRealtimeData(symbol, 'orderbook', orderBookData);
        }
      }
    } catch (error) {
      console.error(`Error processing Bybit message for ${symbol}:`, error);
    }
  };

  ws.onclose = (event) => {
    console.log(`Bybit WebSocket closed for ${symbol}, code: ${event.code}, reason: ${event.reason}`);
    delete bybitSockets[symbol];
    // Clear ping interval
    if (pingIntervals[symbol]) {
      clearInterval(pingIntervals[symbol]);
      delete pingIntervals[symbol];
    }
    // Auto-reconnect after delay if still subscribed
    setTimeout(() => {
      if (symbolSubscriptions[symbol]?.size > 0) {
        initializeBybitWebSocket(symbol);
      }
    }, 5000);
  };

  ws.onerror = (error) => {
    console.error(`Bybit WebSocket error for ${symbol}:`, error);
  };

  bybitSockets[symbol] = ws;
}

// Function to subscribe to a symbol's real-time data
export function subscribeToRealtimeData(symbol: string) {
  if (!symbolSubscriptions[symbol]) {
    symbolSubscriptions[symbol] = new Set();
  }

  // Only initialize WebSocket if this is the first subscription
  if (symbolSubscriptions[symbol].size === 0) {
    initializeBybitWebSocket(symbol);
  }

  symbolSubscriptions[symbol].add('client'); // Placeholder for client tracking
}

// Function to unsubscribe from a symbol's real-time data
export function unsubscribeFromRealtimeData(symbol: string) {
  if (symbolSubscriptions[symbol]) {
    symbolSubscriptions[symbol].delete('client');

    // Close WebSocket if no more subscribers
    if (symbolSubscriptions[symbol].size === 0) {
      if (bybitSockets[symbol]) {
        // Clear ping interval before closing
        if (pingIntervals[symbol]) {
          clearInterval(pingIntervals[symbol]);
          delete pingIntervals[symbol];
        }
        bybitSockets[symbol].close();
        delete bybitSockets[symbol];
      }
      delete symbolSubscriptions[symbol];
    }
  }
}

export { io };