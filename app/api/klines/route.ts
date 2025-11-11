import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getKlines, BybitError } from '@/lib/bybit';
import { CandleSchema } from '@/lib/types';

const QuerySchema = z.object({
  symbol: z.string().default('BTCUSDT'),
  interval: z.enum(['1', '3', '5', '15', '60', '120', '240', 'D', '1d']).default('5'),
  limit: z.coerce.number().int().min(1).max(1000).default(200),
  testnet: z.coerce.boolean().default(false), // Default to mainnet for daily data
});

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const query = QuerySchema.parse({
      symbol: searchParams.get('symbol') || 'BTCUSDT',
      interval: searchParams.get('interval') || '5',
      limit: searchParams.get('limit') || '200',
      testnet: searchParams.get('testnet') !== 'false',
    });

    let candles;
    let lastError: Error | null = null;
    
    try {
      // Try testnet first if requested
      candles = await getKlines(query.symbol, query.interval, query.limit, query.testnet);
      
      // Validate price data quality - check if prices seem reasonable
      if (candles && candles.length > 0) {
        const latestPrice = candles[candles.length - 1].close;
        const avgPrice = candles.reduce((sum, c) => sum + c.close, 0) / candles.length;
        
        // If price deviates significantly from average, might be stale data
        // For crypto, allow up to 50% deviation (could be volatile)
        const priceDeviation = Math.abs(latestPrice - avgPrice) / avgPrice;
        
        // If testnet and price seems suspiciously off, try mainnet
        if (query.testnet && priceDeviation > 0.5 && candles.length > 10) {
          console.warn(`Testnet price data seems suspicious for ${query.symbol}, trying mainnet...`);
          try {
            const mainnetCandles = await getKlines(query.symbol, query.interval, query.limit, false);
            if (mainnetCandles && mainnetCandles.length > 0) {
              candles = mainnetCandles;
              lastError = null;
            }
          } catch (mainnetError) {
            console.error('Mainnet also failed, using testnet data:', mainnetError);
          }
        }
      }
    } catch (error: any) {
      lastError = error;
      // If testnet fails, try mainnet as fallback
      if (query.testnet && error instanceof BybitError) {
        console.warn(`Testnet API error (${error.retCode}): ${error.retMsg}, trying mainnet...`);
        try {
          candles = await getKlines(query.symbol, query.interval, query.limit, false);
          lastError = null; // Success, clear error
        } catch (mainnetError: any) {
          console.error('Mainnet API also failed:', mainnetError);
          lastError = mainnetError;
          throw mainnetError;
        }
      } else {
        throw error;
      }
    }

    if (!candles || candles.length === 0) {
      return NextResponse.json(
        { error: 'No kline data returned from Bybit API' },
        { status: 500 }
      );
    }

    // Validate with Zod
    const validatedCandles = candles.map((c) => CandleSchema.parse(c));

    return NextResponse.json(validatedCandles);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid query parameters', details: error.errors },
        { status: 400 }
      );
    }
    
    const errorMessage = error instanceof Error ? error.message : 'Failed to fetch klines';
    const errorDetails = error instanceof BybitError 
      ? `Bybit API Error ${error.retCode}: ${error.retMsg}`
      : errorMessage;
    
    console.error('Klines API error:', errorDetails, error);
    
    return NextResponse.json(
      { 
        error: errorDetails,
        type: error instanceof BybitError ? 'BybitError' : 'UnknownError'
      },
      { status: 500 }
    );
  }
}
