/**
 * Bybit Conditional Orders - Real-time Entry Execution
 * 
 * Instead of waiting for cron to detect signals, this places conditional orders
 * that trigger INSTANTLY when price touches your signal levels.
 * 
 * Latency improvement: 60+ seconds → microseconds
 */

import { createHmac } from 'crypto';

interface ConditionalOrderParams {
  symbol: string;
  side: 'Buy' | 'Sell';
  triggerPrice: number;
  qty: number;
  takeProfit?: number;
  stopLoss?: number;
  testnet: boolean;
  apiKey: string;
  apiSecret: string;
}

interface ConditionalOrderResponse {
  retCode: number;
  retMsg: string;
  result?: {
    orderId: string;
    orderLinkId: string;
  };
}

/**
 * Place a conditional order that triggers when price touches the level
 * 
 * This is MUCH faster than waiting for cron:
 * - Bybit monitors price in real-time (microsecond precision)
 * - Order triggers instantly when price hits triggerPrice
 * - No polling, no latency, no missed entries
 */
export async function placeConditionalOrder(
  params: ConditionalOrderParams
): Promise<ConditionalOrderResponse> {
  const {
    symbol,
    side,
    triggerPrice,
    qty,
    takeProfit,
    stopLoss,
    testnet,
    apiKey,
    apiSecret,
  } = params;

  const timestamp = Date.now();
  const recvWindow = 5000;

  const baseUrl = testnet
    ? 'https://api-testnet.bybit.com'
    : 'https://api.bybit.com';

  // Conditional order parameters
  // triggerPrice = when to trigger the order
  // orderType = Market (execute immediately when triggered)
  const orderParams: Record<string, any> = {
    category: 'linear',
    symbol: symbol.toUpperCase(),
    side,
    orderType: 'Market', // Market order when triggered (fastest execution)
    qty: qty.toString(),
    triggerDirection: side === 'Buy' ? 1 : 2, // 1 = trigger when price rises to/above (for long), 2 = falls to/below (for short)
    triggerPrice: triggerPrice.toString(),
    triggerBy: 'LastPrice', // Trigger based on last traded price
    timeInForce: 'IOC', // Immediate or Cancel
    positionIdx: 0, // One-way mode
  };

  // Add TP/SL if provided (set on position, not order)
  if (takeProfit) {
    orderParams.takeProfit = takeProfit.toString();
  }
  if (stopLoss) {
    orderParams.stopLoss = stopLoss.toString();
  }

  // Build query string for signature
  const sortedParams = Object.keys(orderParams)
    .sort()
    .map((key) => `${key}=${orderParams[key]}`)
    .join('&');

  const queryString = `${timestamp}${apiKey}${recvWindow}${sortedParams}`;
  const signature = createHmac('sha256', apiSecret).update(queryString).digest('hex');

  // Make API request
  const endpoint = '/v5/order/create';
  const url = `${baseUrl}${endpoint}`;

  console.log(`[CONDITIONAL] Placing conditional order: ${side} ${symbol} when price ${side === 'Buy' ? 'rises to' : 'falls to'} ${triggerPrice}`);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'X-BAPI-API-KEY': apiKey,
      'X-BAPI-SIGN': signature,
      'X-BAPI-SIGN-TYPE': '2',
      'X-BAPI-TIMESTAMP': timestamp.toString(),
      'X-BAPI-RECV-WINDOW': recvWindow.toString(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(orderParams),
  });

  const result = await response.json();

  if (result.retCode === 0) {
    console.log(`[CONDITIONAL] ✓ Conditional order placed successfully: Order ID ${result.result.orderId}`);
    console.log(`[CONDITIONAL]   Will trigger when ${symbol} ${side === 'Buy' ? '≥' : '≤'} ${triggerPrice}`);
    if (takeProfit) console.log(`[CONDITIONAL]   TP: ${takeProfit}`);
    if (stopLoss) console.log(`[CONDITIONAL]   SL: ${stopLoss}`);
  } else {
    console.error(`[CONDITIONAL] Failed to place conditional order: ${result.retMsg}`);
  }

  return result;
}

/**
 * Cancel a conditional order
 */
