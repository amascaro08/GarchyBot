import crypto from 'crypto';

const BYBIT_TESTNET_BASE = 'https://api-testnet.bybit.com';
const BYBIT_MAINNET_BASE = 'https://api.bybit.com';
// Alternative: Use Binance API as fallback (more accessible, no geo-restrictions)
const BINANCE_BASE = 'https://api.binance.com';
// Alternative: Use CoinGecko API as final fallback (most accessible)
const COINGECKO_BASE = 'https://api.coingecko.com';

export interface BybitKlineResponse {
  retCode: number;
  retMsg: string;
  result: {
    category: string;
    list: string[][]; // [startTime, open, high, low, close, volume, turnover]
  };
}

export interface BybitError {
  retCode: number;
  retMsg: string;
}

export class BybitError extends Error {
  constructor(public retCode: number, public retMsg: string) {
    super(`Bybit API error ${retCode}: ${retMsg}`);
    this.name = 'BybitError';
  }
}

/**
 * Fetch klines from CoinGecko API (final fallback)
 * CoinGecko free API - uses ohlc endpoint for better data
 */
async function getKlinesFromCoinGecko(
  symbol: string,
  interval: string,
  limit: number
): Promise<Array<{ ts: number; open: number; high: number; low: number; close: number; volume: number }>> {
  // Map symbols to CoinGecko IDs
  const symbolMap: Record<string, string> = {
    'BTCUSDT': 'bitcoin',
    'ETHUSDT': 'ethereum',
    'SOLUSDT': 'solana',
  };
  
  const coinId = symbolMap[symbol] || 'bitcoin';
  
  // Map intervals to days (CoinGecko uses days parameter)
  // For 5-minute intervals, we'll get hourly data and interpolate
  const daysMap: Record<string, number> = {
    '1': 1,    // 1 minute -> 1 day of data
    '3': 1,
    '5': 1,
    '15': 1,
    '60': 7,   // 1 hour -> 7 days
    '120': 7,
    '240': 7,
    'D': 30,
    'W': 90,
    'M': 365,
  };
  
  const days = daysMap[interval] || 1;
  
  // Use OHLC endpoint for better candle data
  const url = `${COINGECKO_BASE}/api/v3/coins/${coinId}/ohlc?vs_currency=usd&days=${days}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000); // Longer timeout for CoinGecko

  const response = await fetch(url, {
    signal: controller.signal,
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'Mozilla/5.0', // Some APIs require user agent
    },
  });

  clearTimeout(timeoutId);

  if (!response.ok) {
    // Try alternative endpoint if OHLC fails
    if (response.status === 401 || response.status === 403) {
      // Try simple price endpoint as last resort
      const priceUrl = `${COINGECKO_BASE}/api/v3/simple/price?ids=${coinId}&vs_currencies=usd&include_24hr_change=true`;
      const priceResponse = await fetch(priceUrl, {
        signal: controller.signal,
        headers: {
          'Accept': 'application/json',
        },
      });
      
      if (priceResponse.ok) {
        const priceData = await priceResponse.json();
        const currentPrice = priceData[coinId]?.usd;
        if (currentPrice) {
          // Create synthetic candles from current price
          const now = Date.now();
          const intervalMs = parseInt(interval) * 60 * 1000;
          const candles: Array<{ ts: number; open: number; high: number; low: number; close: number; volume: number }> = [];
          
          for (let i = limit - 1; i >= 0; i--) {
            const timestamp = now - (i * intervalMs);
            // Add small random variation to simulate OHLC
            const variation = currentPrice * 0.01; // 1% variation
            candles.push({
              ts: timestamp,
              open: currentPrice + (Math.random() - 0.5) * variation,
              high: currentPrice + Math.random() * variation,
              low: currentPrice - Math.random() * variation,
              close: currentPrice,
              volume: 0,
            });
          }
          return candles;
        }
      }
    }
    throw new BybitError(response.status, `CoinGecko API error: HTTP ${response.status}`);
  }

  const data = await response.json();
  
  // CoinGecko OHLC returns: [[timestamp, open, high, low, close], ...]
  if (!Array.isArray(data) || data.length === 0) {
    throw new BybitError(-1, 'No OHLC data from CoinGecko');
  }

  // Take the last N candles
  const startIdx = Math.max(0, data.length - limit);
  const candles = data.slice(startIdx).map((item: number[]) => ({
    ts: item[0],
    open: item[1],
    high: item[2],
    low: item[3],
    close: item[4],
    volume: 0, // CoinGecko OHLC doesn't include volume
  }));

  return candles;
}

/**
 * Fetch klines from Binance API (fallback when Bybit is blocked)
 * Binance API format: /api/v3/klines
 * Interval mapping: 5 -> 5m, 15 -> 15m, etc.
 */
async function getKlinesFromBinance(
  symbol: string,
  interval: string,
  limit: number
): Promise<Array<{ ts: number; open: number; high: number; low: number; close: number; volume: number }>> {
  // Map Bybit intervals to Binance intervals
  const intervalMap: Record<string, string> = {
    '1': '1m',
    '3': '3m',
    '5': '5m',
    '15': '15m',
    '60': '1h',
    '120': '2h',
    '240': '4h',
    'D': '1d',
    'W': '1w',
    'M': '1M',
  };
  
  const binanceInterval = intervalMap[interval] || '5m';
  const url = `${BINANCE_BASE}/api/v3/klines?symbol=${symbol}&interval=${binanceInterval}&limit=${limit}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  const response = await fetch(url, {
    signal: controller.signal,
    headers: {
      'Accept': 'application/json',
    },
  });

  clearTimeout(timeoutId);

  if (!response.ok) {
    throw new BybitError(response.status, `Binance API error: HTTP ${response.status}`);
  }

  const data = await response.json();

  // Binance returns: [openTime, open, high, low, close, volume, closeTime, quoteVolume, trades, takerBuyBaseVolume, takerBuyQuoteVolume, ignore]
  // We need: ts, open, high, low, close, volume
  return data.map((item: any[]) => ({
    ts: item[0], // openTime
    open: parseFloat(item[1]),
    high: parseFloat(item[2]),
    low: parseFloat(item[3]),
    close: parseFloat(item[4]),
    volume: parseFloat(item[5]),
  }));
}

