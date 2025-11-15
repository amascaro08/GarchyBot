import { NextRequest, NextResponse } from 'next/server';
import { calculateAverageVolatility } from '@/lib/vol';
import { saveVolatilityData, getVolatilityData, saveDailyLevels, updatePhaseStatus, checkPhase1Completed } from '@/lib/db';
import { getKlines } from '@/lib/bybit';
import { getYahooFinanceKlines } from '@/lib/yahoo-finance';
import { dailyOpenUTC, gridLevels } from '@/lib/strategy';
import type { Candle } from '@/lib/types';

/**
 * Daily statistical setup endpoint - PHASE 1 & PHASE 2
 *
 * Runs once per day at 00:00 UTC to execute both phases:
 *
 * PHASE 1: Volatility Calculation
 * 1. Fetch 1000+ days of historical data
 * 2. Calculate volatility using GARCH(1,1), EGARCH(1,1), and GJR-GARCH(1,1)
 * 3. Average the three volatility forecasts
 * 4. Store the calculated volatility in database
 *
 * PHASE 2: Intraday Trading Range Setup (runs after Phase 1)
 * 1. Fetch current intraday candles (5m interval, 288 candles = 24 hours)
 * 2. Calculate DailyOpenPrice at UTC 00:00 boundary
 * 3. Calculate UpperRange = DailyOpenPrice * (1 + CalculatedVolatility%)
 * 4. Calculate LowerRange = DailyOpenPrice * (1 - CalculatedVolatility%)
 * 5. Generate grid levels between ranges
 * 6. Store all calculated levels in database
 *
 * Setup in vercel.json:
 * {
 *   "crons": [{
 *     "path": "/api/cron/daily-setup",
 *     "schedule": "0 0 * * *"  // Daily at 00:00 UTC
 *   }]
 * }
 */

