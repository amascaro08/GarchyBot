import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { LevelsRequestSchema } from '@/lib/types';
import { getKlines } from '@/lib/bybit';
import { dailyOpenUTC, vwapFromOHLCV, gridLevels } from '@/lib/strategy';
import { garch11 } from '@/lib/vol';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const validated = LevelsRequestSchema.parse(body);

    // Always use daily candles (interval 'D' = 1 day) for calculating daily open and levels
    // The user's selected interval is only for display, not for level calculation
    const candles = await getKlines(validated.symbol, 'D', 30, body.testnet !== undefined ? body.testnet : false);

    // Calculate volatility from daily closes (not from user's selected interval)
    // Use provided kPct if available, otherwise calculate from daily candles
    const dailyCloses = candles.map(c => c.close);
    const kPct = validated.kPct || garch11(dailyCloses);

    // Calculate daily open, VWAP, and grid levels using the daily-calculated volatility
    const dOpen = dailyOpenUTC(candles);
    const vwap = vwapFromOHLCV(candles);
    const { upper, lower, upLevels, dnLevels } = gridLevels(dOpen, kPct, validated.subdivisions);

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