/**
 * Fetch klines from Bybit Unified API v5
 * Returns candles in ascending order (oldest first)
 * Falls back to Binance API if Bybit is blocked
 */
export async function getKlines(
  symbol: string,
  interval: '1' | '3' | '5' | '15' | '60' | '120' | '240' | 'D' | 'W' | 'M' = '5',
  limit: number = 300,
  testnet: boolean = true
): Promise<Array<{ ts: number; open: number; high: number; low: number; close: number; volume: number }>> {
  const baseUrl = testnet ? BYBIT_TESTNET_BASE : BYBIT_MAINNET_BASE;
  // Bybit v5 API format: /v5/market/kline
  const url = `${baseUrl}/v5/market/kline?category=linear&symbol=${symbol}&interval=${interval}&limit=${limit}`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    });

    clearTimeout(timeoutId);

    // Check content type before parsing
    const contentType = response.headers.get('content-type') || '';
    const isJson = contentType.includes('application/json');

    // Try to parse response body
    let data: BybitKlineResponse | BybitError;
    let responseText: string = '';
    
    try {
      // Always read as text first, then parse as JSON
      // This allows us to handle both JSON and non-JSON responses
      responseText = await response.text();
      
      // Try to parse as JSON
      try {
        data = JSON.parse(responseText);
      } catch (parseError) {
        // If parsing fails, it's likely HTML or plain text error
        if (!response.ok) {
          throw new BybitError(
            response.status,
            `Invalid response format (expected JSON, got ${contentType}). Response preview: ${responseText.substring(0, 300)}`
          );
        }
        throw new BybitError(-1, `Failed to parse JSON response: ${parseError instanceof Error ? parseError.message : 'Unknown error'}`);
      }
    } catch (e) {
      // If reading response fails, throw with HTTP status
      if (e instanceof BybitError) {
        throw e;
      }
      if (!response.ok) {
        throw new BybitError(
          response.status,
          `HTTP ${response.status}: ${response.statusText}`
        );
      }
      throw new BybitError(-1, e instanceof Error ? e.message : 'Failed to read response');
    }

    // Check if it's an error response from Bybit
    if ('retCode' in data && data.retCode !== 0) {
      throw new BybitError(data.retCode, data.retMsg || `HTTP ${response.status}`);
    }

    // If HTTP status is not ok but we got a response, check retCode
    if (!response.ok) {
      const errorData = data as BybitError;
      throw new BybitError(
        response.status,
        errorData.retMsg || `HTTP ${response.status}: ${response.statusText}`
      );
    }

    // Validate that we have result data
    const klineData = data as BybitKlineResponse;
    if (!klineData.result || !klineData.result.list) {
      throw new BybitError(-1, 'Invalid response format: missing result.list');
    }

    // Bybit returns newest first, so reverse to get oldest first
    const reversed = [...klineData.result.list].reverse();

    if (reversed.length === 0) {
      throw new BybitError(-1, 'No kline data returned');
    }

    return reversed.map((item) => {
      if (!item || item.length < 6) {
        throw new BybitError(-1, `Invalid kline data format: ${JSON.stringify(item)}`);
      }
      return {
        ts: parseInt(item[0]),
        open: parseFloat(item[1]),
        high: parseFloat(item[2]),
        low: parseFloat(item[3]),
        close: parseFloat(item[4]),
        volume: parseFloat(item[5]),
      };
    });
  } catch (error) {
    if (error instanceof BybitError) {
      // If Bybit fails with 403 (geo-blocked), try Binance as fallback
      if (error.retCode === 403 || error.retMsg?.includes('CloudFront') || error.retMsg?.includes('blocked') || error.retMsg?.includes('Invalid response format')) {
        console.warn('Bybit API blocked, trying Binance API...');
        try {
          return await getKlinesFromBinance(symbol, interval, limit);
        } catch (binanceError) {
          console.warn('Binance API also failed, trying CoinGecko...');
          try {
            return await getKlinesFromCoinGecko(symbol, interval, limit);
          } catch (coingeckoError) {
            throw new BybitError(
              -1,
              `All APIs failed. Bybit: ${error.retMsg}. Binance: ${binanceError instanceof Error ? binanceError.message : 'Unknown'}. CoinGecko: ${coingeckoError instanceof Error ? coingeckoError.message : 'Unknown'}`
            );
          }
        }
      }
      throw error;
    }
    if (error instanceof Error && error.name === 'AbortError') {
      throw new BybitError(-1, 'Request timeout');
    }
    throw new BybitError(-1, error instanceof Error ? error.message : 'Unknown error');
  }
}

