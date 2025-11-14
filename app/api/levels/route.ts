import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { LevelsRequestSchema } from '@/lib/types';
import { getKlines } from '@/lib/bybit';
import { getYahooFinanceKlines } from '@/lib/yahoo-finance';
import { getVolatilityData, getDailyLevels, saveDailyLevels } from '@/lib/db';
import { dailyOpenUTC, gridLevels } from '@/lib/strategy';
import { computeSessionAnchoredVWAP, computeSessionAnchoredVWAPLine } from '@/lib/vwap';
import { calculateAverageVolatility } from '@/lib/vol';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const validated = LevelsRequestSchema.parse(body);
    const testnet = body.testnet !== undefined ? body.testnet : true; // Default to testnet

    // Try to get stored levels from database first (calculated once per day)
    try {
      const storedLevels = await getDailyLevels(validated.symbol);
      if (storedLevels) {
        const storedDate = new Date(storedLevels.date);
        const today = new Date();
        today.setUTCHours(0, 0, 0, 0);
        storedDate.setUTCHours(0, 0, 0, 0);
        
        // Check if stored levels are for today
        if (storedDate.getTime() === today.getTime()) {
          console.log(`[LEVELS] Using stored daily levels for ${validated.symbol} (date: ${storedLevels.date})`);
          
          // Still need VWAP calculated from current candles for real-time display
          // But use stored levels for entry/TP/SL
          let intraday;
          try {
            intraday = await getKlines(validated.symbol, '5', 288, false);
          } catch (mainnetError) {
            intraday = await getKlines(validated.symbol, '5', 288, testnet);
          }
          const intradayAsc = intraday.slice().reverse();
          const vwap = computeSessionAnchoredVWAP(intradayAsc, { source: 'hlc3', useAllCandles: true });
          const vwapLine = computeSessionAnchoredVWAPLine(intradayAsc, { source: 'hlc3', useAllCandles: true });
          
          return NextResponse.json({
            symbol: validated.symbol,
            kPct: storedLevels.calculated_volatility,
            dOpen: storedLevels.daily_open_price,
            vwap,
            vwapLine,
            upper: storedLevels.upper_range,
            lower: storedLevels.lower_range,
            upLevels: storedLevels.up_levels,
            dnLevels: storedLevels.dn_levels,
            dataSource: 'stored', // Indicate these are stored levels
          });
        } else {
          console.log(`[LEVELS] Stored levels for ${validated.symbol} are from ${storedLevels.date}, not today. Will calculate new levels.`);
        }
      } else {
        console.log(`[LEVELS] No stored levels found for ${validated.symbol}. Will calculate.`);
      }
    } catch (storedError) {
      console.warn(`[LEVELS] Could not get stored levels, will calculate:`, storedError);
      // Continue to calculate if stored levels not available
    }

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

    // Use custom kPct if provided, otherwise calculate from Yahoo Finance (3 years of data)
    let kPct: number = 0.03; // Default value to satisfy TypeScript
    if (validated.customKPct !== undefined) {
      // Use custom kPct provided by user (already validated to be between 0.01 and 0.1)
      kPct = validated.customKPct;
    } else {
      // Try to get stored volatility from database first (from daily-setup)
      try {
        const today = new Date().toISOString().split('T')[0];
        const storedVol = await getVolatilityData(validated.symbol, today);
        if (storedVol && storedVol.calculated_volatility) {
          console.log(`[LEVELS] Using stored volatility from database for ${validated.symbol}: ${(storedVol.calculated_volatility * 100).toFixed(4)}%`);
          kPct = Number(storedVol.calculated_volatility);
        } else {
          // Calculate from Yahoo Finance (3 years of data, matches Python script)
          console.log(`[LEVELS] Calculating volatility from Yahoo Finance for ${validated.symbol}...`);
          let yahooCandles;
          let yahooFailed = false;
          try {
            yahooCandles = await getYahooFinanceKlines(validated.symbol, 1095); // 3 years
          } catch (yahooError) {
            console.warn(`[LEVELS] Yahoo Finance failed, falling back to Bybit data:`, yahooError);
            yahooFailed = true;
            // Fallback to Bybit if Yahoo Finance fails
            const dailyAsc = daily.slice().reverse();
            const dailyCloses = dailyAsc.map(c => c.close);
            const volatilityResult = calculateAverageVolatility(dailyCloses, {
              clampPct: [1, 10],
              symbol: validated.symbol,
              timeframe: '1d',
              horizon: 5,
            });
            kPct = volatilityResult.averaged.kPct;
          }
          
          // If Yahoo Finance succeeded and we have candles, use them
          if (!yahooFailed && yahooCandles && yahooCandles.length > 0) {
            const yahooCloses = yahooCandles.map(c => c.close);
            const volatilityResult = calculateAverageVolatility(yahooCloses, {
              clampPct: [1, 10],
              symbol: validated.symbol,
              timeframe: '1d',
              horizon: 5, // Forecast 5 days ahead, then average
            });
            kPct = volatilityResult.averaged.kPct;
            console.log(`[LEVELS] Calculated volatility from Yahoo Finance: ${(kPct * 100).toFixed(4)}%`);
          }
          
          // If Yahoo Finance succeeded but returned no candles, fall back to Bybit
          if (!yahooFailed && (!yahooCandles || yahooCandles.length === 0)) {
            console.warn(`[LEVELS] Yahoo Finance returned no candles, falling back to Bybit data`);
            const dailyAsc = daily.slice().reverse();
            const dailyCloses = dailyAsc.map(c => c.close);
            const volatilityResult = calculateAverageVolatility(dailyCloses, {
              clampPct: [1, 10],
              symbol: validated.symbol,
              timeframe: '1d',
              horizon: 5,
            });
            kPct = volatilityResult.averaged.kPct;
          }
        }
      } catch (error) {
        console.error(`[LEVELS] Error getting volatility, using fallback:`, error);
        // Fallback: use Bybit data (limited accuracy)
        const dailyAsc = daily.slice().reverse();
        const dailyCloses = dailyAsc.map(c => c.close);
        const volatilityResult = calculateAverageVolatility(dailyCloses, {
          clampPct: [1, 10],
          symbol: validated.symbol,
          timeframe: '1d',
          horizon: 5,
        });
        kPct = volatilityResult.averaged.kPct;
      }
      
      // Final safety clamp to prevent extreme values
      kPct = Math.max(0.01, Math.min(0.10, kPct));
    }

    const intradayAsc = intraday.slice().reverse(); // Ensure ascending order

    // Calculate levels (this endpoint still calculates dynamically for frontend/API calls)
    const dOpen = dailyOpenUTC(intradayAsc);
    // Use all candles for VWAP to match TradingView VWAP AA with Auto anchor
    // This uses all available data instead of session-anchored (resets at UTC midnight)
    const vwap = computeSessionAnchoredVWAP(intradayAsc, { source: 'hlc3', useAllCandles: true });
    const vwapLine = computeSessionAnchoredVWAPLine(intradayAsc, { source: 'hlc3', useAllCandles: true });
    const { upper, lower, upLevels, dnLevels } = gridLevels(dOpen, kPct, validated.subdivisions);

    // Store calculated levels in database for today if they don't exist
    // This ensures levels are stored even if daily-setup cron hasn't run yet
    try {
      const todayLevels = await getDailyLevels(validated.symbol);
      const today = new Date().toISOString().split('T')[0];
      if (!todayLevels || todayLevels.date !== today) {
        console.log(`[LEVELS] Storing calculated levels for ${validated.symbol} (date: ${today})`);
        await saveDailyLevels(
          validated.symbol,
          dOpen,
          upper,
          lower,
          upLevels,
          dnLevels,
          kPct,
          validated.subdivisions
        );
        console.log(`[LEVELS] ✓ Levels stored for ${validated.symbol}`);
      }
    } catch (saveError) {
      console.warn(`[LEVELS] Failed to store levels (non-critical):`, saveError);
      // Don't fail the request if storing fails - levels are still calculated
    }

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
