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
    
    // Extract closing prices and validate
    let closes = candles.map(c => c.close).filter(price => price > 0 && isFinite(price));
    
    // Filter out obvious outliers (for BTC, prices outside 1k-300k are likely bad data)
    if (symbol === 'BTCUSDT' || symbol === 'BTC-USDT') {
      const originalLength = closes.length;
      closes = closes.filter(price => price >= 1000 && price <= 300000);
      if (closes.length < originalLength) {
        console.warn(`[GARCH-CALC] Filtered out ${originalLength - closes.length} outlier prices for ${symbol}`);
      }
    }
    
    if (closes.length < 30) {
      return NextResponse.json(
        { error: `Insufficient data after filtering: only ${closes.length} valid prices` },
        { status: 400 }
      );
    }
    
    // Debug: Log sample of data to verify it looks correct
    console.log(`[GARCH-CALC] Sample data for ${symbol}:`);
    console.log(`  First 5 closes: ${closes.slice(0, 5).map(c => c.toFixed(2)).join(', ')}`);
    console.log(`  Last 5 closes: ${closes.slice(-5).map(c => c.toFixed(2)).join(', ')}`);
    console.log(`  Price range: ${Math.min(...closes).toFixed(2)} - ${Math.max(...closes).toFixed(2)}`);
    
    // Check if data looks reasonable (BTC should be around 60k-100k)
    const avgPrice = closes.reduce((a, b) => a + b, 0) / closes.length;
    console.log(`  Average price: ${avgPrice.toFixed(2)}`);
    if (symbol === 'BTCUSDT' && (avgPrice < 1000 || avgPrice > 200000)) {
      console.warn(`  ⚠️ Warning: Average BTC price (${avgPrice.toFixed(2)}) looks suspicious - data might be wrong timeframe`);
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

