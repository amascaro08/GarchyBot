# Improved Stop Loss Management

## Problem
The previous stop loss logic was too conservative:
- Required **0.25x risk** (25% of risk amount) in profit before trailing
- For a trade with 1144 points of risk, needed ~286 points profit before SL moved
- At 0.71% profit (~650 points), SL still hadn't moved from initial level
- No early breakeven protection to cover fees

## Solution
Implemented a **3-stage stop loss management system**:

### Stage 1: Early Breakeven Protection ✅
- **Activates at:** 0.15% profit (covers Bybit's 0.075% maker/taker fees)
- **Action:** Moves SL to breakeven + 0.08% buffer
- **Purpose:** Ensures profitable trades don't turn into losses due to fees
- **Example:** At $91,000 entry, breakeven activates at $91,136.50 (0.15% profit)

### Stage 2: Initial Trailing ✅  
- **Activates at:** 0.3% profit
- **Trailing distance:** 0.2% (20 bps) behind current price
- **Action:** Starts trailing stop to lock in profits
- **Example:** At $91,000 entry, trailing starts at $91,273 (0.3% profit)

### Stage 3: Progressive Tightening ✅
- **At 0.5% profit:** Tightens to 0.15% (15 bps) behind price
- **At 1.0% profit:** Tightens to 0.1% (10 bps) behind price  
- **Purpose:** Locks in more profit as position becomes more profitable
- **Example:** At 1% profit on $91,000 entry = $91,910, SL trails at $91,819

## Code Changes

### Updated Function: `computeTrailingBreakeven`
**Location:** `/workspace/lib/strategy.ts` (lines 697-810)

**Key Changes:**
1. Added `breakevenProfitPct` parameter (default 0.15%)
2. Added `trailingStartPct` parameter (default 0.3%)
3. Implemented 3-stage logic with progressive tightening
4. Added detailed console logging for debugging

**Parameters:**
```typescript
function computeTrailingBreakeven(
  side: 'LONG' | 'SHORT',
  entry: number,
  initialSl: number,
  currentSl: number,
  lastClose: number,
  offsetBps: number = 5,              // Trailing offset (not used until Stage 2)
  breakevenProfitPct: number = 0.0015, // 0.15% profit threshold
  trailingStartPct: number = 0.003    // 0.3% profit threshold
): number | null
```

## Serverless Integration ✅

### Vercel Cron Configuration
**File:** `/workspace/vercel.json`
```json
{
  "crons": [
    {
      "path": "/api/cron/bot-runner",
      "schedule": "* * * * *"  // Runs every minute
    }
  ]
}
```

### Bot Runner Integration
**File:** `/workspace/app/api/cron/bot-runner/route.ts`

The improved stop loss logic is **fully integrated** into the serverless cron job:

1. **Line 801** - LIVE MODE (with actual Bybit positions):
   - ✅ Calls `computeTrailingBreakeven` with live market price
   - ✅ Updates database with new SL
   - ✅ Updates Bybit position via `setTakeProfitStopLoss`
   - ✅ Logs activity to user's activity log

2. **Line 885** - DEMO MODE (candle-based simulation):
   - ✅ Calls `computeTrailingBreakeven` with last candle close
   - ✅ Updates database with new SL
   - ✅ Logs activity to user's activity log

### How It Works

**Every minute, the Vercel cron job:**
1. Fetches all active trades from the database
2. Gets current market price from Bybit (or latest candle)
3. Calculates current profit percentage
4. Applies stop loss logic:
   - **Stage 1:** Moves to breakeven at 0.15% profit
   - **Stage 2:** Starts trailing at 0.3% profit
   - **Stage 3:** Tightens trailing as profit increases
5. Updates database and Bybit with new SL
6. Logs the change to activity log

**This works 24/7 in the background** - no need to keep the webpage open!

## Example Scenario

**Your Current Trade:**
- Entry: $91,168.70
- Current price: $91,818.50
- Profit: $649.80 (0.71%)
- Current SL: $90,024.10 (still at initial level ❌)

**With New Logic:**
1. **At 0.15% profit** ($91,305.50): SL moves to $91,241.60 (breakeven + fees) ✅
2. **At 0.3% profit** ($91,442.30): SL starts trailing at $91,259.50 ✅
3. **At 0.71% profit** ($91,818.50): SL should be at ~$91,680 (0.15% behind) ✅

**Protection:**
- Your trade is now protected at breakeven
- If price continues up, SL trails behind
- If price reverses, you're locked in with profit

## Benefits

1. **Fee Protection**: Never lose money on winning trades due to fees
2. **Early Protection**: Moves to breakeven quickly (within 0.15% profit)
3. **Profit Locking**: Trails behind price to lock in gains
4. **Dynamic Tightening**: Tightens as profit increases
5. **Risk Management**: Always keeps stop at least at breakeven once activated

## Testing

To test the new logic:
1. Open a trade via the bot
2. Monitor console logs for `[TRAILING-STOP]` messages
3. Verify SL moves to breakeven at ~0.15% profit
4. Verify trailing starts at ~0.3% profit
5. Check Bybit position to confirm SL updates

## Important Notes

### Serverless Operation
- ✅ **Works 24/7** via Vercel cron (no need to keep webpage open)
- ✅ **Runs every minute** - checks all active trades automatically
- ✅ **Fully autonomous** - manages stops in the background
- ✅ **Survives restarts** - runs on Vercel's infrastructure, not your computer

### Safety Features
- ✅ **Manual changes respected** - if you manually adjust SL on Bybit, bot won't override
- ✅ **Bybit is source of truth** - bot syncs from Bybit first, then applies logic
- ✅ **Grace periods** - won't immediately trigger after entry
- ✅ **Prevents stop-outs** - checks price position before moving stops

### Monitoring
- Check Vercel logs: Filter by `/api/cron/bot-runner`
- Look for `[TRAILING-STOP]` console messages
- Activity log shows all SL adjustments with timestamps
- Database tracks `current_sl` vs original `sl_price`
