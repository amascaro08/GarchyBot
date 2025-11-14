import yahooFinance from 'yahoo-finance2';

/**
 * Map exchange symbols to Yahoo Finance tickers
 */
function mapSymbolToYahoo(symbol: string): string {
  const symbolMap: Record<string, string> = {
    'BTCUSDT': 'BTC-USD',
    'BTC-USDT': 'BTC-USD',
    'ETHUSDT': 'ETH-USD',
    'ETH-USDT': 'ETH-USD',
    'SOLUSDT': 'SOL-USD',
    'SOL-USDT': 'SOL-USD',
  };
  
  return symbolMap[symbol.toUpperCase()] || symbol;
}

/**
 * Fetch historical daily OHLCV data from Yahoo Finance
 * Returns data in the same format as getKlines from bybit.ts
 * Uses adjusted close prices (matches yfinance's auto_adjust=True)
 */
export async function getYahooFinanceKlines(
  symbol: string,
  days: number = 1095
): Promise<Array<{ ts: number; open: number; high: number; low: number; close: number; volume: number }>> {
  const yahooSymbol = mapSymbolToYahoo(symbol);
  
  console.log(`[YAHOO-FINANCE] Fetching ${days} days of data for ${symbol} (Yahoo: ${yahooSymbol})`);
  
  // Calculate start date (days ago from today)
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days - 30); // Add buffer for weekends/holidays
  
  try {
    // Fetch historical data using yahoo-finance2
    // The historical method expects a symbol and query options
    const result = await yahooFinance.historical(yahooSymbol, {
      period1: Math.floor(startDate.getTime() / 1000), // Unix timestamp in seconds
      period2: Math.floor(endDate.getTime() / 1000),
      interval: '1d', // Daily interval
    });
    
    if (!result || result.length === 0) {
      throw new Error(`No historical data returned from Yahoo Finance for ${yahooSymbol}`);
    }
    
    // Convert Yahoo Finance data to our candle format
    // Yahoo Finance returns an array of objects with date, open, high, low, close, volume, adjustedClose
    // Use adjusted close if available (matches yfinance's auto_adjust=True), otherwise use close
    const candles = result
      .map((item: any) => {
        // Use adjusted close if available (matches yfinance's auto_adjust=True)
        const closePrice = item.adjClose !== undefined && item.adjClose !== null
          ? item.adjClose 
          : item.close;
        
        // Convert date to timestamp in milliseconds
        const timestamp = item.date instanceof Date 
          ? item.date.getTime() 
          : new Date(item.date).getTime();
        
        return {
          ts: timestamp,
          open: item.open,
          high: item.high,
          low: item.low,
          close: closePrice,
          volume: item.volume || 0,
        };
      })
      .sort((a, b) => a.ts - b.ts); // Sort by timestamp (oldest first)
    
    // Take only the last N days (in case we got more due to buffer)
    const trimmedCandles = candles.slice(-days);
    
    console.log(`[YAHOO-FINANCE] Successfully fetched ${trimmedCandles.length} candles for ${symbol}`);
    
    if (trimmedCandles.length > 0) {
      console.log(`[YAHOO-FINANCE] Date range: ${new Date(trimmedCandles[0].ts).toISOString().split('T')[0]} to ${new Date(trimmedCandles[trimmedCandles.length - 1].ts).toISOString().split('T')[0]}`);
    }
    
    return trimmedCandles;
  } catch (error) {
    console.error(`[YAHOO-FINANCE] Error fetching data for ${yahooSymbol}:`, error);
    throw new Error(`Yahoo Finance API error for ${yahooSymbol}: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

