// Test script to check live VWAP calculation
// This will help us debug the difference with TradingView

const fetch = require('node-fetch');

async function testVWAPCalculation() {
  console.log('Fetching BTC 5-minute candles from Bybit...\n');
  
  const symbol = 'BTCUSDT';
  const interval = '5';
  const limit = 288; // 24 hours
  
  try {
    const url = `https://api.bybit.com/v5/market/kline?category=linear&symbol=${symbol}&interval=${interval}&limit=${limit}`;
    const response = await fetch(url);
    const data = await response.json();
    
    if (data.retCode !== 0) {
      console.error('API Error:', data.retMsg);
      return;
    }
    
    // Bybit returns: [startTime, open, high, low, close, volume, turnover]
    // And it's in DESCENDING order (newest first)
    const candles = data.result.list.map(item => ({
      ts: parseInt(item[0]),
      open: parseFloat(item[1]),
      high: parseFloat(item[2]),
      low: parseFloat(item[3]),
      close: parseFloat(item[4]),
      volume: parseFloat(item[5])
    }));
    
    console.log(`Fetched ${candles.length} candles`);
    console.log(`Newest candle time: ${new Date(candles[0].ts).toISOString()}`);
    console.log(`Oldest candle time: ${new Date(candles[candles.length-1].ts).toISOString()}\n`);
    
    // Reverse to ascending order (oldest first)
    const candlesAsc = candles.slice().reverse();
    
    // Find UTC midnight for today
    const now = new Date();
    const midnightUTC = new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      0, 0, 0, 0
    ));
    const midnightTs = midnightUTC.getTime();
    
    console.log(`UTC Midnight: ${midnightUTC.toISOString()}`);
    console.log(`Filtering candles from UTC midnight onwards...\n`);
    
    // Filter to only candles from UTC midnight onwards
    const sessionCandles = candlesAsc.filter(c => c.ts >= midnightTs);
    
    console.log(`Session candles (from UTC midnight): ${sessionCandles.length}`);
    if (sessionCandles.length > 0) {
      console.log(`First session candle: ${new Date(sessionCandles[0].ts).toISOString()}`);
      console.log(`Last session candle: ${new Date(sessionCandles[sessionCandles.length-1].ts).toISOString()}\n`);
    }
    
    // Calculate VWAP using HL2
    let totalPriceVolume = 0;
    let totalVolume = 0;
    
    for (const candle of sessionCandles) {
      const hl2 = (candle.high + candle.low) / 2;
      totalPriceVolume += hl2 * candle.volume;
      totalVolume += candle.volume;
    }
    
    const vwap = totalPriceVolume / totalVolume;
    
    console.log('=== VWAP CALCULATION ===');
    console.log(`Source: HL2 (High + Low) / 2`);
    console.log(`Total Price*Volume: ${totalPriceVolume.toFixed(2)}`);
    console.log(`Total Volume: ${totalVolume.toFixed(2)}`);
    console.log(`VWAP: $${vwap.toFixed(2)}`);
    console.log('\nCompare this value with TradingView VWAP');
    console.log('Settings to match:');
    console.log('  - Anchor: Session (or Auto for daily session)');
    console.log('  - Source: (H+L)/2');
    console.log('  - Symbol: BTCUSDT');
    console.log('  - Exchange: Bybit');
    
    // Also show current price for reference
    const currentPrice = sessionCandles[sessionCandles.length - 1].close;
    console.log(`\nCurrent Price: $${currentPrice.toFixed(2)}`);
    console.log(`VWAP vs Price: ${vwap > currentPrice ? 'above' : 'below'} (${((Math.abs(vwap - currentPrice) / currentPrice) * 100).toFixed(2)}% difference)`);
    
  } catch (error) {
    console.error('Error:', error.message);
  }
}

testVWAPCalculation();
