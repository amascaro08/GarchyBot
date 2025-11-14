import { NextRequest, NextResponse } from 'next/server';
import { calculateAverageVolatility } from '@/lib/vol';
import { getKlines } from '@/lib/bybit';

/**
 * Calculate GARCH volatility for a symbol
 * Client-accessible endpoint (no auth required for viewing calculations)
 * GET /api/garch/calculate?symbol=BTCUSDT
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const symbol = searchParams.get('symbol') || 'BTCUSDT';
    
    console.log(`[GARCH-CALC] Calculating volatility for ${symbol}...`);
    
    // Fetch 1000+ days of historical data
    // Try testnet first, then mainnet if that fails
    let candles;
    let lastError;
    
    try {
      console.log(`[GARCH-CALC] Trying testnet API...`);
      candles = await getKlines(symbol, 'D', 1000, true); // Use 'D' for daily, testnet first
    } catch (testnetError) {
      lastError = testnetError;
      console.warn(`[GARCH-CALC] Testnet failed, trying mainnet...`, testnetError instanceof Error ? testnetError.message : testnetError);
      try {
        candles = await getKlines(symbol, 'D', 1000, false); // Try mainnet
      } catch (mainnetError) {
        lastError = mainnetError;
        console.error(`[GARCH-CALC] Both testnet and mainnet failed. Mainnet error:`, mainnetError instanceof Error ? mainnetError.message : mainnetError);
        // The getKlines function should have already tried Binance/CoinGecko fallbacks
        // If we get here, all APIs failed
        throw new Error(`Failed to fetch data from Bybit, Binance, and CoinGecko: ${mainnetError instanceof Error ? mainnetError.message : 'Unknown error'}`);
      }
    }
    
    if (!candles || candles.length === 0) {
      return NextResponse.json(
        { error: `No historical data for ${symbol} after trying all APIs` },
        { status: 400 }
      );
    }
    
    console.log(`[GARCH-CALC] Successfully fetched ${candles.length} candles for ${symbol}`);
    
    // Extract closing prices
    const closes = candles.map(c => c.close).filter(price => price > 0);
    
    if (closes.length < 30) {
      return NextResponse.json(
        { error: `Insufficient data: only ${closes.length} days` },
        { status: 400 }
      );
    }
    
    // Calculate volatility using all three models
    const volatilityResult = calculateAverageVolatility(closes, {
      clampPct: [1, 10],
      symbol,
      timeframe: '1d',
      day: new Date().toISOString().split('T')[0],
      horizon: 5, // Forecast 5 days ahead
    });
    
    // Return result with debug info
    return NextResponse.json({
      success: true,
      symbol,
      dataPoints: closes.length,
      volatility: volatilityResult.averaged.kPct,
      debugInfo: volatilityResult.debugInfo,
      models: {
        garch11: {
          kPct: volatilityResult.garch11.kPct,
          vol: volatilityResult.garch11.vol,
        },
        gjrgarch11: {
          kPct: volatilityResult.gjrgarch11.kPct,
          vol: volatilityResult.gjrgarch11.vol,
        },
        egarch11: {
          kPct: volatilityResult.egarch11.kPct,
          vol: volatilityResult.egarch11.vol,
        },
        averaged: {
          kPct: volatilityResult.averaged.kPct,
          vol: volatilityResult.averaged.vol,
        },
      },
    });
  } catch (error) {
    console.error('[GARCH-CALC] Error:', error);
    return NextResponse.json(
      { 
        error: error instanceof Error ? error.message : 'Failed to calculate GARCH',
        success: false 
      },
      { status: 500 }
    );
  }
}

