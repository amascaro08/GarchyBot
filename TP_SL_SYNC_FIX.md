# TP/SL Sync Fix - Manual Changes Now Respected

## Problem
When users manually adjusted Take Profit (TP) or Stop Loss (SL) values on Bybit during an active trade, the bot would revert them back to the original database values on the next cron run. This prevented users from manually managing their positions.

## Root Cause
The bot was pushing database TP/SL values to Bybit on every cron run without first checking what was currently set on Bybit. This created a one-way sync: **Database → Bybit**, which overwrote any manual changes made directly on the exchange.

## Solution
Implemented bidirectional sync where **Bybit is the source of truth for manual changes**:

### 1. Sync FROM Bybit TO Database (lines 495-536 in bot-runner)
- On every cron run, fetch current TP/SL values from Bybit for open positions
- Compare with database values
- If they differ (by more than $0.01), update database with Bybit's values
- Log the sync as an activity for transparency

### 2. Only Push TO Bybit When Necessary (lines 677-727 in bot-runner)
- **Before**: Bot would push TP/SL to Bybit if values differed
- **After**: Bot only sets TP/SL on Bybit if they're completely missing (new position)
- Never overwrites existing Bybit values - those are synced to DB instead

### 3. Respect Manual Changes for Automatic Adjustments (lines 755-836 in bot-runner)
- Bot can automatically adjust SL for breakeven and trailing stops
- **New safeguard**: Before applying automatic adjustments, check if SL was manually changed on Bybit
- If manually changed: Skip automatic adjustments and log a message
- This prevents the bot from fighting user's manual decisions

## Changes Made

### `/workspace/app/api/cron/bot-runner/route.ts`

#### Change 1: Sync TP/SL from Bybit to Database (after line 493)
```typescript
// Sync TP/SL from Bybit to database (respect manual changes on Bybit)
if (position) {
  const bybitTP = parseFloat(position.takeProfit || '0') || null;
  const bybitSL = parseFloat(position.stopLoss || '0') || null;
  const dbTP = trade.tp_price ? Number(trade.tp_price) : null;
  const dbSL = trade.current_sl ? Number(trade.current_sl) : (trade.sl_price ? Number(trade.sl_price) : null);
  
  // If Bybit TP/SL differs from database, update database (Bybit is source of truth)
  const tpChanged = bybitTP !== dbTP && Math.abs((bybitTP || 0) - (dbTP || 0)) > 0.01;
  const slChanged = bybitSL !== dbSL && Math.abs((bybitSL || 0) - (dbSL || 0)) > 0.01;
  
  if (tpChanged || slChanged) {
    // Update database with Bybit's values
    await updateTrade(trade.id, updates);
    await addActivityLog(...); // Log the sync
  }
}
```

#### Change 2: Only Set TP/SL if Missing on Bybit (lines 677-727)
```typescript
// Only set TP/SL if they're NOT already set on Bybit (e.g., new position)
// Never overwrite existing Bybit values - those are synced to DB instead
const shouldSetTP = !bybitTP && tradeTP > 0;
const shouldSetSL = !bybitSL && tradeSL > 0;
```

#### Change 3: Respect Manual Changes for Automatic Adjustments (lines 755-836)
```typescript
// Check if Bybit SL matches our database - if not, user manually changed it
const slManuallyChanged = bybitSL !== null && Math.abs(bybitSL - currentSl) > 0.01;

if (!slManuallyChanged) {
  // Only apply automatic SL adjustments if SL hasn't been manually changed
  // Apply breakeven, trailing stops, etc.
} else {
  console.log('Skipping automatic SL adjustment - SL was manually changed on Bybit');
}
```

## Behavior Now

### Scenario 1: Manual TP/SL Change on Bybit
1. User opens a position via bot: Entry=$100, TP=$110, SL=$95
2. User manually changes on Bybit: SL=$97 (tighter stop)
3. Next cron run (within 1 minute):
   - Bot fetches position from Bybit, sees SL=$97
   - Bot detects difference: DB=$95, Bybit=$97
   - Bot updates database: SL=$97
   - Bot logs: "TP/SL synced from Bybit for BTCUSDT: SL=$97.00"
   - Bot skips automatic SL adjustments (respects manual change)

### Scenario 2: Manual TP/SL Change via Bot UI
1. User changes SL via bot UI to $96
2. UI endpoint updates Bybit first, then database
3. Next cron run: Values match, no sync needed
4. Bot can apply automatic adjustments (trailing stop, breakeven) since change was made via bot

### Scenario 3: New Position
1. Bot places order on Bybit
2. Order fills, position created
3. TP/SL not yet set on Bybit
4. Bot detects missing TP/SL, sets them: TP=$110, SL=$95
5. Future runs: TP/SL already set, no action needed

### Scenario 4: Automatic Breakeven
1. Position open with SL=$95
2. Price moves favorably, then starts to reverse
3. Bot calculates breakeven SL=$100 (entry price)
4. Bot checks: Bybit SL still=$95 (matches DB)
5. Bot applies breakeven: Updates DB and Bybit to SL=$100
6. If user had manually changed SL on Bybit, bot would skip this step

## Benefits
1. **User Control**: Manual adjustments on Bybit are immediately recognized and preserved
2. **Transparency**: All syncs are logged in activity feed
3. **Automatic Features Still Work**: Breakeven and trailing stops work when user hasn't manually intervened
4. **No Overwrites**: Bot never fights with user's manual decisions
5. **Fast Sync**: Changes detected within 1 minute (cron interval)

## Testing Recommendations
1. Open a position via bot
2. Manually change TP/SL on Bybit exchange
3. Wait for next cron run (max 1 minute)
4. Check bot UI - should show updated values
5. Check activity log - should see "TP/SL synced from Bybit"
6. Verify automatic adjustments are skipped for manually changed positions

## Related Files
- `/workspace/app/api/cron/bot-runner/route.ts` - Main bot logic with sync
- `/workspace/app/api/trades/[id]/sl/route.ts` - Manual SL update endpoint (unchanged, works correctly)
- `/workspace/lib/tpsl-sync-manager.ts` - TP/SL deduplication manager (unchanged, still prevents duplicate API calls)
