import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { SignalRequestSchema } from '@/lib/types';
import { dailyOpenUTC, vwapFromOHLCV, gridLevels, strictSignalWithDailyOpen } from '@/lib/strategy';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const validated = SignalRequestSchema.parse(body);

    // Use provided levels if available, otherwise calculate them
    let vwap: number;
    let upLevels: number[];
    let dnLevels: number[];
    let dOpen: number;

    if (body.dOpen && body.upperLevels && body.lowerLevels && body.vwap) {
      // Use pre-calculated stored levels
      vwap = body.vwap;
      upLevels = body.upperLevels;
      dnLevels = body.lowerLevels;
      dOpen = body.dOpen;
      console.log('[SIGNAL] Using pre-calculated stored levels');
    } else {
      // Calculate levels dynamically (fallback)
      dOpen = dailyOpenUTC(validated.candles);
      vwap = vwapFromOHLCV(validated.candles);
      const levels = gridLevels(dOpen, validated.kPct, validated.subdivisions);
      upLevels = levels.upLevels;
      dnLevels = levels.dnLevels;
      console.log('[SIGNAL] Calculated levels dynamically');
    }

    // Get signal
    const signal = strictSignalWithDailyOpen({
      candles: validated.candles,
      vwap,
      dOpen,
      upLevels,
      dnLevels,
      noTradeBandPct: validated.noTradeBandPct,
      useDailyOpenEntry: body.useDailyOpenEntry ?? true, // Default to true if not specified
      kPct: validated.kPct,
      subdivisions: validated.subdivisions,
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
