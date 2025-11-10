import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { SignalRequestSchema } from '@/lib/types';
import { dailyOpenUTC, vwapFromOHLCV, gridLevels, strictSignalWithDailyOpen } from '@/lib/strategy';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const validated = SignalRequestSchema.parse(body);

    // Calculate daily open, VWAP, and grid levels from provided candles
    const dOpen = dailyOpenUTC(validated.candles);
    const vwap = vwapFromOHLCV(validated.candles);
    const { upLevels, dnLevels } = gridLevels(dOpen, validated.kPct, validated.subdivisions);

    // Get signal
    const signal = strictSignalWithDailyOpen({
      candles: validated.candles,
      vwap,
      dOpen,
      upLevels,
      dnLevels,
      noTradeBandPct: validated.noTradeBandPct,
      useDailyOpenEntry: body.useDailyOpenEntry ?? true, // Default to true if not specified
    });

    return NextResponse.json({
      symbol: validated.symbol,
      signal: signal.side,
      touchedLevel: signal.entry,
      tp: signal.tp,
      sl: signal.sl,
      reason: signal.reason,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request body', details: error.errors },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to calculate signal' },
      { status: 500 }
    );
  }
}
