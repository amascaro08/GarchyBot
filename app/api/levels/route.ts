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
    const testnet = body.testnet !== undefined ? body.testnet : true; // Default to testnet

    // 1) Get DAILY closes (server-side) for kPct
    const daily = await getKlines(validated.symbol, 'D', 60, testnet);
    const dailyAsc = daily.slice().reverse(); // Ensure ascending order
    const dailyCloses = dailyAsc.map(c => c.close);
    const kPct = garch11(dailyCloses); // Clamps internally 1–10%

    // 2) Get intraday for dOpen + vwap + levels
    const intraday = await getKlines(validated.symbol, '5', 288, testnet);
    const intradayAsc = intraday.slice().reverse(); // Ensure ascending order

    const dOpen = dailyOpenUTC(intradayAsc);
    const vwap = vwapFromOHLCV(intradayAsc);
    const { upper, lower, upLevels, dnLevels } = gridLevels(dOpen, kPct, validated.subdivisions);

    return NextResponse.json({
      symbol: validated.symbol,
      kPct, // Expose kPct here
      dOpen,
      vwap,
      upper,
      lower,
      upLevels,
      dnLevels,
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
