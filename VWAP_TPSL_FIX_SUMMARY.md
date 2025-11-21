# VWAP & TP/SL Placement Fix Summary

## Issues Identified

### 1. VWAP Calculation Discrepancy

**Problem:** Bot's VWAP ($888.86) was significantly different from TradingView (~$860)

**Root Cause:**
- **Lookback Period Mismatch:** Bot was using ALL available candles (288 candles = 24 hours) while TradingView was using only the last 14 candles
- **Source Type Mismatch:** Bot was incorrectly labeling the source as 'hlc3' but implementing HL2 ((H+L)/2)

**TradingView Settings (from screenshot):**
- **Anchor Period:** Auto
- **Length:** 14
- **Source:** (H + L)/2 (which is HL2, not HLC3)

### 2. TP/SL Placement

**Status:** ✅ Already correct - Daily Open IS included as a level

**Verification:** The `findClosestGridLevels()` function already includes Daily Open in the level array:
```typescript
const allLevels = [...dnLevels, dOpen, ...upLevels]
```

This means TP/SL are correctly set to the nearest grid level, which includes:
- Lower levels (D1, D2, D3, D4, D5)
- Daily Open
- Upper levels (U1, U2, U3, U4, U5)

## Changes Made

### 1. Fixed VWAP Source Type

**File:** `/workspace/lib/vwap.ts`

**Changes:**
- Added 'hl2' as a proper source type (high + low) / 2
- Fixed 'hlc3' to use correct formula: (high + low + close) / 3
- Updated default source from 'hlc3' to 'hl2' to match TradingView
- Updated type definitions and comments

```typescript
export type VwapSource = 'close' | 'hl2' | 'hlc3' | 'ohlc4';

function getTypicalPrice(candle: Candle, source: VwapSource): number {
  switch (source) {
    case 'close':
      return candle.close;
    case 'hl2':
      return (candle.high + candle.low) / 2;
    case 'hlc3':
      return (candle.high + candle.low + candle.close) / 3;
    case 'ohlc4':
      return (candle.open + candle.high + candle.low + candle.close) / 4;
    default:
      return candle.close;
  }
}
```

### 2. Fixed VWAP Lookback Period

**Files Updated:**
- `/workspace/app/api/levels/route.ts` (3 locations)
- `/workspace/app/api/cron/bot-runner/route.ts` (1 location)

**Change:**
```typescript
// BEFORE: Used all candles (up to 288 candles = 24 hours)
const vwap = computeSessionAnchoredVWAP(intradayAsc, { source: 'hlc3', useAllCandles: true });

// AFTER: Uses last 14 candles to match TradingView
const vwap = computeSessionAnchoredVWAP(intradayAsc, { source: 'hl2', lookbackPeriod: 14 });
```

## VWAP Settings Now Match TradingView

| Setting | TradingView | GarchyBot (Fixed) |
|---------|-------------|-------------------|
| **Source** | (H + L)/2 | hl2 |
| **Lookback Period** | 14 | 14 |
| **Anchor** | Auto (rolling) | lookbackPeriod: 14 (rolling) |

## TP/SL Placement Verification

The TP/SL placement logic in `findClosestGridLevels()` is **already correct** and includes Daily Open as a level.

### Example Test Results

**Setup:**
- Daily Open: $869.30
- Volatility (GARCH%): 6.05%
- Upper Range: $921.89
- Lower Range: $816.71
- Subdivisions: 5

**All Levels (11 total):**
1. D5: $816.71 (lower boundary)
2. D4: $827.23
3. D3: $837.74
4. D2: $848.26
5. D1: $858.78
6. **Daily Open: $869.30** ← Included as a level
7. U1: $879.82
8. U2: $890.34
9. U3: $900.86
10. U4: $911.37
11. U5: $921.89 (upper boundary)

### Example Trades

**LONG Entry at D1 ($858.78):**
- Entry: $858.78 (index 4)
- TP: $869.30 (index 5) ← **Daily Open**
- SL: $848.26 (index 3) ← D2

**SHORT Entry at U1 ($879.82):**
- Entry: $879.82 (index 6)
- TP: $869.30 (index 5) ← **Daily Open**
- SL: $890.34 (index 7) ← U2

**LONG Entry at Daily Open ($869.30):**
- Entry: $869.30 (index 5)
- TP: $879.82 (index 6) ← U1
- SL: $858.78 (index 4) ← D1

## Expected Results

After these fixes, the bot's VWAP calculation should now:
1. ✅ Match TradingView's VWAP value (~$860 in your example)
2. ✅ Use the correct source formula: HL2 = (High + Low) / 2
3. ✅ Use the correct lookback period: 14 candles
4. ✅ Update in real-time with a rolling 14-candle window

TP/SL placement:
- ✅ Already correctly includes Daily Open as a valid TP/SL level
- ✅ Sets TP/SL to the nearest grid level (including Daily Open)

## Files Modified

1. `/workspace/lib/vwap.ts` - Core VWAP calculation logic
2. `/workspace/app/api/levels/route.ts` - Levels calculation endpoint
3. `/workspace/app/api/cron/bot-runner/route.ts` - Background bot trading logic

## Testing Recommendations

1. **Verify VWAP Match:**
   - Compare bot's VWAP with TradingView VWAP AA (Length=14, Source=(H+L)/2)
   - Should be identical or very close (within rounding errors)

2. **Verify TP/SL Placement:**
   - Check trades that enter at D1 → TP should be Daily Open
   - Check trades that enter at U1 → TP should be Daily Open
   - Check trades that enter at Daily Open → TP should be U1 (LONG) or D1 (SHORT)

3. **Monitor Real-Time Updates:**
   - VWAP should update every 5 minutes as new candles arrive
   - Should always reflect the last 14 candles only

## Notes

- The bot now correctly distinguishes between:
  - **HL2** = (H + L) / 2 (midpoint) ← Now using this
  - **HLC3** = (H + L + C) / 3 (typical price)
  - **OHLC4** = (O + H + L + C) / 4 (average price)

- Daily Open is treated as a **special level** in the grid and is always included in TP/SL calculations
- This ensures trades that enter at nearby levels can use Daily Open as a profit target (mean reversion)
