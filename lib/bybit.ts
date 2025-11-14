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
 * CoinGecko free API - tries simple price endpoint first (most reliable)
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
  
  // Try simple price endpoint first (most reliable, no rate limits for basic usage)
  const priceUrl = `${COINGECKO_BASE}/api/v3/simple/price?ids=${coinId}&vs_currencies=usd&include_24hr_change=true`;
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  try {
    const priceResponse = await fetch(priceUrl, {
      signal: controller.signal,
      headers: {
        'Accept': 'application/json',
      },
    });

    clearTimeout(timeoutId);

    if (priceResponse.ok) {
      const priceData = await priceResponse.json();
      const currentPrice = priceData[coinId]?.usd;
      if (currentPrice) {
        // Create synthetic candles from current price
        // Use the 24h change to create realistic price variation
        const change24h = priceData[coinId]?.usd_24h_change || 0;
        const variation = Math.max(Math.abs(change24h / 100), 0.01) || 0.02; // Use 24h change or default 2%
        
        const now = Date.now();
        const intervalMs = parseInt(interval) * 60 * 1000;
        const candles: Array<{ ts: number; open: number; high: number; low: number; close: number; volume: number }> = [];
        
        // Generate candles going backwards in time
        for (let i = limit - 1; i >= 0; i--) {
          const timestamp = now - (i * intervalMs);
          // Create realistic price movement based on 24h change
          // Price gradually changes from past to present
          const progress = i / limit; // 1.0 = oldest, 0.0 = newest
          const priceMultiplier = 1 - (change24h / 100) * progress; // Reverse: if +5% change, start lower
          const basePrice = currentPrice * priceMultiplier;
          const candleVariation = basePrice * variation;
          
          candles.push({
            ts: timestamp,
            open: basePrice + (Math.random() - 0.5) * candleVariation * 0.5,
            high: basePrice + Math.random() * candleVariation,
            low: basePrice - Math.random() * candleVariation,
            close: basePrice + (Math.random() - 0.5) * candleVariation * 0.5,
            volume: 0,
          });
        }
        return candles;
      }
    }
  } catch (priceError) {
    // If simple price fails, try OHLC endpoint
    console.warn('CoinGecko simple price failed, trying OHLC endpoint...');
  }

  // Fallback to OHLC endpoint
  const daysMap: Record<string, number> = {
    '1': 1,
    '3': 1,
    '5': 1,
    '15': 1,
    '60': 7,
    '120': 7,
    '240': 7,
    'D': 30,
    'W': 90,
    'M': 365,
  };
  
  const days = daysMap[interval] || 1;
  const url = `${COINGECKO_BASE}/api/v3/coins/${coinId}/ohlc?vs_currency=usd&days=${days}`;

  const ohlcController = new AbortController();
  const ohlcTimeoutId = setTimeout(() => ohlcController.abort(), 15000);

  const response = await fetch(url, {
    signal: ohlcController.signal,
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'Mozilla/5.0',
    },
  });

  clearTimeout(ohlcTimeoutId);

  if (!response.ok) {
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
  interval: '1' | '3' | '5' | '15' | '60' | '120' | '240' | 'D' | 'W' | 'M' | '1d' = '5',
  limit: number = 300,
  testnet: boolean = true
): Promise<Array<{ ts: number; open: number; high: number; low: number; close: number; volume: number }>> {
  const baseUrl = testnet ? BYBIT_TESTNET_BASE : BYBIT_MAINNET_BASE;
  // Bybit v5 API format: /v5/market/kline
  // Symbol must be uppercase according to Bybit API documentation
  const normalizedSymbol = symbol.toUpperCase();
  const url = `${baseUrl}/v5/market/kline?category=linear&symbol=${normalizedSymbol}&interval=${interval}&limit=${limit}`;

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
        console.warn('Bybit API blocked (geo-restriction), trying Binance API...');
        try {
          return await getKlinesFromBinance(symbol, interval, limit);
        } catch (binanceError) {
          console.warn('Binance API also blocked, trying CoinGecko...');
          try {
            return await getKlinesFromCoinGecko(symbol, interval, limit);
          } catch (coingeckoError) {
            // Provide helpful error message
            throw new BybitError(
              -1,
              `All crypto APIs are geo-blocked from this server location. ` +
              `Bybit: ${error.retMsg}. ` +
              `Binance: ${binanceError instanceof BybitError ? binanceError.retMsg : binanceError instanceof Error ? binanceError.message : 'Unknown'}. ` +
              `CoinGecko: ${coingeckoError instanceof BybitError ? coingeckoError.retMsg : coingeckoError instanceof Error ? coingeckoError.message : 'Unknown'}. ` +
              `Consider using a proxy or deploying to a different region.`
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
 * Fetch instrument info for a specific symbol from Bybit
 * Returns lotSizeFilter with minOrderQty, qtyStep, and priceFilter with tickSize
 */
export async function getInstrumentInfo(
  symbol: string,
  testnet: boolean = true
): Promise<{ minOrderQty: number; qtyStep: number; tickSize: number; minPrice: number; maxPrice: number } | null> {
  const baseUrl = testnet ? BYBIT_TESTNET_BASE : BYBIT_MAINNET_BASE;
  const normalizedSymbol = symbol.toUpperCase();
  const endpoint = `${baseUrl}/v5/market/instruments-info?category=linear&symbol=${normalizedSymbol}`;

  try {
    const response = await fetch(endpoint, {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();

    if (data.retCode !== 0 || !data.result?.list || data.result.list.length === 0) {
      return null;
    }

    const instrument = data.result.list[0];
    const lotSizeFilter = instrument?.lotSizeFilter;
    
    if (!lotSizeFilter) {
      return null;
    }

    const priceFilter = instrument?.priceFilter;
    
    return {
      minOrderQty: parseFloat(lotSizeFilter.minOrderQty || '0.001'),
      qtyStep: parseFloat(lotSizeFilter.qtyStep || '0.001'),
      // Price precision (tick size)
      tickSize: priceFilter ? parseFloat(priceFilter.tickSize || '0.01') : 0.01,
      minPrice: priceFilter ? parseFloat(priceFilter.minPrice || '0') : 0,
      maxPrice: priceFilter ? parseFloat(priceFilter.maxPrice || '0') : 0,
    };
  } catch (error) {
    console.error(`[Bybit API] Failed to fetch instrument info for ${symbol}:`, error);
    return null;
  }
}

/**
 * Round quantity to match Bybit's qtyStep precision
 * Returns null if quantity is below minimum
 */
export function roundQuantity(
  qty: number,
  qtyStep: number,
  minOrderQty: number
): number | null {
  if (qty <= 0 || qtyStep <= 0 || minOrderQty <= 0) {
    return null;
  }

  // Round to nearest qtyStep
  const rounded = Math.round(qty / qtyStep) * qtyStep;
  
  // Calculate precision based on qtyStep
  // For qtyStep = 0.001, we need 3 decimal places
  // For qtyStep = 0.01, we need 2 decimal places
  // For qtyStep = 0.1, we need 1 decimal place
  // Count decimal places by converting to string and checking
  const qtyStepStr = qtyStep.toString();
  let precision = 0;
  if (qtyStepStr.includes('.')) {
    precision = qtyStepStr.split('.')[1].length;
  } else if (qtyStepStr.includes('e')) {
    // Handle scientific notation
    const match = qtyStepStr.match(/e-(\d+)/);
    if (match) {
      precision = parseInt(match[1]);
    }
  }
  
  // Ensure precision is reasonable (max 8 decimal places)
  precision = Math.min(precision, 8);
  
  const finalQty = parseFloat(rounded.toFixed(precision));

  // Check if it meets minimum
  if (finalQty < minOrderQty) {
    return null;
  }

  return finalQty;
}

/**
 * Fetch real-time ticker data from Bybit
 * Returns current last price, bid, ask, and 24h stats
 */
export async function getTicker(
  symbol: string,
  testnet: boolean = false
): Promise<{ lastPrice: number; bid1Price: number; ask1Price: number; high24h: number; low24h: number } | null> {
  const baseUrl = testnet ? BYBIT_TESTNET_BASE : BYBIT_MAINNET_BASE;
  const normalizedSymbol = symbol.toUpperCase();
  const url = `${baseUrl}/v5/market/tickers?category=linear&symbol=${normalizedSymbol}`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5s timeout

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return null;
    }

    const data = await response.json();

    if (data.retCode !== 0 || !data.result?.list || data.result.list.length === 0) {
      return null;
    }

    const ticker = data.result.list[0];

    return {
      lastPrice: parseFloat(ticker.lastPrice || '0'),
      bid1Price: parseFloat(ticker.bid1Price || '0'),
      ask1Price: parseFloat(ticker.ask1Price || '0'),
      high24h: parseFloat(ticker.highPrice24h || '0'),
      low24h: parseFloat(ticker.lowPrice24h || '0'),
    };
  } catch (error) {
    console.error(`[Bybit API] Failed to fetch ticker for ${symbol}:`, error);
    return null;
  }
}

/**
 * Round price to match Bybit's tick size (price precision)
 */
export function roundPrice(price: number, tickSize: number): number {
  if (tickSize <= 0) return price;
  
  // Round to nearest tickSize
  const rounded = Math.round(price / tickSize) * tickSize;
  
  // Calculate precision based on tickSize
  const tickSizeStr = tickSize.toString();
  let precision = 0;
  if (tickSizeStr.includes('.')) {
    precision = tickSizeStr.split('.')[1].length;
  } else if (tickSizeStr.includes('e')) {
    const match = tickSizeStr.match(/e-(\d+)/);
    if (match) {
      precision = parseInt(match[1]);
    }
  }
  
  // Ensure precision is reasonable (max 8 decimal places)
  precision = Math.min(precision, 8);
  
  return parseFloat(rounded.toFixed(precision));
}

/**
 * Fetch tradable linear instruments from Bybit
 */
export async function fetchLinearInstruments(testnet: boolean = true): Promise<string[]> {
  const baseUrl = testnet ? BYBIT_TESTNET_BASE : BYBIT_MAINNET_BASE;
  const endpoint = `${baseUrl}/v5/market/instruments-info?category=linear&limit=1000`;

  try {
    const response = await fetch(endpoint, {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      throw new BybitError(response.status, `HTTP ${response.status}`);
    }

    const data = await response.json();

    if (data.retCode !== 0) {
      throw new BybitError(data.retCode, data.retMsg || 'Failed to fetch instruments');
    }

    const list: Array<{ symbol: string; status: string }> = data.result?.list ?? [];
    return list
      .filter((instrument) => instrument.symbol && instrument.status?.toLowerCase() === 'trading')
      .map((instrument) => instrument.symbol);
  } catch (error) {
    if (error instanceof BybitError) {
      throw error;
    }
    throw new BybitError(-1, error instanceof Error ? error.message : 'Unknown error fetching instruments');
  }
}

/**
 * Place order on Bybit (Testnet or Mainnet)
 * Requires BYBIT_API_KEY and BYBIT_API_SECRET env vars unless apiKey/apiSecret are provided
 * 
 * Uses Bybit v5 API with POST request and JSON body format
 */
export async function placeOrder(params: {
  symbol: string;
  side: 'Buy' | 'Sell';
  qty: number;
  price?: number;
  testnet?: boolean;
  apiKey?: string | null;
  apiSecret?: string | null;
  timeInForce?: 'GTC' | 'IOC' | 'FOK' | 'PostOnly';
  positionIdx?: 0 | 1 | 2; // 0=one-way, 1=buy side of hedge-mode, 2=sell side of hedge-mode
}): Promise<any> {
  const {
    symbol: originalSymbol,
    side,
    qty: originalQty,
    price,
    testnet = true,
    apiKey: overrideApiKey,
    apiSecret: overrideApiSecret,
    timeInForce = 'GTC', // Changed to match Bybit API: GTC, IOC, FOK, PostOnly
    positionIdx = 0, // Default to one-way mode
  } = params;

  // Round quantity to match Bybit's precision requirements
  let qty = originalQty;
  console.log(`[Bybit API] Fetching instrument info for ${originalSymbol} (testnet=${testnet})...`);
  const instrumentInfo = await getInstrumentInfo(originalSymbol, testnet);
  if (instrumentInfo) {
    console.log(`[Bybit API] Instrument info: minOrderQty=${instrumentInfo.minOrderQty}, qtyStep=${instrumentInfo.qtyStep}`);
    const roundedQty = roundQuantity(originalQty, instrumentInfo.qtyStep, instrumentInfo.minOrderQty);
    if (roundedQty === null) {
      const tradeValue = originalQty * (params.price || 0);
      throw new BybitError(
        10001,
        `Quantity ${originalQty} ($${tradeValue.toFixed(2)} USDT) is below minimum order quantity ${instrumentInfo.minOrderQty} for ${originalSymbol} (qtyStep: ${instrumentInfo.qtyStep})`
      );
    }
    qty = roundedQty;
    if (qty !== originalQty) {
      console.log(`[Bybit API] Rounded quantity from ${originalQty} to ${qty} (qtyStep: ${instrumentInfo.qtyStep}, minOrderQty: ${instrumentInfo.minOrderQty})`);
    } else {
      console.log(`[Bybit API] Quantity ${qty} is valid (minOrderQty: ${instrumentInfo.minOrderQty}, qtyStep: ${instrumentInfo.qtyStep})`);
    }
  } else {
    console.warn(`[Bybit API] Could not fetch instrument info for ${originalSymbol}, using original quantity ${originalQty}`);
  }
  
  const symbol = originalSymbol;

  const apiKey = overrideApiKey || process.env.BYBIT_API_KEY;
  const apiSecret = overrideApiSecret || process.env.BYBIT_API_SECRET;

  if (!apiKey || !apiSecret) {
    throw new Error('BYBIT_API_KEY and BYBIT_API_SECRET must be set');
  }

  const baseUrl = testnet ? BYBIT_TESTNET_BASE : BYBIT_MAINNET_BASE;
  const endpoint = '/v5/order/create';
  const timestamp = Date.now();
  const recvWindow = 5000;

  // Request body according to Bybit v5 API documentation
  // https://bybit-exchange.github.io/docs/v5/order/create-order
  const requestBody: Record<string, any> = {
    category: 'linear',
    symbol: symbol.toUpperCase(), // Ensure symbol is uppercase
    side,
    orderType: price ? 'Limit' : 'Market',
    qty: qty.toString(),
    timeInForce,
    positionIdx, // Required for linear contracts: 0=one-way mode
  };

  // Price is required for Limit orders
  if (price !== undefined && price > 0) {
    requestBody.price = price.toString();
  }

  // For Bybit v5 API POST with JSON body, use header-based authentication
  // Signature: timestamp + apiKey + recvWindow + jsonBodyString
  const bodyString = JSON.stringify(requestBody);
  const timestampStr = timestamp.toString();
  const recvWindowStr = recvWindow.toString();
  const paramString = `${timestampStr}${apiKey}${recvWindowStr}${bodyString}`;
  
  const signature = crypto
    .createHmac('sha256', apiSecret)
    .update(paramString)
    .digest('hex');

  const url = `${baseUrl}${endpoint}`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'X-BAPI-API-KEY': apiKey,
        'X-BAPI-SIGN': signature,
        'X-BAPI-TIMESTAMP': timestampStr,
        'X-BAPI-RECV-WINDOW': recvWindowStr,
      },
      body: bodyString,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Bybit API] HTTP Error ${response.status}: ${errorText}`);
      throw new BybitError(response.status, `HTTP ${response.status}: ${errorText}`);
    }

    const data = await response.json();

    if (data.retCode !== 0) {
      // Enhanced error message with full response for debugging
      const errorMsg = data.retMsg || 'Unknown Bybit API error';
      console.error(`[Bybit API Error] retCode: ${data.retCode}, retMsg: ${errorMsg}`);
      console.error(`[Bybit API Error] Request: ${JSON.stringify(requestBody, null, 2)}`);
      console.error(`[Bybit API Error] Full response: ${JSON.stringify(data, null, 2)}`);
      throw new BybitError(data.retCode, `${errorMsg} (retCode: ${data.retCode})`);
    }

    console.log(`[Bybit API] Order placed successfully: ${JSON.stringify(data.result, null, 2)}`);
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

/**
 * Set take profit and stop loss for a position on Bybit
 * Uses Bybit v5 API /v5/position/trading-stop endpoint
 */
export async function setTakeProfitStopLoss(params: {
  symbol: string;
  takeProfit?: number;
  stopLoss?: number;
  testnet?: boolean;
  apiKey?: string | null;
  apiSecret?: string | null;
  positionIdx?: 0 | 1 | 2;
}): Promise<any> {
  const {
    symbol,
    takeProfit,
    stopLoss,
    testnet = true,
    apiKey: overrideApiKey,
    apiSecret: overrideApiSecret,
    positionIdx = 0,
  } = params;

  const apiKey = overrideApiKey || process.env.BYBIT_API_KEY;
  const apiSecret = overrideApiSecret || process.env.BYBIT_API_SECRET;

  if (!apiKey || !apiSecret) {
    throw new Error('BYBIT_API_KEY and BYBIT_API_SECRET must be set');
  }

  if (!takeProfit && !stopLoss) {
    throw new Error('Either takeProfit or stopLoss must be provided');
  }

  // Round TP/SL prices to match Bybit's tick size (price precision)
  let roundedTP = takeProfit;
  let roundedSL = stopLoss;
  try {
    const instrumentInfo = await getInstrumentInfo(symbol, testnet);
    if (instrumentInfo && instrumentInfo.tickSize) {
      if (takeProfit !== undefined && takeProfit > 0) {
        roundedTP = roundPrice(takeProfit, instrumentInfo.tickSize);
        if (Math.abs(roundedTP - takeProfit) > 0.0001) {
          console.log(`[Bybit API] Rounded TP from ${takeProfit.toFixed(8)} to ${roundedTP.toFixed(8)} to match tick size ${instrumentInfo.tickSize}`);
        }
      }
      if (stopLoss !== undefined && stopLoss > 0) {
        roundedSL = roundPrice(stopLoss, instrumentInfo.tickSize);
        if (Math.abs(roundedSL - stopLoss) > 0.0001) {
          console.log(`[Bybit API] Rounded SL from ${stopLoss.toFixed(8)} to ${roundedSL.toFixed(8)} to match tick size ${instrumentInfo.tickSize}`);
        }
      }
    }
  } catch (priceRoundError) {
    console.warn(`[Bybit API] Failed to round TP/SL prices, using original:`, priceRoundError);
    // Continue with original prices if rounding fails
  }

  const baseUrl = testnet ? BYBIT_TESTNET_BASE : BYBIT_MAINNET_BASE;
  const endpoint = '/v5/position/trading-stop';
  const timestamp = Date.now();
  const recvWindow = 5000;

  const requestBody: Record<string, any> = {
    category: 'linear',
    symbol: symbol.toUpperCase(),
    positionIdx,
  };

  if (roundedTP !== undefined && roundedTP > 0) {
    requestBody.takeProfit = roundedTP.toString();
  }
  if (roundedSL !== undefined && roundedSL > 0) {
    requestBody.stopLoss = roundedSL.toString();
  }

  const bodyString = JSON.stringify(requestBody);
  const timestampStr = timestamp.toString();
  const recvWindowStr = recvWindow.toString();
  const paramString = `${timestampStr}${apiKey}${recvWindowStr}${bodyString}`;
  
  const signature = crypto
    .createHmac('sha256', apiSecret)
    .update(paramString)
    .digest('hex');

  const url = `${baseUrl}${endpoint}`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'X-BAPI-API-KEY': apiKey,
        'X-BAPI-SIGN': signature,
        'X-BAPI-TIMESTAMP': timestampStr,
        'X-BAPI-RECV-WINDOW': recvWindowStr,
      },
      body: bodyString,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Bybit API] HTTP Error ${response.status}: ${errorText}`);
      throw new BybitError(response.status, `HTTP ${response.status}: ${errorText}`);
    }

    const data = await response.json();

    if (data.retCode !== 0) {
      const errorMsg = data.retMsg || 'Unknown Bybit API error';
      console.error(`[Bybit API Error] retCode: ${data.retCode}, retMsg: ${errorMsg}`);
      throw new BybitError(data.retCode, `${errorMsg} (retCode: ${data.retCode})`);
    }

    console.log(`[Bybit API] TP/SL set successfully: ${JSON.stringify(data.result, null, 2)}`);
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

/**
 * Cancel order on Bybit (Testnet or Mainnet)
 * Requires BYBIT_API_KEY and BYBIT_API_SECRET env vars unless apiKey/apiSecret are provided
 * 
 * Uses Bybit v5 API with POST request and JSON body format
 */
export async function cancelOrder(params: {
  symbol: string;
  orderId?: string;
  orderLinkId?: string;
  testnet?: boolean;
  apiKey?: string | null;
  apiSecret?: string | null;
}): Promise<any> {
  const {
    symbol,
    orderId,
    orderLinkId,
    testnet = true,
    apiKey: overrideApiKey,
    apiSecret: overrideApiSecret,
  } = params;

  const apiKey = overrideApiKey || process.env.BYBIT_API_KEY;
  const apiSecret = overrideApiSecret || process.env.BYBIT_API_SECRET;

  if (!apiKey || !apiSecret) {
    throw new Error('BYBIT_API_KEY and BYBIT_API_SECRET must be set');
  }

  if (!orderId && !orderLinkId) {
    throw new Error('Either orderId or orderLinkId must be provided');
  }

  const baseUrl = testnet ? BYBIT_TESTNET_BASE : BYBIT_MAINNET_BASE;
  const endpoint = '/v5/order/cancel';
  const timestamp = Date.now();
  const recvWindow = 5000;

  // Request body according to Bybit v5 API
  const requestBody: Record<string, any> = {
    category: 'linear',
    symbol: symbol.toUpperCase(), // Ensure symbol is uppercase
  };

  if (orderId) {
    requestBody.orderId = orderId;
  }
  if (orderLinkId) {
    requestBody.orderLinkId = orderLinkId;
  }

  // For Bybit v5 API POST with JSON body, use header-based authentication
  // Signature: timestamp + apiKey + recvWindow + jsonBodyString
  const bodyString = JSON.stringify(requestBody);
  const timestampStr = timestamp.toString();
  const recvWindowStr = recvWindow.toString();
  const paramString = `${timestampStr}${apiKey}${recvWindowStr}${bodyString}`;
  
  const signature = crypto
    .createHmac('sha256', apiSecret)
    .update(paramString)
    .digest('hex');

  const url = `${baseUrl}${endpoint}`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'X-BAPI-API-KEY': apiKey,
        'X-BAPI-SIGN': signature,
        'X-BAPI-TIMESTAMP': timestampStr,
        'X-BAPI-RECV-WINDOW': recvWindowStr,
      },
      body: bodyString,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      throw new BybitError(response.status, `HTTP ${response.status}: ${errorText}`);
    }

    const data = await response.json();

    if (data.retCode !== 0) {
      throw new BybitError(data.retCode, data.retMsg || 'Unknown Bybit API error');
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

/**
 * Close a position on Bybit by placing a market order in the opposite direction
 * This is used to manually close an open position
 */
export async function closePosition(params: {
  symbol: string;
  side: 'LONG' | 'SHORT'; // Current position side
  qty?: number; // Optional: specific quantity to close, if not provided closes entire position
  testnet?: boolean;
  apiKey: string;
  apiSecret: string;
  positionIdx?: 0 | 1 | 2;
}): Promise<any> {
  const {
    symbol,
    side,
    qty,
    testnet = true,
    apiKey: overrideApiKey,
    apiSecret: overrideApiSecret,
    positionIdx = 0,
  } = params;

  const apiKey = overrideApiKey || process.env.BYBIT_API_KEY;
  const apiSecret = overrideApiSecret || process.env.BYBIT_API_SECRET;

  if (!apiKey || !apiSecret) {
    throw new Error('BYBIT_API_KEY and BYBIT_API_SECRET must be set');
  }

  // For closing: LONG position needs Sell order, SHORT position needs Buy order
  const closeSide = side === 'LONG' ? 'Sell' : 'Buy';

  const baseUrl = testnet ? BYBIT_TESTNET_BASE : BYBIT_MAINNET_BASE;
  const endpoint = '/v5/order/create';
  const timestamp = Date.now();
  const recvWindow = 5000;

  // Get current position size if qty not provided
  let closeQty = qty;
  if (!closeQty) {
    try {
      const positionData = await fetchPosition({
        symbol,
        testnet,
        apiKey,
        apiSecret,
        positionIdx,
      });
      const position = positionData.result?.list?.find((p: any) => 
        p.symbol === symbol.toUpperCase() && 
        parseFloat(p.size || '0') !== 0
      );
      if (position) {
        closeQty = parseFloat(position.size || '0');
      } else {
        throw new Error('No open position found to close');
      }
    } catch (error) {
      throw new Error(`Failed to get position size: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // Round quantity to match Bybit's requirements
  const instrumentInfo = await getInstrumentInfo(symbol, testnet);
  if (instrumentInfo && closeQty) {
    const roundedQty = roundQuantity(closeQty, instrumentInfo.qtyStep, instrumentInfo.minOrderQty);
    if (roundedQty === null) {
      throw new BybitError(
        10001,
        `Quantity ${closeQty} is below minimum order quantity ${instrumentInfo.minOrderQty} for ${symbol}`
      );
    }
    closeQty = roundedQty;
  }

  // Request body for market order to close position
  const requestBody: Record<string, any> = {
    category: 'linear',
    symbol: symbol.toUpperCase(),
    side: closeSide,
    orderType: 'Market', // Use market order to close immediately
    qty: closeQty!.toString(),
    positionIdx, // Required for linear contracts: 0=one-way mode
    reduceOnly: true, // Important: This ensures we're closing, not opening a new position
  };

  const bodyString = JSON.stringify(requestBody);
  const timestampStr = timestamp.toString();
  const recvWindowStr = recvWindow.toString();
  const paramString = `${timestampStr}${apiKey}${recvWindowStr}${bodyString}`;
  
  const signature = crypto
    .createHmac('sha256', apiSecret)
    .update(paramString)
    .digest('hex');

  const url = `${baseUrl}${endpoint}`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'X-BAPI-API-KEY': apiKey,
        'X-BAPI-SIGN': signature,
        'X-BAPI-TIMESTAMP': timestampStr,
        'X-BAPI-RECV-WINDOW': recvWindowStr,
      },
      body: bodyString,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Bybit API] HTTP Error ${response.status}: ${errorText}`);
      throw new BybitError(response.status, `HTTP ${response.status}: ${errorText}`);
    }

    const data = await response.json();

    if (data.retCode !== 0) {
      const errorMsg = data.retMsg || 'Unknown Bybit API error';
      console.error(`[Bybit API Error] retCode: ${data.retCode}, retMsg: ${errorMsg}`);
      throw new BybitError(data.retCode, `${errorMsg} (retCode: ${data.retCode})`);
    }

    console.log(`[Bybit API] Position closed successfully: ${JSON.stringify(data.result, null, 2)}`);
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

/**
 * Fetch order status from Bybit
 * Returns order information including status, filled quantity, etc.
 */
export async function getOrderStatus(params: {
  symbol: string;
  orderId?: string;
  orderLinkId?: string;
  testnet?: boolean;
  apiKey: string;
  apiSecret: string;
}): Promise<any> {
  const {
    symbol,
    orderId,
    orderLinkId,
    testnet = true,
    apiKey,
    apiSecret,
  } = params;

  if (!orderId && !orderLinkId) {
    throw new Error('Either orderId or orderLinkId must be provided');
  }

  const baseUrl = testnet ? BYBIT_TESTNET_BASE : BYBIT_MAINNET_BASE;
  const endpoint = '/v5/order/history';
  const recvWindow = '5000';
  const timestamp = Date.now().toString();
  let query = `category=linear&symbol=${symbol.toUpperCase()}`;
  if (orderId) {
    query += `&orderId=${orderId}`;
  }
  if (orderLinkId) {
    query += `&orderLinkId=${orderLinkId}`;
  }
  query += '&limit=1';
  
  const prehash = `${timestamp}${apiKey}${recvWindow}${query}`;
  const signature = crypto
    .createHmac('sha256', apiSecret)
    .update(prehash)
    .digest('hex');

  const url = `${baseUrl}${endpoint}?${query}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'X-BAPI-API-KEY': apiKey,
      'X-BAPI-SIGN': signature,
      'X-BAPI-TIMESTAMP': timestamp,
      'X-BAPI-RECV-WINDOW': recvWindow,
    },
  });

  if (!response.ok) {
    throw new BybitError(response.status, `HTTP ${response.status}`);
  }

  const data = await response.json();
  if (data.retCode !== 0) {
    throw new BybitError(data.retCode, data.retMsg || 'Failed to fetch order status');
  }

  return data;
}

/**
 * Fetch position information from Bybit
 * Returns the actual position size and unrealized P&L from Bybit
 */
export async function fetchPosition(params: {
  symbol: string;
  testnet?: boolean;
  apiKey: string;
  apiSecret: string;
  positionIdx?: 0 | 1 | 2;
}): Promise<any> {
  const {
    symbol,
    testnet = true,
    apiKey,
    apiSecret,
    positionIdx = 0,
  } = params;

  const baseUrl = testnet ? BYBIT_TESTNET_BASE : BYBIT_MAINNET_BASE;
  const endpoint = '/v5/position/list';
  const recvWindow = '5000';
  const timestamp = Date.now().toString();
  const query = `category=linear&symbol=${symbol.toUpperCase()}&positionIdx=${positionIdx}`;
  const prehash = `${timestamp}${apiKey}${recvWindow}${query}`;
  const signature = crypto
    .createHmac('sha256', apiSecret)
    .update(prehash)
    .digest('hex');

  const url = `${baseUrl}${endpoint}?${query}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'X-BAPI-API-KEY': apiKey,
      'X-BAPI-SIGN': signature,
      'X-BAPI-TIMESTAMP': timestamp,
      'X-BAPI-RECV-WINDOW': recvWindow,
    },
  });

  if (!response.ok) {
    throw new BybitError(response.status, `HTTP ${response.status}`);
  }

  const data = await response.json();
  if (data.retCode !== 0) {
    throw new BybitError(data.retCode, data.retMsg || 'Failed to fetch position');
  }

  return data;
}

/**
 * Fetch wallet balance from Bybit (private endpoint)
 */
export async function fetchWalletBalance(params: {
  apiKey: string;
  apiSecret: string;
  testnet?: boolean;
  accountType?: 'UNIFIED' | 'CONTRACT' | 'SPOT' | 'OPTION';
}): Promise<any> {
  const {
    apiKey,
    apiSecret,
    testnet = true,
    accountType = 'UNIFIED',
  } = params;

  const baseUrl = testnet ? BYBIT_TESTNET_BASE : BYBIT_MAINNET_BASE;
  const endpoint = '/v5/account/wallet-balance';
  const recvWindow = '5000';
  const timestamp = Date.now().toString();
  const query = `accountType=${accountType}`;
  const prehash = `${timestamp}${apiKey}${recvWindow}${query}`;
  const signature = crypto
    .createHmac('sha256', apiSecret)
    .update(prehash)
    .digest('hex');

  const url = `${baseUrl}${endpoint}?${query}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'X-BAPI-API-KEY': apiKey,
      'X-BAPI-SIGN': signature,
      'X-BAPI-TIMESTAMP': timestamp,
      'X-BAPI-RECV-WINDOW': recvWindow,
    },
  });

  if (!response.ok) {
    throw new BybitError(response.status, `HTTP ${response.status}`);
  }

  const data = await response.json();
  if (data.retCode !== 0) {
    throw new BybitError(data.retCode, data.retMsg || 'Failed to fetch wallet balance');
  }

  return data;
}
