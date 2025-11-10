import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { VolRequestSchema } from '@/lib/types';
import { estimateKPercent } from '@/lib/vol';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const validated = VolRequestSchema.parse(body);

    // Calculate kPct using GARCH(1,1) with EWMA fallback
    const raw_k_pct = estimateKPercent(validated.closes, { clampPct: [1, 10] });
    
    // Final safety clamp to prevent extreme values (should never exceed 10%, but add safeguard)
    const k_pct = Math.max(0.1, Math.min(10, raw_k_pct));

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
