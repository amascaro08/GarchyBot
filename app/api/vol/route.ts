import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { VolRequestSchema } from '@/lib/types';
import { calculateAverageVolatility } from '@/lib/vol';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const validated = VolRequestSchema.parse(body);

    // Calculate volatility using all three models (GARCH, EGARCH, GJR-GARCH) and average
    const volatilityResult = calculateAverageVolatility(validated.closes, { clampPct: [1, 10] });

    // Use the averaged kPct result
    // Final safety clamp to prevent extreme values (should never exceed 0.10, but add safeguard)
    const k_pct = Math.max(0.01, Math.min(0.10, volatilityResult.averaged.kPct));

    return NextResponse.json({
      symbol: validated.symbol,
      k_pct,
      models: {
        garch11: volatilityResult.garch11.kPct,
        egarch11: volatilityResult.egarch11.kPct,
        gjrgarch11: volatilityResult.gjrgarch11.kPct,
        averaged: volatilityResult.averaged.kPct,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request body', details: error.errors },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to calculate volatility' },
      { status: 500 }
    );
  }
}
