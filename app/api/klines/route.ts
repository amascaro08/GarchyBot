import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getKlines, BybitError } from '@/lib/bybit';
import { CandleSchema } from '@/lib/types';

const QuerySchema = z.object({
  symbol: z.string().default('BTCUSDT'),
  interval: z.enum(['1', '3', '5', '15', '60', '120', '240']).default('5'),
  limit: z.coerce.number().int().min(1).max(1000).default(200),
  testnet: z.coerce.boolean().default(true),
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
    try {
      // Try testnet first if requested
      candles = await getKlines(query.symbol, query.interval, query.limit, query.testnet);
    } catch (error: any) {
      // If testnet fails with 403, try mainnet as fallback
      if (query.testnet && error instanceof BybitError && (error.retCode === 403 || error.retCode === 10004)) {
        console.warn('Testnet API returned error, trying mainnet...');
        candles = await getKlines(query.symbol, query.interval, query.limit, false);
      } else {
        throw error;
      }
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
    console.error('Klines API error:', errorMessage);
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}
