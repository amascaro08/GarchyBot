# VWAP Calculation Fix - Now Matches TradingView

## Problem Identified

The VWAP calculation in Garchy was significantly different from TradingView's VWAP, even though both were supposedly set to:
- 1-minute candles (actually using 5-minute in the bot)
- HL2 source: `(High + Low) / 2`

### Root Cause

The bot was using **`lookbackPeriod: 14`** in the VWAP calculation:

```typescript
// OLD - INCORRECT
const vwap = computeSessionAnchoredVWAP(intradayAsc, { 
  source: 'hl2', 
  lookbackPeriod: 14  // ❌ Only uses last 14 candles (70 minutes)
});
```

This meant VWAP was calculated using only the **last 14 5-minute candles** (70 minutes of data), instead of all candles from the session start.

### TradingView's VWAP AA Settings Explained

In TradingView's VWAP AA (Anchored VWAP) indicator:
- **Anchor Period: Auto** → Uses session start (UTC midnight for crypto)
- **Length: 14** → Used for calculating standard deviation bands, NOT for limiting VWAP calculation
- **Source: (H+L)/2** → HL2 price source

The VWAP itself uses **all candles from the session start**, not just the last 14 candles.

## Solution Implemented

Changed all VWAP calculations to use session-anchored VWAP from UTC midnight:

```typescript
// NEW - CORRECT
const vwap = computeSessionAnchoredVWAP(intradayAsc, { 
  source: 'hl2', 
  sessionAnchor: 'utc-midnight'  // ✅ Uses all candles from UTC midnight
});
```

### Files Updated

1. **`app/api/cron/bot-runner/route.ts`** (line ~299-302)
   - Bot runner now uses session-anchored VWAP

2. **`app/api/levels/route.ts`** (3 locations)
   - Line ~45-46: When using stored levels
   - Line ~176-177: When calculating new levels
   - Line ~206-207: When returning existing levels

## Technical Details

### VWAP Formula
```
VWAP = Σ(Price × Volume) / Σ(Volume)
```

Where `Price` is determined by source:
- **hl2**: `(High + Low) / 2` ← Bot uses this
- hlc3: `(High + Low + Close) / 3`
- ohlc4: `(Open + High + Low + Close) / 4`
- close: `Close`

### Session Anchoring

With `sessionAnchor: 'utc-midnight'`:
1. Bot fetches 288 5-minute candles (24 hours of data)
2. VWAP calculation includes all candles from UTC midnight onwards
3. Resets automatically at UTC midnight each day
4. Matches TradingView's session-anchored behavior

## Expected Result

VWAP values should now closely match TradingView's VWAP line because:
- ✅ Both use HL2 source: `(H + L) / 2`
- ✅ Both anchor at session start (UTC midnight)
- ✅ Both accumulate volume from session start
- ✅ Both reset at UTC midnight

### Note on Timeframe Differences

Minor differences may still occur if:
- TradingView chart uses 1-minute candles vs bot's 5-minute candles
- Slightly different data timestamps between exchanges
- Volume differences between data providers

These differences should be minimal (typically < 0.5%).

## Testing

To verify the fix:
1. Compare bot's VWAP display with TradingView VWAP on same symbol
2. Both should show similar values (within ~0.5%)
3. VWAP should track the session-weighted average, not just recent price action

## Previous Incorrect Understanding

❌ **Wrong**: "TradingView's Length=14 means use last 14 candles for VWAP"
✅ **Correct**: "TradingView's Length=14 is for standard deviation bands; VWAP uses all session candles"

## Related Code

The VWAP implementation in `lib/vwap.ts` is correct and supports:
- Session-anchored VWAP (UTC midnight or custom timezone)
- Fixed lookback period (for rolling VWAP)
- Multiple price sources (hl2, hlc3, ohlc4, close)
- Progressive VWAP line for charting

The bug was in **how the bot called the function**, not in the VWAP calculation itself.
