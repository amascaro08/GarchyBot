# Daily Open Entry Feature

## Overview

Your trading bot now supports **daily open entries** as one of the entry conditions. This means the bot can enter trades when price touches the daily open level (calculated at UTC 00:00).

## How It Works

### Entry Logic

The daily open is treated as a key level in the grid system:

**For LONG trades (when open > VWAP and close > VWAP):**
- When price touches the daily open level
- Entry: Daily open price
- Take Profit: U1 (first upper level)
- Stop Loss: D1 (first lower level)

**For SHORT trades (when open < VWAP and close < VWAP):**
- When price touches the daily open level
- Entry: Daily open price
- Take Profit: D1 (first lower level)
- Stop Loss: U1 (first upper level)

### Priority Order

The bot checks levels in this order:

**LONG Bias:**
1. D1 (lowest level) ✓
2. **Daily Open** ✓ ← Your new feature
3. U1 (first upper level) ✓
4. Other levels (U2, U3, D2, D3, etc.) ✓

**SHORT Bias:**
1. **Daily Open** ✓ ← Your new feature
2. U1 (first upper level) ✓
3. D1 and other lower levels ✓
4. Other upper levels ✓

## Configuration

### Database Setup

Run the migration to add the configuration column:

```sql
-- Run this on your Neon database
ALTER TABLE bot_configs 
ADD COLUMN IF NOT EXISTS use_daily_open_entry BOOLEAN NOT NULL DEFAULT true;
```

Or use the provided migration file:
```bash
# Copy the SQL from migration_add_daily_open_entries.sql
# and run it in your Neon database console
```

### Enabling/Disabling Daily Open Entries

You can control this feature per user via the bot configuration:

**API Request (POST /api/bot/config):**
```json
{
  "use_daily_open_entry": true  // or false to disable
}
```

**Default:** Enabled (true)

### Checking Current Setting

**API Request (GET /api/bot/config):**
```bash
curl https://your-app.vercel.app/api/bot/config \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Response includes:**
```json
{
  "success": true,
  "botConfig": {
    "use_daily_open_entry": true,
    // ... other settings
  }
}
```

## Monitoring Daily Open Entries

### Vercel Logs

When the bot detects and enters a daily open trade, you'll see logs like:

```
[CRON] Bot settings - ... daily open entries: ENABLED
[CRON] Fetched levels - k%: 2.50%, VWAP: 89543.21, Daily Open: 89234.56
[CRON] Signal detected - LONG at 89234.56, Reason: Long signal: touched daily open at 89234.56
[CRON] ✓ Daily open entry detected! Price touched 89234.56
[CRON] New trade signal - LONG @ 89234.56, Risk: $100.00, Position size: 0.0234
```

### Activity Logs

Daily open entries are logged in your activity log with the reason:
- `"Long signal: touched daily open at $89234.56"`
- `"Short signal: touched daily open at $89234.56"`

## Example Scenarios

### Scenario 1: LONG Entry at Daily Open

```
Market State:
- Daily Open: $89,000
- VWAP: $88,500
- Current Price: $89,000 (touching daily open)
- Open > VWAP ✓
- Close > VWAP ✓

Bot Action:
- Entry: $89,000 (daily open)
- TP: $89,500 (U1 level)
- SL: $88,500 (D1 level)
- Position Size: Based on risk settings
```

### Scenario 2: SHORT Entry at Daily Open

```
Market State:
- Daily Open: $89,000
- VWAP: $89,500
- Current Price: $89,000 (touching daily open)
- Open < VWAP ✓
- Close < VWAP ✓

Bot Action:
- Entry: $89,000 (daily open)
- TP: $88,500 (D1 level)
- SL: $89,500 (U1 level)
- Position Size: Based on risk settings
```

### Scenario 3: Daily Open Entries Disabled

```
Bot Config:
- use_daily_open_entry: false

