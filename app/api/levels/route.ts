import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { LevelsRequestSchema } from '@/lib/types';
import { getKlines } from '@/lib/bybit';
import { dailyOpenUTC, vwapFromOHLCV, vwapLineFromOHLCV, gridLevels } from '@/lib/strategy';
import { garch11 } from '@/lib/vol';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const validated = LevelsRequestSchema.parse(body);
    const testnet = body.testnet !== undefined ? body.testnet : true; // Default to testnet

    // For price data, prefer mainnet for accuracy, but allow testnet fallback
    let daily, intraday;
    let usedMainnet = false;
    
    try {
      // Try mainnet first for accurate prices
      daily = await getKlines(validated.symbol, 'D', 60, false);
      intraday = await getKlines(validated.symbol, '5', 288, false);
      usedMainnet = true;
    } catch (mainnetError) {
      // Fallback to testnet if mainnet fails
      console.warn(`Mainnet failed for ${validated.symbol}, using testnet:`, mainnetError);
      daily = await getKlines(validated.symbol, 'D', 60, testnet);
      intraday = await getKlines(validated.symbol, '5', 288, testnet);
    }

    // Use custom kPct if provided, otherwise calculate from daily candles
    let kPct: number;
    if (validated.customKPct !== undefined) {
      // Use custom kPct provided by user (already validated to be between 0.01 and 0.1)
      kPct = validated.customKPct;
    } else {
      // Calculate from daily candles (default behavior)
      const dailyAsc = daily.slice().reverse(); // Ensure ascending order
      const dailyCloses = dailyAsc.map(c => c.close);
      kPct = garch11(dailyCloses); // Clamps internally 1–10%
    }

    const intradayAsc = intraday.slice().reverse(); // Ensure ascending order

    const dOpen = dailyOpenUTC(intradayAsc);
    const vwap = vwapFromOHLCV(intradayAsc);
    const vwapLine = vwapLineFromOHLCV(intradayAsc);
    const { upper, lower, upLevels, dnLevels } = gridLevels(dOpen, kPct, validated.subdivisions);

    return NextResponse.json({
      symbol: validated.symbol,
      kPct, // Expose kPct here
      dOpen,
      vwap,
      vwapLine,
      upper,
      lower,
      upLevels,
      dnLevels,
      dataSource: usedMainnet ? 'mainnet' : 'testnet', // For debugging
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
