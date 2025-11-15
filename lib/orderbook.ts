type Side = 'LONG' | 'SHORT';

export type DepthEntry = { price: number; size: number }; // size in base units
export type DepthSnapshot = { ts: number; bids: DepthEntry[]; asks: DepthEntry[] };

const sockets: Record<string, WebSocket> = {};
const buffers: Record<string, DepthSnapshot[]> = {}; // per symbol ring buffer
const reconnectTimers: Record<string, NodeJS.Timeout> = {};
const pingTimers: Record<string, NodeJS.Timeout> = {};
const MAX_RECONNECT_DELAY = 30000; // 30 seconds max
const PING_INTERVAL = 20000; // Ping every 20 seconds to keep connection alive

function reconnectOrderBook(symbol: string, attempt: number = 1) {
  // Clear existing timer
  if (reconnectTimers[symbol]) {
    clearTimeout(reconnectTimers[symbol]);
  }

  const delay = Math.min(1000 * Math.pow(2, attempt), MAX_RECONNECT_DELAY);
  
  reconnectTimers[symbol] = setTimeout(() => {
    // console.log(`Reconnecting order book for ${symbol}, attempt ${attempt}`); // Disabled to reduce console spam
    startOrderBook(symbol);
  }, delay);
}

export function startOrderBook(symbol: string) {
  // Close existing connection if any for this symbol
  if (sockets[symbol]) {
    try {
      // Unsubscribe before closing
      if (sockets[symbol].readyState === WebSocket.OPEN) {
        const unsub = { op: 'unsubscribe', args: [`orderbook.50.${symbol}`] };
        sockets[symbol].send(JSON.stringify(unsub));
      }
      sockets[symbol].close();
    } catch {}
    delete sockets[symbol];
  }

  // Clear buffer for this symbol to ensure fresh start
  buffers[symbol] = [];

  // Clear any existing reconnect timer
  if (reconnectTimers[symbol]) {
    clearTimeout(reconnectTimers[symbol]);
    delete reconnectTimers[symbol];
  }

  // Clear any existing ping timer
  if (pingTimers[symbol]) {
    clearInterval(pingTimers[symbol]);
    delete pingTimers[symbol];
  }

  try {
    // Bybit public depth stream - use mainnet in production
    const isProduction = process.env.NODE_ENV === 'production';
    const wsUrl = isProduction
      ? 'wss://stream.bybit.com/v5/public/linear'
      : 'wss://stream-testnet.bybit.com/v5/public/linear';
    const ws = new WebSocket(wsUrl);
    sockets[symbol] = ws;

    ws.onopen = () => {
      // console.log(`Order book WebSocket opened for ${symbol}`); // Disabled to reduce console spam
      // Clear any reconnect timer
      if (reconnectTimers[symbol]) {
        clearTimeout(reconnectTimers[symbol]);
        delete reconnectTimers[symbol];
      }
      
      // Subscribe to order book - ensure symbol is uppercase
      const normalizedSymbol = symbol.toUpperCase();
      const sub = { op: 'subscribe', args: [`orderbook.50.${normalizedSymbol}`] };
      // console.log(`Subscribing to order book for ${normalizedSymbol}`); // Disabled to reduce console spam
      ws.send(JSON.stringify(sub));
      
      // Start ping interval to keep connection alive
      pingTimers[symbol] = setInterval(() => {
        if (sockets[symbol] && sockets[symbol].readyState === WebSocket.OPEN) {
          try {
            sockets[symbol].send(JSON.stringify({ op: 'ping' }));
          } catch (err) {
            // console.error(`Failed to ping WebSocket for ${symbol}:`, err); // Disabled for cleaner trade logs
          }
        }
      }, PING_INTERVAL);
    };

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        
        // Handle pong response
        if (msg.op === 'pong') {
          return;
        }
        
        // Handle subscription confirmation
        if (msg.op === 'subscribe') {
          // console.log(`Order book subscription confirmed for ${symbol}`); // Disabled for cleaner trade logs
          if (!msg.success) {
            // console.error(`Order book subscription failed for ${symbol}:`, msg.retMsg); // Disabled for cleaner trade logs
          }
          return;
        }
        
        // Handle error messages
        if (msg.retCode && msg.retCode !== 0) {
          // console.error(`Order book error for ${symbol}:`, msg.retMsg); // Disabled for cleaner trade logs
          return;
        }
        
        if (!msg || !msg.topic || !msg.data) return;
        if (!msg.topic.startsWith('orderbook.')) return;

        const ts = Date.now();
        const { a: asksRaw = [], b: bidsRaw = [] } = msg.data;
        
        if (!Array.isArray(asksRaw) || !Array.isArray(bidsRaw)) {
          // console.warn(`Invalid order book data format for ${symbol}`); // Disabled for cleaner trade logs
          return;
        }
        
        const asks = asksRaw
          .map((x: any) => ({ price: parseFloat(x[0]), size: parseFloat(x[1]) }))
          .filter((e: DepthEntry) => !isNaN(e.price) && !isNaN(e.size) && e.price > 0 && e.size > 0);
        
        const bids = bidsRaw
          .map((x: any) => ({ price: parseFloat(x[0]), size: parseFloat(x[1]) }))
          .filter((e: DepthEntry) => !isNaN(e.price) && !isNaN(e.size) && e.price > 0 && e.size > 0);

        if (asks.length === 0 || bids.length === 0) {
          // console.warn(`Empty order book data for ${symbol}`); // Disabled for cleaner trade logs
          return;
        }

        const snap: DepthSnapshot = { ts, bids, asks };
        const buf = buffers[symbol]!;
        buf.push(snap);
        // keep last N snapshots (~ 10s worth)
        if (buf.length > 120) buf.shift();
      } catch (err) {
        // console.error(`Error processing order book message for ${symbol}:`, err); // Disabled for cleaner trade logs
      }
    };

    ws.onclose = (event) => {
      // console.log(`Order book WebSocket closed for ${symbol}, code: ${event.code}, reason: ${event.reason}`); // Disabled to reduce console spam
      
      // Clear ping timer
      if (pingTimers[symbol]) {
        clearInterval(pingTimers[symbol]);
        delete pingTimers[symbol];
      }
      
      delete sockets[symbol];
      
      // Don't delete buffer on close - keep last snapshot for display
      // Only attempt to reconnect if not a normal closure
      if (event.code !== 1000) {
        reconnectOrderBook(symbol, 1);
      }
    };
    
    ws.onerror = (error) => {
      // console.error(`Order book WebSocket error for ${symbol}:`, error); // Disabled for cleaner trade logs
    };
  } catch (error) {
    // console.error(`Failed to create WebSocket for ${symbol}:`, error); // Disabled for cleaner trade logs
    reconnectOrderBook(symbol, 1);
  }
}

