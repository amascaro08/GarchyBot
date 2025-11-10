import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { LevelsRequestSchema } from '@/lib/types';
import { getKlines } from '@/lib/bybit';
import { dailyOpenUTC, vwapFromOHLCV, gridLevels } from '@/lib/strategy';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const validated = LevelsRequestSchema.parse(body);

    // Fetch recent klines using the interval from request (default to 5m if not provided)
    const interval = (body.interval as string) || '5';
    const testnet = body.testnet !== undefined ? body.testnet : false; // Use testnet from request, default to false
    const candles = await getKlines(validated.symbol, interval as any, 288, testnet);

    // Calculate daily open, VWAP, and grid levels
    const dOpen = dailyOpenUTC(candles);
    const vwap = vwapFromOHLCV(candles);
    const { upper, lower, upLevels, dnLevels } = gridLevels(dOpen, validated.kPct, validated.subdivisions);

    return NextResponse.json({
      symbol: validated.symbol,
      dOpen,
      upper,
      lower,
      upLevels,
      dnLevels,
      vwap,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request body', details: error.errors },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to calculate levels' },
      { status: 500 }
    );
  }
}
