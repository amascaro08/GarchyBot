# Orderbook Stale Data Fix

## Problem Identified

Your trading bot was using **stale orderbook data** in the Vercel serverless cron environment, causing excessive fallbacks and trade rejections.

### Symptoms from Logs

```
Best bid: $89,470.10
Best ask: $89,470.20
Current price: $90,619.30
```

**The orderbook data was $1,150 (~1.3%) behind the actual market price!**

This caused:
- `Orderbook confidence too low (0.00)` - No liquidity detected near target levels
- `using enhanced fallback` - System correctly detected bad data
- Signals rejected due to lack of confirmation
- Neutral bias with low confidence (0.30)

## Root Cause

**Vercel Serverless Environment Issue:**
- WebSocket connections don't persist between serverless function invocations
- Old orderbook data was cached from a previous execution
- The system was reusing stale data instead of fetching fresh data via REST API

The logs showed:
```
[ORDERFLOW] Using cached WebSocket orderbook snapshot for BTCUSDT
```

This cached data was from a previous cron run and was severely outdated.

## What I Fixed

### 1. **Stale Data Detection** (`/workspace/lib/garchy2/orderflow.ts`)

Added timestamp-based staleness check:
```typescript
// In serverless, check if snapshot is stale (> 10 seconds old)
const MAX_SNAPSHOT_AGE_MS = 10000; // 10 seconds
const isSnapshotStale = snapshot && (Date.now() - snapshot.ts > MAX_SNAPSHOT_AGE_MS);

if (isServerless && snapshot && isSnapshotStale) {
  const ageSeconds = ((Date.now() - snapshot.ts) / 1000).toFixed(1);
  console.log(`[ORDERFLOW] ⚠ Cached orderbook data is ${ageSeconds}s old (stale) - fetching fresh data via REST API`);
  snapshot = null; // Force refresh via REST API
}
```

### 2. **Price Sanity Check**

Added validation to ensure orderbook prices are reasonable:
```typescript
// Sanity check: Verify orderbook prices are within 2% of current price
const bestBid = snapshot.bids[0]?.price || 0;
const bestAsk = snapshot.asks[0]?.price || 0;
const midPrice = (bestBid + bestAsk) / 2;
const priceDeviation = Math.abs(midPrice - currentPrice) / currentPrice;

if (priceDeviation > 0.02) { // More than 2% deviation
  console.log(`[ORDERFLOW] ⚠ WARNING: Orderbook price significantly differs from current price!`);
  console.log(`  This indicates STALE orderbook data - using price action fallback instead`);
  return fallbackSignal;
}
```

### 3. **Enhanced Logging**

Now logs orderbook age and price validation:
```
[ORDERFLOW] Using cached orderbook snapshot for BTCUSDT (50 bids, 50 asks, age: 2.3s)
```

## Why Your Bot Was Correctly Refusing to Trade

**The bot's behavior was actually CORRECT** - it should not trade with bad data:

✅ **Detected stale orderbook** → confidence 0.00  
✅ **Used fallback mode** → neutral bias, low confidence  
✅ **Momentum check failed** → 0/2 candles (needs 2/3)  
✅ **Rejected trade** → No entry without proper confirmation  

**This is good risk management!** The bot refused to trade rather than making decisions on unreliable data.

## Expected Behavior After Fix

With fresh orderbook data, you should see:

### When Conditions Are Good:
```
[ORDERFLOW] ✓ Orderbook data fetched via REST API for BTCUSDT (50 bids, 50 asks)
[ORDERFLOW] Orderbook snapshot details:
  Best bid: $90,615.20 (size: 1.2450)
  Best ask: $90,615.30 (size: 0.8320)
  Current price: $90,615.25
[ORDERFLOW] Orderbook analysis: bias=short, confidence=0.65
[ORDERFLOW]   Bids near level: 12, Notional: $125,440
[ORDERFLOW]   Asks near level: 8, Notional: $87,230
[GARCHY2]   ✓ Rule 4 PASSED - Orderflow confirms (bias: short, confidence: 0.65)
```

### When Conditions Are Not Good:
The bot will still reject trades, but for valid reasons:
- No significant walls detected (correct rejection)
- Momentum not confirmed (correct rejection)
- Price not at optimal level (correct rejection)

## What to Monitor

In your next cron runs, look for:

1. **Fresh data confirmation:**
   ```
   [ORDERFLOW] ⚠ Cached orderbook data is 15.3s old (stale) - fetching fresh data via REST API
   [ORDERFLOW] ✓ Orderbook data fetched via REST API
   ```

2. **Price validation:**
   ```
   Orderbook mid: $90,615.25, Current: $90,615.30, Deviation: 0.01%
   ```
   (Should be < 2%)

3. **Higher confidence when orderbook is good:**
   ```
   [ORDERFLOW] Final signal: bias=long, confidence=0.55
   ```
   (Should be > 0.30 when good liquidity is present)

## Summary

- **Issue:** Stale orderbook data from cached WebSocket in serverless environment
- **Impact:** Bot correctly refused to trade due to unreliable data (0.00 confidence)
- **Fix:** 
  - Detect stale data (>10s old) and force REST API refresh
  - Validate orderbook prices vs current price (<2% deviation)
  - Enhanced logging for debugging
- **Result:** Bot will now have fresh orderbook data for accurate orderflow analysis

The excessive fallbacks should decrease significantly, and when the bot does use fallbacks, it will be for legitimate reasons (no orderbook liquidity) rather than stale data.

## Testing

Deploy this fix and monitor the next few cron runs. You should see:
- "Cached orderbook data is X.Xs old (stale)" messages if old data is detected
- Fresh REST API fetches in serverless environment
- Orderbook prices matching current market price
- Higher orderflow confidence when liquidity is present at levels