Bot Behavior:
- Skips daily open level completely
- Only checks D1, U1, and other grid levels
- No entries at daily open price
```

## Integration with Other Features

Daily open entries work seamlessly with:

✅ **Custom GARCH Levels** - Grid levels are calculated from daily open
✅ **Position Sizing** - Uses your capital and risk settings
✅ **Daily Limits** - Respects daily target and stop loss
✅ **Order Book Confirmation** - Optional validation before entry
✅ **Breakeven Logic** - Moves SL to breakeven when price flips VWAP
✅ **Max Trades** - Counts toward your max concurrent positions

## Complete Bot Settings

Your bot now has these configurable entry conditions:

| Setting | Description | Default |
|---------|-------------|---------|
| `use_daily_open_entry` | Enable entries at daily open | `true` |
| `subdivisions` | Number of grid levels | `5` |
| `no_trade_band_pct` | Dead zone around VWAP | `0.001` |
| `use_orderbook_confirm` | Order book validation | `true` |
| `garch_mode` | Auto or custom volatility | `auto` |
| `custom_k_pct` | Custom k% value | `0.03` |
| `max_trades` | Max concurrent trades | `3` |
| `risk_amount` | Risk per trade | `100` |
| `risk_type` | Fixed or percent | `fixed` |

## Testing

### Test Daily Open Entry

1. **Enable the feature:**
```bash
curl -X POST https://your-app.vercel.app/api/bot/config \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"use_daily_open_entry": true}'
```

2. **Start the bot:**
```bash
curl -X POST https://your-app.vercel.app/api/bot/start \
  -H "Authorization: Bearer YOUR_TOKEN"
```

3. **Monitor logs** in Vercel Dashboard:
   - Go to your project → Logs
   - Filter by "CRON"
   - Look for "daily open entry detected"

4. **Check activity logs:**
```bash
curl https://your-app.vercel.app/api/bot/status \
  -H "Authorization: Bearer YOUR_TOKEN"
```

Look for entries with reason containing "touched daily open".

### Test Disabling Daily Open Entry

1. **Disable the feature:**
```bash
curl -X POST https://your-app.vercel.app/api/bot/config \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"use_daily_open_entry": false}'
```

2. **Verify in logs:**
```
[CRON] Bot settings - ... daily open entries: DISABLED
```

3. **Confirm behavior:**
   - Bot will skip daily open level
   - Only enters at other grid levels (D1, U1, U2, etc.)
   - No "touched daily open" messages in logs

## Technical Details

### Code Changes

**Files Modified:**
1. `/lib/db.ts` - Added `use_daily_open_entry` to BotConfig interface
2. `/lib/strategy.ts` - Added `useDailyOpenEntry` parameter to signal function
3. `/app/api/bot/config/route.ts` - Added to safe fields list
4. `/app/api/signal/route.ts` - Passes setting to strategy function
5. `/app/api/cron/bot-runner/route.ts` - Passes setting and logs entries

### Signal Detection

The strategy checks if the last candle's high/low range includes the daily open price:

```typescript
if (useDailyOpenEntry && low <= dOpen && dOpen <= high) {
  // Entry at daily open
  return {
    side: 'LONG' or 'SHORT',
    entry: dOpen,
    tp: calculated_tp,
    sl: calculated_sl,
    reason: `Signal: touched daily open at ${dOpen}`
  };
}
```

### Daily Open Calculation

Daily open is calculated at UTC 00:00 boundary:
- Finds the most recent UTC midnight timestamp
- Uses the open price of the first candle after that boundary
- This is the anchor point for the grid system

## FAQ

**Q: Is daily open entry enabled by default?**
A: Yes, it's enabled by default for all users.

**Q: Can I disable it temporarily?**
A: Yes, use the config API to set `use_daily_open_entry: false`.

**Q: Does it count toward max_trades limit?**
A: Yes, all entries count toward your max concurrent positions.

**Q: What if daily open = VWAP?**
A: The no-trade band around VWAP will prevent the entry.

**Q: Can I have custom take profit/stop loss for daily open entries?**
A: Currently, TP/SL are calculated automatically based on grid levels. Future updates may add custom TP/SL settings.

**Q: Will this work with testnet and mainnet?**
A: Yes, daily open calculation works the same on both.

## Best Practices

1. **Keep it enabled** for maximum trading opportunities
2. **Monitor logs** to see how often daily open is touched
3. **Adjust risk settings** based on daily open entry performance
4. **Combine with GARCH levels** for optimal grid spacing
5. **Use order book confirmation** to validate daily open touches

## Summary

✅ Daily open entries are now fully supported  
✅ Configurable per user via database  
✅ Works with all existing features  
✅ Comprehensive logging for monitoring  
✅ Easy to enable/disable via API  

Your bot will now catch more trading opportunities by entering at the daily open level! 🎯
