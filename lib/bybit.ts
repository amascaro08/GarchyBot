import crypto from 'crypto';

const BYBIT_TESTNET_BASE = 'https://api-testnet.bybit.com';
const BYBIT_MAINNET_BASE = 'https://api.bybit.com';

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
 * Fetch klines from Bybit Unified API v5
 * Returns candles in ascending order (oldest first)
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
