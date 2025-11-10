import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { VolRequestSchema } from '@/lib/types';
import { garch11 } from '@/lib/vol';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const validated = VolRequestSchema.parse(body);

    // Calculate kPct using GARCH(1,1) with EWMA fallback
    const k_pct = garch11(validated.closes);

    return NextResponse.json({
      symbol: validated.symbol,
      k_pct,
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
