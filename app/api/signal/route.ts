import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { SignalRequestSchema } from '@/lib/types';
import { dailyOpenUTC, vwapFromOHLCV, gridLevels, strictSignalWithDailyOpen } from '@/lib/strategy';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    // Log raw body to debug
    console.log('[SIGNAL] Received request body keys:', Object.keys(body));
    console.log('[SIGNAL] Raw body values:');
    console.log(`  dOpen: ${body.dOpen} (type: ${typeof body.dOpen})`);
    console.log(`  vwap: ${body.vwap} (type: ${typeof body.vwap})`);
    console.log(`  upperLevels: ${Array.isArray(body.upperLevels) ? `array[${body.upperLevels.length}]` : typeof body.upperLevels}`);
    console.log(`  lowerLevels: ${Array.isArray(body.lowerLevels) ? `array[${body.lowerLevels.length}]` : typeof body.lowerLevels}`);
    
    const validated = SignalRequestSchema.parse(body);

    // Use provided levels if available, otherwise try to fetch from database, otherwise calculate
    let vwap: number;
    let upLevels: number[];
    let dnLevels: number[];
    let dOpen: number;

    // Check if stored levels are provided in request body (from bot runner)
    const hasStoredLevelsInBody = 
      typeof body.dOpen === 'number' && body.dOpen > 0 &&
      Array.isArray(body.upperLevels) && body.upperLevels.length > 0 &&
      Array.isArray(body.lowerLevels) && body.lowerLevels.length > 0 &&
      typeof body.vwap === 'number' && body.vwap > 0;

    if (hasStoredLevelsInBody) {
      // Use pre-calculated stored levels from request body (bot runner)
      vwap = body.vwap;
      upLevels = body.upperLevels;
      dnLevels = body.lowerLevels;
      dOpen = body.dOpen;
      console.log('[SIGNAL] ✓ Using pre-calculated stored levels from request body (bot runner)');
      console.log(`[SIGNAL]   Stored Daily Open: ${dOpen.toFixed(2)}`);
      console.log(`[SIGNAL]   Stored VWAP: ${vwap.toFixed(2)}`);
      console.log(`[SIGNAL]   Stored Upper Levels: ${upLevels.length} levels`);
      console.log(`[SIGNAL]   Stored Lower Levels: ${dnLevels.length} levels`);
    } else {
      // Try to fetch stored levels from database (for frontend calls)
      try {
        const { getDailyLevels } = await import('@/lib/db');
        const storedLevels = await getDailyLevels(validated.symbol);
        
        if (storedLevels && storedLevels.daily_open_price > 0 && 
            Array.isArray(storedLevels.up_levels) && storedLevels.up_levels.length > 0 &&
            Array.isArray(storedLevels.dn_levels) && storedLevels.dn_levels.length > 0) {
          
          // Use stored levels from database
          dOpen = storedLevels.daily_open_price;
          upLevels = storedLevels.up_levels;
          dnLevels = storedLevels.dn_levels;
          
          // Still need to calculate VWAP from current candles
          vwap = vwapFromOHLCV(validated.candles);
          
          console.log('[SIGNAL] ✓ Using stored levels from database (frontend call)');
          console.log(`[SIGNAL]   Stored Daily Open: ${dOpen.toFixed(2)}`);
          console.log(`[SIGNAL]   Calculated VWAP: ${vwap.toFixed(2)}`);
          console.log(`[SIGNAL]   Stored Upper Levels: ${upLevels.length} levels`);
          console.log(`[SIGNAL]   Stored Lower Levels: ${dnLevels.length} levels`);
        } else {
          throw new Error('Stored levels not found or invalid in database');
        }
      } catch (dbError) {
        // Fallback: Calculate levels dynamically
        console.warn('[SIGNAL] ⚠️ Stored levels not available, calculating dynamically');
        console.warn(`[SIGNAL]   Error fetching from DB: ${dbError instanceof Error ? dbError.message : String(dbError)}`);
        console.warn(`[SIGNAL]   body.dOpen: ${body.dOpen} (type: ${typeof body.dOpen})`);
        console.warn(`[SIGNAL]   body.upperLevels: ${Array.isArray(body.upperLevels) ? `array[${body.upperLevels.length}]` : typeof body.upperLevels}`);
        console.warn(`[SIGNAL]   body.lowerLevels: ${Array.isArray(body.lowerLevels) ? `array[${body.lowerLevels.length}]` : typeof body.lowerLevels}`);
        console.warn(`[SIGNAL]   body.vwap: ${body.vwap} (type: ${typeof body.vwap})`);
        
        dOpen = dailyOpenUTC(validated.candles);
        vwap = vwapFromOHLCV(validated.candles);
        const levels = gridLevels(dOpen, validated.kPct, validated.subdivisions);
        upLevels = levels.upLevels;
        dnLevels = levels.dnLevels;
        console.log('[SIGNAL] Calculated levels dynamically (fallback)');
      }
    }

    // Get real-time price if provided (for faster signal detection)
    const realtimePrice = body.realtimePrice && typeof body.realtimePrice === 'number' && body.realtimePrice > 0
      ? body.realtimePrice
      : undefined;

    // Log the levels being used for debugging
    console.log(`[SIGNAL] Checking signal for ${validated.symbol}:`);
    console.log(`  Daily Open: ${dOpen.toFixed(2)}`);
    console.log(`  VWAP: ${vwap.toFixed(2)}`);
    console.log(`  Real-time price: ${realtimePrice ? realtimePrice.toFixed(2) : 'N/A'}`);
    console.log(`  Last candle close: ${validated.candles[validated.candles.length - 1]?.close.toFixed(2)}`);
    console.log(`  Upper levels: ${upLevels.map(l => l.toFixed(2)).join(', ')}`);
    console.log(`  Lower levels: ${dnLevels.map(l => l.toFixed(2)).join(', ')}`);

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
      realtimePrice, // Pass real-time price for faster detection
    });

    if (signal.side) {
      console.log(`[SIGNAL] ✓ Signal detected: ${signal.side} @ ${signal.entry?.toFixed(2)}, Reason: ${signal.reason}`);
    } else {
      console.log(`[SIGNAL] No signal: ${signal.reason}`);
    }

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