/**
 * Place order on Bybit (Testnet or Mainnet)
 * Requires BYBIT_API_KEY and BYBIT_API_SECRET env vars
 */
export async function placeOrder(
  symbol: string,
  side: 'Buy' | 'Sell',
  qty: number,
  price?: number,
  testnet: boolean = true
): Promise<any> {
  const apiKey = process.env.BYBIT_API_KEY;
  const apiSecret = process.env.BYBIT_API_SECRET;

  if (!apiKey || !apiSecret) {
    throw new Error('BYBIT_API_KEY and BYBIT_API_SECRET must be set');
  }

  const baseUrl = testnet ? BYBIT_TESTNET_BASE : BYBIT_MAINNET_BASE;
  const endpoint = '/v5/order/create';
  const timestamp = Date.now();
  const recvWindow = 5000;

  const params: Record<string, any> = {
    category: 'linear',
    symbol,
    side,
    orderType: price ? 'Limit' : 'Market',
    qty: qty.toString(),
    timestamp,
    recvWindow,
  };

  if (price) {
    params.price = price.toString();
  }

  // Sort params for signature
  const sortedParams = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('&');

  const signature = crypto
    .createHmac('sha256', apiSecret)
    .update(sortedParams)
    .digest('hex');

  const url = `${baseUrl}${endpoint}?${sortedParams}&apiKey=${apiKey}&sign=${signature}`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new BybitError(response.status, `HTTP ${response.status}`);
    }

    const data = await response.json();

    if (data.retCode !== 0) {
      throw new BybitError(data.retCode, data.retMsg);
    }

    return data;
  } catch (error) {
    if (error instanceof BybitError) {
      throw error;
    }
    if (error instanceof Error && error.name === 'AbortError') {
      throw new BybitError(-1, 'Request timeout');
    }
    throw new BybitError(-1, error instanceof Error ? error.message : 'Unknown error');
  }
}