export async function POST(request: NextRequest) {
  try {
    // Verify cron secret for security (skip in development if no secret is set)
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;
    const isProduction = process.env.NODE_ENV === 'production';
    const isVercel = !!process.env.VERCEL;

    // In production/Vercel, require CRON_SECRET if it's set
    // In development, allow requests if no secret is configured
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      // In production, always require auth
      if (isProduction || isVercel) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
      // In development, warn but allow if no secret is configured
      if (authHeader) {
        console.warn('[DAILY-SETUP] Warning: Invalid authorization header, but allowing in development');
      }
    }

    console.log('[DAILY-SETUP] Starting daily statistical setup at', new Date().toISOString());

    // Build base URL for internal API calls
    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'http://localhost:3000';

    // Get list of symbols from running bots (to avoid calculating for unused symbols)
    // For now, we'll calculate for major symbols
    const symbols = ['BTCUSDT', 'ETHUSDT'];

    // Default subdivisions for grid levels (can be made configurable later)
    const defaultSubdivisions = 4; // Creates U1, U2, U3, U4 above daily open

    const results = await Promise.allSettled(
      symbols.map(async (symbol) => {
        const debugInfo: any = {};
        try {
          console.log(`[DAILY-SETUP] Processing ${symbol}`);
          debugInfo.symbol = symbol;

          // ================================
          // PHASE 1: Volatility Calculation
          // ================================
          console.log(`[DAILY-SETUP] Phase 1: Calculating volatility for ${symbol} using Yahoo Finance`);

          // Fetch 3 years of historical data from Yahoo Finance (matches Python script's yfinance)
          let candles;
          try {
            candles = await getYahooFinanceKlines(symbol, 1095); // 3 years
          } catch (yahooError) {
            console.error(`[DAILY-SETUP] Yahoo Finance failed for ${symbol}, falling back to Bybit:`, yahooError);
            // Fallback to Bybit if Yahoo Finance fails
            const klinesRes = await fetch(
              `${baseUrl}/api/klines?symbol=${symbol}&interval=1d&limit=1095&testnet=false`
            );
            if (!klinesRes.ok) {
              throw new Error(`Failed to fetch historical data for ${symbol} from both Yahoo Finance and Bybit`);
            }
            candles = await klinesRes.json();
          }

          if (!candles || candles.length === 0) {
            throw new Error(`No historical data received for ${symbol}`);
          }

          console.log(`[DAILY-SETUP] Fetched ${candles.length} days of historical data (3 years) for ${symbol}`);
          debugInfo.dataPoints = candles.length;

          // Extract closing prices
          const closes = candles.map((candle: any) => candle.close).filter((price: any) => price > 0);

          if (closes.length < 30) {
            throw new Error(`Insufficient historical data for ${symbol}: ${closes.length} days`);
          }

          // Calculate volatility using all three models as per rules: GARCH(1,1), EGARCH(1,1), and GJR-GARCH(1,1)
          // Uses forecasting approach: forecasts h days ahead (default 5), averages forecasted sigmas
          const volatilityResult = calculateAverageVolatility(closes, {
            clampPct: [1, 10],
            symbol,
            timeframe: '1d',
            day: new Date().toISOString().split('T')[0], // YYYY-MM-DD format
            horizon: 5, // Forecast 5 days ahead, then average (matches Python script)
          });

          // Average the three volatility forecasts as per rules
          const calculatedVolatility = volatilityResult.averaged.kPct;

          console.log(`[DAILY-SETUP] ${symbol} volatility calculated (forecasted 5 days ahead, averaged):`);
          console.log(`  Data points used: ${closes.length} days`);
          console.log(`  GARCH(1,1): ${(volatilityResult.garch11.kPct * 100).toFixed(4)}% (vol: ${(volatilityResult.garch11.vol * 100).toFixed(4)}%)`);
          console.log(`  EGARCH(1,1): ${(volatilityResult.egarch11.kPct * 100).toFixed(4)}% (vol: ${(volatilityResult.egarch11.vol * 100).toFixed(4)}%)`);
          console.log(`  GJR-GARCH(1,1): ${(volatilityResult.gjrgarch11.kPct * 100).toFixed(4)}% (vol: ${(volatilityResult.gjrgarch11.vol * 100).toFixed(4)}%)`);
          console.log(`  Averaged (global): ${(calculatedVolatility * 100).toFixed(4)}% (vol: ${(volatilityResult.averaged.vol * 100).toFixed(4)}%)`);

          // Store debug info for response (includes GARCH forecast details)
          debugInfo.volatility = calculatedVolatility;
          debugInfo.garch11_kPct = volatilityResult.garch11.kPct;
          debugInfo.garch11_vol = volatilityResult.garch11.vol;
          debugInfo.egarch11_kPct = volatilityResult.egarch11.kPct;
          debugInfo.egarch11_vol = volatilityResult.egarch11.vol;
          debugInfo.gjrgarch11_kPct = volatilityResult.gjrgarch11.kPct;
          debugInfo.gjrgarch11_vol = volatilityResult.gjrgarch11.vol;
          debugInfo.averaged_vol = volatilityResult.averaged.vol;
          
          // Include detailed GARCH debug info if available
          if (volatilityResult.debugInfo) {
            debugInfo.historicalStdDev = volatilityResult.debugInfo.historicalStdDev;
            debugInfo.garchForecasts = volatilityResult.debugInfo.garchForecasts;
            debugInfo.gjrForecasts = volatilityResult.debugInfo.gjrForecasts;
            debugInfo.egarchForecasts = volatilityResult.debugInfo.egarchForecasts;
            debugInfo.promGarch = volatilityResult.debugInfo.promGarch;
            debugInfo.promGjr = volatilityResult.debugInfo.promGjr;
            debugInfo.promEgarch = volatilityResult.debugInfo.promEgarch;
            debugInfo.promGlobal = volatilityResult.debugInfo.promGlobal;
          }

          // Store volatility data in database
          await saveVolatilityData(symbol, calculatedVolatility, volatilityResult, closes.length);

          // Mark Phase 1 as completed
          await updatePhaseStatus(symbol, 1, true);
          console.log(`[DAILY-SETUP] ✓ Phase 1 completed for ${symbol}`);

          // ================================
          // PHASE 2: Intraday Trading Range Setup
          // ================================
          console.log(`[DAILY-SETUP] Phase 2: Calculating levels for ${symbol}`);

          // Fetch intraday candles for daily open calculation (5m interval, 288 candles = 24 hours)
          // Call getKlines directly instead of HTTP request to avoid Vercel issues
          let intradayCandles: Candle[];
          try {
            // Try mainnet first for accurate data
            try {
              intradayCandles = await getKlines(symbol, '5', 288, false);
            } catch (mainnetError) {
              // Fallback to testnet if mainnet fails
              console.warn(`[DAILY-SETUP] Mainnet failed for ${symbol}, trying testnet:`, mainnetError);
              intradayCandles = await getKlines(symbol, '5', 288, true);
            }
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to fetch intraday data for ${symbol}: ${errorMsg}`);
          }

          if (!intradayCandles || intradayCandles.length === 0) {
            throw new Error(`No intraday data received for ${symbol}`);
          }

          console.log(`[DAILY-SETUP] Fetched ${intradayCandles.length} intraday candles for ${symbol}`);

          // Calculate Daily Open Price at UTC 00:00 boundary
          const dailyOpenPrice = dailyOpenUTC(intradayCandles);
          console.log(`[DAILY-SETUP] ${symbol} Daily Open Price: ${dailyOpenPrice.toFixed(2)}`);

          // Calculate Upper and Lower Ranges using CalculatedVolatility%
          const upperRange = dailyOpenPrice * (1 + calculatedVolatility);
          const lowerRange = dailyOpenPrice * (1 - calculatedVolatility);

          console.log(`[DAILY-SETUP] ${symbol} ranges calculated:`);
          console.log(`  Upper Range: ${upperRange.toFixed(2)}`);
          console.log(`  Lower Range: ${lowerRange.toFixed(2)}`);

          // Generate grid levels (4 equal levels between DailyOpen and UpperRange, and same for LowerRange)
          const { upper, lower, upLevels, dnLevels } = gridLevels(dailyOpenPrice, calculatedVolatility, defaultSubdivisions);

          console.log(`[DAILY-SETUP] ${symbol} grid levels generated:`);
          console.log(`  Upper levels (${upLevels.length}): ${upLevels.map(l => l.toFixed(2)).join(', ')}`);
          console.log(`  Lower levels (${dnLevels.length}): ${dnLevels.map(l => l.toFixed(2)).join(', ')}`);

          // Store daily levels in database
          await saveDailyLevels(
            symbol,
            dailyOpenPrice,
            upperRange,
            lowerRange,
            upLevels,
            dnLevels,
            calculatedVolatility,
            defaultSubdivisions
          );

          // Mark Phase 2 as completed
          await updatePhaseStatus(symbol, 2, true);
          console.log(`[DAILY-SETUP] ✓ Phase 2 completed for ${symbol}`);

          return {
            symbol,
            success: true,
            volatility: calculatedVolatility,
            dailyOpenPrice,
            upperRange,
            lowerRange,
            gridLevels: { upLevels, dnLevels },
            dataPoints: closes.length,
            debugInfo: {
              ...debugInfo,
              garch11_forecasts: [], // Will be captured from debug logs
              gjr_forecasts: [],
              egarch_forecasts: [],
              historical_std_dev: 0,
            }
          };

        } catch (error) {
          console.error(`[DAILY-SETUP] Error processing ${symbol}:`, error);

          // Mark phase as failed with error
          await updatePhaseStatus(symbol, 1, false, error instanceof Error ? error.message : 'Unknown error');

          return {
            symbol,
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
          };
        }
      })
    );

    const successful = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
    const failed = results.length - successful;

    const summary = {
      success: true,
      processed: results.length,
      successful,
      failed,
      timestamp: new Date().toISOString(),
      results: results.map(r => r.status === 'fulfilled' ? r.value : { error: String(r.reason) })
    };

    console.log('[DAILY-SETUP] Daily setup completed:', summary);
    return NextResponse.json(summary);

  } catch (error) {
    console.error('[DAILY-SETUP] Fatal error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

// Allow GET for testing (remove in production)
export async function GET(request: NextRequest) {
  return POST(request);
}