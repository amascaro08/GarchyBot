type Side = 'LONG' | 'SHORT';

type DepthEntry = { price: number; size: number }; // size in base units
type DepthSnapshot = { ts: number; bids: DepthEntry[]; asks: DepthEntry[] };

const sockets: Record<string, WebSocket> = {};
const buffers: Record<string, DepthSnapshot[]> = {}; // per symbol ring buffer

export function startOrderBook(symbol: string) {
  if (sockets[symbol]) return;
  // Bybit public testnet depth stream (unified)
  const ws = new WebSocket('wss://stream-testnet.bybit.com/v5/public/linear');
  sockets[symbol] = ws;
  buffers[symbol] = [];

  ws.onopen = () => {
    const sub = { op: 'subscribe', args: [`orderbook.50.${symbol}`] };
    ws.send(JSON.stringify(sub));
  };

  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      if (!msg || !msg.topic || !msg.data) return;
      if (!msg.topic.startsWith('orderbook.')) return;

      const ts = Date.now();
      const { a: asksRaw = [], b: bidsRaw = [] } = msg.data;
      const asks = asksRaw.map((x: any) => ({ price: parseFloat(x[0]), size: parseFloat(x[1]) }));
      const bids = bidsRaw.map((x: any) => ({ price: parseFloat(x[0]), size: parseFloat(x[1]) }));

      const snap: DepthSnapshot = { ts, bids, asks };
      const buf = buffers[symbol]!;
      buf.push(snap);
      // keep last N snapshots (~ 10s worth)
      if (buf.length > 120) buf.shift();
    } catch {
      /* ignore */
    }
  };

  ws.onclose = () => {
    delete sockets[symbol];
  };
  ws.onerror = () => {
    /* noop */
  };
}

export function stopOrderBook(symbol: string) {
  try {
    sockets[symbol]?.close();
  } catch {}
  delete sockets[symbol];
  delete buffers[symbol];
}

export async function confirmLevelTouch(params: {
  symbol: string;
  level: number;
  side: Side;
  windowMs: number; // e.g., 8000
  minNotional: number; // e.g., 50_000 USD equiv
  proximityBps: number; // e.g., 5 → 0.05%
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
      let notional = 0;
      for (const s of recent) {
        if (side === 'LONG') {
          // need bid wall near/below level
          for (const b of s.bids) {
            if (Math.abs(b.price - level) <= prox && b.price <= level) notional += b.price * b.size;
          }
        } else {
          // need ask wall near/above level
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
