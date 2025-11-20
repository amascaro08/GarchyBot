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

## Integration
The function is already integrated in:
- ✅ `/workspace/app/api/cron/bot-runner/route.ts` (line 801, 885)
- ✅ Both live mode (with Bybit positions) and demo mode
- ✅ Properly updates database and Bybit via `setTakeProfitStopLoss`

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

## Notes

- The bot checks and updates stops on every cron run (1-minute intervals)
- Manual SL changes on Bybit are respected (bot won't override)
- TP/SL sync from Bybit ensures Bybit is always the source of truth
- Includes safety checks to prevent immediate stop-outs