export function stopOrderBook(symbol: string) {
  // Clear reconnect timer
  if (reconnectTimers[symbol]) {
    clearTimeout(reconnectTimers[symbol]);
    delete reconnectTimers[symbol];
  }
  
  // Clear ping timer
  if (pingTimers[symbol]) {
    clearInterval(pingTimers[symbol]);
    delete pingTimers[symbol];
  }
  
  try {
    const ws = sockets[symbol];
    if (ws) {
      // Unsubscribe before closing
      if (ws.readyState === WebSocket.OPEN) {
        const normalizedSymbol = symbol.toUpperCase();
        const unsub = { op: 'unsubscribe', args: [`orderbook.50.${normalizedSymbol}`] };
        ws.send(JSON.stringify(unsub));
      }
      ws.close();
    }
  } catch {}
  delete sockets[symbol];
  // Keep buffer for a bit in case user switches back quickly
  // Buffer will be cleared on next startOrderBook call
}

export async function confirmLevelTouch(params: {
  symbol: string;
  level: number;
  side: Side;
  windowMs: number; // e.g., 8000ms window to observe order book activity
  minNotional: number; // e.g., 50000 USD minimum notional for wall detection
  proximityBps: number; // e.g., 5 → 0.05% proximity to level
}): Promise<boolean> {
  const { symbol, level, side, windowMs, minNotional, proximityBps } = params;
  if (!buffers[symbol]) startOrderBook(symbol);

  const start = Date.now();
  const prox = (proximityBps / 10000) * level;

  return new Promise((resolve) => {
    const timer = setInterval(() => {
      const now = Date.now();
      const buf = buffers[symbol] || [];
      // filter recent snapshots
      const recent = buf.filter((s) => now - s.ts <= windowMs);
      if (!recent.length) {
        if (now - start > windowMs) {
          clearInterval(timer);
          resolve(false);
        }
        return;
      }

      // aggregate notional near level on the relevant side
      // For LONG: look for bid walls (buy-side limit orders) near/below the level
      // For SHORT: look for ask walls (sell-side limit orders) near/above the level
      let notional = 0;
      for (const s of recent) {
        if (side === 'LONG') {
          // LONG entry: need significant buy-side limit orders (bid wall) near/below level
          for (const b of s.bids) {
            if (Math.abs(b.price - level) <= prox && b.price <= level) notional += b.price * b.size;
          }
        } else {
          // SHORT entry: need significant sell-side limit orders (ask wall) near/above level
          for (const a of s.asks) {
            if (Math.abs(a.price - level) <= prox && a.price >= level) notional += a.price * a.size;
          }
        }
      }

      if (notional >= minNotional) {
        clearInterval(timer);
        resolve(true);
      } else if (now - start > windowMs) {
        clearInterval(timer);
        resolve(false);
      }
    }, 150);
  });
}

// Export for visualization
export function getOrderBookSnapshot(symbol: string): DepthSnapshot | null {
  const buf = buffers[symbol];
  if (!buf || buf.length === 0) return null;
  return buf[buf.length - 1];
}
