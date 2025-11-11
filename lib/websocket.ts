import { getKlines } from '@/lib/bybit';
import { getOrderBookSnapshot } from '@/lib/orderbook';
import type { Candle, LevelsResponse } from '@/lib/types';

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

// Cache for polling data
const pollingCache: Record<string, MarketData> = {};
const pollingIntervals: Record<string, NodeJS.Timeout> = {};
const subscriptions: Record<string, Set<string>> = {};

// Polling interval in milliseconds (5 seconds)
const POLLING_INTERVAL = 5000;

// Function to poll market data for a symbol
async function pollMarketData(symbol: string): Promise<MarketData | null> {
  try {
    // Fetch latest klines data
    const isProduction = process.env.NODE_ENV === 'production';
    const candles = await getKlines(symbol, '5', 200, !isProduction); // Use mainnet in production

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

    // Cache the data
    pollingCache[symbol] = marketData;

    return marketData;
  } catch (error) {
    console.error(`Error polling market data for ${symbol}:`, error);
    return null;
  }
}

// Function to start polling for a symbol
export function subscribeToRealtimeData(symbol: string) {
  if (!subscriptions[symbol]) {
    subscriptions[symbol] = new Set();
  }

  // Only start polling if this is the first subscription
  if (subscriptions[symbol].size === 0) {
    console.log(`Starting polling for ${symbol}`);

    // Initial poll
    pollMarketData(symbol);

    // Set up polling interval
    pollingIntervals[symbol] = setInterval(async () => {
      await pollMarketData(symbol);
    }, POLLING_INTERVAL);
  }

  subscriptions[symbol].add('client');
}

// Function to stop polling for a symbol
export function unsubscribeFromRealtimeData(symbol: string) {
  if (subscriptions[symbol]) {
    subscriptions[symbol].delete('client');

    // Stop polling if no more subscribers
    if (subscriptions[symbol].size === 0) {
      console.log(`Stopping polling for ${symbol}`);

      if (pollingIntervals[symbol]) {
        clearInterval(pollingIntervals[symbol]);
        delete pollingIntervals[symbol];
      }

      delete pollingCache[symbol];
      delete subscriptions[symbol];
    }
  }
}

// Function to get cached market data
export function getCachedMarketData(symbol: string): MarketData | null {
  return pollingCache[symbol] || null;
}

// Function to broadcast trades updates (placeholder for compatibility)
export function broadcastTradesUpdate(symbol: string, trades: any[]) {
  // In polling system, this would need to be handled differently
  // For now, just log it
  console.log(`Trade update for ${symbol}:`, trades.length, 'trades');
}

// Function to broadcast levels updates (placeholder for compatibility)
export function broadcastLevelsUpdate(symbol: string, levels: LevelsResponse) {
  // Update cached data with levels
  if (pollingCache[symbol]) {
    pollingCache[symbol].levels = levels;
    pollingCache[symbol].timestamp = Date.now();
  }
}

// Function to broadcast signal updates (placeholder for compatibility)
export function broadcastSignalUpdate(symbol: string, signal: any) {
  // In polling system, this would need to be handled differently
  console.log(`Signal update for ${symbol}:`, signal);
}

// Function to broadcast real-time market data (placeholder for compatibility)
export function broadcastRealtimeData(symbol: string, type: 'kline' | 'orderbook' | 'trade', data: any) {
  // In polling system, this would need to be handled differently
  console.log(`Realtime data for ${symbol}:`, type, data);
}

// Cleanup function for server shutdown
export function cleanupPolling() {
  console.log('Cleaning up polling intervals...');
  Object.keys(pollingIntervals).forEach(symbol => {
    if (pollingIntervals[symbol]) {
      clearInterval(pollingIntervals[symbol]);
    }
  });
}

// Initialize polling for common symbols on startup
const commonSymbols = ['BTCUSDT', 'ETHUSDT'];
commonSymbols.forEach(symbol => {
  subscribeToRealtimeData(symbol);
});