export async function cancelConditionalOrder(params: {
  symbol: string;
  orderId: string;
  testnet: boolean;
  apiKey: string;
  apiSecret: string;
}): Promise<ConditionalOrderResponse> {
  const { symbol, orderId, testnet, apiKey, apiSecret } = params;

  const timestamp = Date.now();
  const recvWindow = 5000;

  const baseUrl = testnet
    ? 'https://api-testnet.bybit.com'
    : 'https://api.bybit.com';

  const orderParams = {
    category: 'linear',
    symbol: symbol.toUpperCase(),
    orderId,
  };

  const sortedParams = Object.keys(orderParams)
    .sort()
    .map((key) => `${key}=${orderParams[key as keyof typeof orderParams]}`)
    .join('&');

  const queryString = `${timestamp}${apiKey}${recvWindow}${sortedParams}`;
  const signature = createHmac('sha256', apiSecret).update(queryString).digest('hex');

  const endpoint = '/v5/order/cancel';
  const url = `${baseUrl}${endpoint}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'X-BAPI-API-KEY': apiKey,
      'X-BAPI-SIGN': signature,
      'X-BAPI-SIGN-TYPE': '2',
      'X-BAPI-TIMESTAMP': timestamp.toString(),
      'X-BAPI-RECV-WINDOW': recvWindow.toString(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(orderParams),
  });

  return await response.json();
}

/**
 * Get all active conditional orders
 */
export async function getConditionalOrders(params: {
  symbol?: string;
  testnet: boolean;
  apiKey: string;
  apiSecret: string;
}): Promise<any> {
  const { symbol, testnet, apiKey, apiSecret } = params;

  const timestamp = Date.now();
  const recvWindow = 5000;

  const baseUrl = testnet
    ? 'https://api-testnet.bybit.com'
    : 'https://api.bybit.com';

  const queryParams: Record<string, string> = {
    category: 'linear',
  };

  if (symbol) {
    queryParams.symbol = symbol.toUpperCase();
  }

  const sortedParams = Object.keys(queryParams)
    .sort()
    .map((key) => `${key}=${queryParams[key]}`)
    .join('&');

  const queryString = `${timestamp}${apiKey}${recvWindow}${sortedParams}`;
  const signature = createHmac('sha256', apiSecret).update(queryString).digest('hex');

  const endpoint = '/v5/order/realtime';
  const url = `${baseUrl}${endpoint}?${sortedParams}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'X-BAPI-API-KEY': apiKey,
      'X-BAPI-SIGN': signature,
      'X-BAPI-SIGN-TYPE': '2',
      'X-BAPI-TIMESTAMP': timestamp.toString(),
      'X-BAPI-RECV-WINDOW': recvWindow.toString(),
    },
  });

  return await response.json();
}

/**
 * Smart Conditional Order Manager
 * 
 * Manages conditional orders for all potential signal levels
 * Updates them as market conditions change
 */
export class ConditionalOrderManager {
  private activeOrders: Map<string, string> = new Map(); // level -> orderId

  /**
   * Place conditional orders at all potential signal levels
   * 
   * This sets up orders that will trigger INSTANTLY when price touches levels
   * No more waiting for cron to run!
   */
  async setupLevelOrders(params: {
    symbol: string;
    levels: Array<{ price: number; side: 'Buy' | 'Sell'; tp: number; sl: number }>;
    qty: number;
    testnet: boolean;
    apiKey: string;
    apiSecret: string;
  }): Promise<void> {
    const { symbol, levels, qty, testnet, apiKey, apiSecret } = params;

    console.log(`[CONDITIONAL] Setting up ${levels.length} conditional orders for ${symbol}`);

    // Cancel existing orders first
    await this.cancelAllOrders({ symbol, testnet, apiKey, apiSecret });

    // Place new conditional orders at each level
    for (const level of levels) {
      try {
        const result = await placeConditionalOrder({
          symbol,
          side: level.side,
          triggerPrice: level.price,
          qty,
          takeProfit: level.tp,
          stopLoss: level.sl,
          testnet,
          apiKey,
          apiSecret,
        });

        if (result.retCode === 0 && result.result) {
          const key = `${symbol}_${level.price}_${level.side}`;
          this.activeOrders.set(key, result.result.orderId);
          console.log(`[CONDITIONAL] ✓ Order ready at ${level.side} ${level.price}`);
        }
      } catch (error) {
        console.error(`[CONDITIONAL] Failed to place order at ${level.price}:`, error);
      }

      // Small delay to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    console.log(`[CONDITIONAL] ✓ Setup complete - ${this.activeOrders.size} orders active`);
    console.log(`[CONDITIONAL] Orders will trigger INSTANTLY when price touches levels`);
  }

  /**
   * Cancel all active conditional orders
   */
  async cancelAllOrders(params: {
    symbol: string;
    testnet: boolean;
    apiKey: string;
    apiSecret: string;
  }): Promise<void> {
    const { symbol, testnet, apiKey, apiSecret } = params;

    // Get all active orders
    const ordersResponse = await getConditionalOrders({
      symbol,
      testnet,
      apiKey,
      apiSecret,
    });

    if (ordersResponse.retCode === 0 && ordersResponse.result?.list) {
      const orders = ordersResponse.result.list;
      
      console.log(`[CONDITIONAL] Cancelling ${orders.length} existing conditional orders...`);

      for (const order of orders) {
        try {
          await cancelConditionalOrder({
            symbol,
            orderId: order.orderId,
            testnet,
            apiKey,
            apiSecret,
          });
          
          await new Promise(resolve => setTimeout(resolve, 50));
        } catch (error) {
          console.error(`[CONDITIONAL] Failed to cancel order ${order.orderId}:`, error);
        }
      }
    }

    this.activeOrders.clear();
  }

  /**
   * Update conditional orders when levels change
   * (e.g., after daily level recalculation)
   */
  async updateLevels(params: {
    symbol: string;
    levels: Array<{ price: number; side: 'Buy' | 'Sell'; tp: number; sl: number }>;
    qty: number;
    testnet: boolean;
    apiKey: string;
    apiSecret: string;
  }): Promise<void> {
    console.log(`[CONDITIONAL] Updating conditional orders for new levels...`);
    await this.setupLevelOrders(params);
  }
}
