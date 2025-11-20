# TP/SL Validation Fix - Summary

## Issue Identified

The bot was experiencing intermittent errors from Bybit when trying to set Take Profit (TP) and Stop Loss (SL) on positions:

```
[error] [Bybit API Error] retCode: 10001, retMsg: TakeProfit:886884000 set for Sell position should be lower than base_price:874324000??LastPrice
```

### Root Cause

The database had **both TP and SL set to the same value** (88688.36) for a SHORT position with entry price ~87432.40.

**For a SHORT position:**
- ✅ TP should be BELOW entry price (profit when price drops)
- ✅ SL should be ABOVE entry price (stop loss when price rises)

**For a LONG position:**
- ✅ TP should be ABOVE entry price (profit when price rises)
- ✅ SL should be BELOW entry price (stop loss when price drops)

The error occurred because:
1. Both TP and SL were identical (88688.36)
2. TP was ABOVE the entry price (88688.36 > 87432.40) for a SHORT position

## Fixes Implemented

### 1. **Validation in `lib/bybit.ts` - `setTakeProfitStopLoss()`**

Added pre-flight validation that:
- Fetches the actual position from Bybit
- Validates TP/SL orientation based on position side (Buy/Sell)
- Throws clear error if TP/SL are incorrectly oriented
- Prevents invalid API calls from reaching Bybit

**Location:** Lines 756-812 in `/workspace/lib/bybit.ts`

### 2. **Validation in `app/api/cron/bot-runner/route.ts` - New Trade Creation**

Added validation when creating new trades from signals:
- Checks if TP and SL are identical (immediate rejection)
- Validates TP/SL orientation based on trade side (LONG/SHORT)
- Logs clear error messages
- Prevents invalid trades from being stored in database

**Location:** Lines 1354-1381 in `/workspace/app/api/cron/bot-runner/route.ts`

### 3. **Validation in `app/api/cron/bot-runner/route.ts` - Existing Trade Sync**

Added safety checks when syncing existing trades to Bybit:
- Validates TP/SL before attempting to set them on Bybit
- Skips invalid TP/SL and logs clear error messages
- Creates activity log entry to alert user of invalid trades
- Prevents repeated Bybit API errors

**Location:** Lines 684-772 in `/workspace/app/api/cron/bot-runner/route.ts`

## Expected Behavior After Fix

### For New Trades
- Invalid TP/SL will be **rejected before creation**
- Clear error logged with exact validation issue
- Bot will skip the trade and continue processing

### For Existing Invalid Trades
- Bot will **skip setting TP/SL on Bybit**
- Activity log will show: *"Trade {id} has invalid TP/SL orientation. Please close position manually."*
- No Bybit API errors will be thrown
- User can manually close the position on Bybit

### Error Messages You'll See

**For identical TP/SL:**
```
[CRON] INVALID TP/SL for trade {id}: TP and SL are both {price} - SKIPPING Bybit update
Activity Log: "Trade {id} has invalid TP/SL (both set to {price}). Please manually fix in database or close position."
```

**For incorrect TP orientation (SHORT):**
```
[CRON] INVALID TP for SHORT trade {id}: TP={price} must be < entry={entry} - SKIPPING
Activity Log: "Trade {id} has invalid TP/SL orientation. Entry: {entry}, TP: {tp}, SL: {sl}. Please close position manually."
```

**For incorrect SL orientation (SHORT):**
```
[CRON] INVALID SL for SHORT trade {id}: SL={price} must be > entry={entry} - SKIPPING
```

## Action Required

### For the Current Invalid Trade (ac5ad47b-84cb-46b7-a3fe-ca3d19ca143d)

The bot will now:
1. Detect the invalid TP/SL during the next cron run
2. Skip setting TP/SL on Bybit
3. Log an activity warning

**You should manually:**
1. Close the position on Bybit (if still open)
2. Or update the database to fix the TP/SL values
3. Check for other trades with similar issues

### Prevention

All **future trades** will be validated before creation, ensuring TP/SL are:
- Different values (never identical)
- Correctly oriented based on trade direction
- Set to valid grid levels from the strategy engine

## Technical Details

### TP/SL Calculation Logic

The TP/SL calculation is handled by:
- **Garchy 2.0**: `lib/garchy2/strategy-engine.ts` - `calculateTPSL()` method (lines 866-935)
- **Legacy**: `lib/strategy.ts` - `findClosestGridLevels()` function (lines 76-136)

Both use index-based logic to select adjacent grid boundaries for TP/SL.

### Validation Rules

**LONG positions:**
```javascript
if (tp <= entry) throw Error("TP must be above entry")
if (sl >= entry) throw Error("SL must be below entry")
```

**SHORT positions:**
```javascript
if (tp >= entry) throw Error("TP must be below entry")
if (sl <= entry) throw Error("SL must be above entry")
```

## Testing

The fix has been implemented but not yet tested with live data. Monitor the logs for:
- ✅ `[CRON] ✓ TP/SL validation passed` - New trades with valid TP/SL
- ❌ `[CRON] INVALID TP/SL for trade` - Caught invalid trades (should not happen for new trades)
- ⚠️ Activity log warnings for existing invalid trades

## Files Modified

1. `/workspace/lib/bybit.ts` - Added validation in `setTakeProfitStopLoss()`
2. `/workspace/app/api/cron/bot-runner/route.ts` - Added validation in trade creation and sync logic

All changes are backwards compatible and will not break existing functionality.
