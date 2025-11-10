# Background Bot Settings Persistence - FIXED

## Problem
The background bot running on Vercel was not persisting user settings properly. Settings like:
- Custom GARCH levels (k%)
- Profit targets  
- Position size amounts
- Risk settings (fixed vs percentage)
- Subdivisions
- Daily P&L limits
- Order book confirmation settings

These settings were being saved to the database but were not being used by the background bot cron job.

## Root Cause
The issue was in `/app/api/cron/bot-runner/route.ts`:

1. **Incorrect URL Construction**: The cron job was using `process.env.VERCEL_URL` to make internal API calls, but this environment variable does NOT include the protocol (`https://`). This caused all internal fetch requests to fail with malformed URLs like `my-app.vercel.app/api/levels` instead of `https://my-app.vercel.app/api/levels`.

2. **Failed API Calls**: When the fetch calls failed, the bot couldn't retrieve:
   - Market data (klines)
   - GARCH levels with user's custom settings
   - Trading signals based on user's configuration

3. **Result**: The bot would either crash or use default/incorrect values instead of the user's configured settings.

## The Fix

### Changes Made to `bot-runner/route.ts`:

1. **Added proper base URL construction** (line 46-50):
```typescript
// Build base URL for internal API calls
// On Vercel, VERCEL_URL doesn't include protocol, so we need to add https://
const baseUrl = process.env.VERCEL_URL 
  ? `https://${process.env.VERCEL_URL}` 
  : 'http://localhost:3000';
```

2. **Updated all fetch calls** to use the corrected `baseUrl`:
   - Klines API call (line 95)
   - Levels API call (line 111)  
   - Signal API call (line 195)

3. **Enhanced NULL checking** for custom GARCH settings (line 119):
```typescript
...(botConfig.garch_mode === 'custom' && botConfig.custom_k_pct !== null && { customKPct: botConfig.custom_k_pct })
```

4. **Added comprehensive logging** to track settings:
   - Bot configuration on startup (line 71)
   - Fetched levels confirmation (line 130)
   - Position size calculations (line 254)

## How User Settings Work Now

When the background bot runs every minute:

1. **Load User Config**: Fetches the user's `bot_configs` row from the database with all their settings
2. **Apply Custom GARCH**: If `garch_mode = 'custom'`, uses `custom_k_pct` value; otherwise calculates from market data
3. **Calculate Position Size**: Uses `capital`, `risk_amount`, and `risk_type` settings
4. **Respect Trading Rules**: Uses `subdivisions`, `no_trade_band_pct`, `use_orderbook_confirm`, etc.
5. **Enforce Limits**: Checks `max_trades`, `daily_target_amount`, `daily_stop_amount` before each trade

## Verification Steps

To verify your settings are persisting correctly:

### 1. Check Vercel Logs
Go to your Vercel deployment logs and look for:
```
[CRON] Bot settings - GARCH mode: custom, custom k%: 0.025, subdivisions: 5, risk: 100 (fixed), capital: 10000
[CRON] Fetched levels - k%: 2.50%, VWAP: 89543.21, Daily Open: 89234.56
[CRON] New trade signal - LONG @ 89123.45, Risk: $100.00, Position size: 0.0234
```

### 2. Test Settings Changes
1. Update bot settings via the UI (e.g., change custom k% from 2.5% to 3.0%)
2. Save the settings
3. Wait for next cron job execution (within 1 minute)
4. Check logs to confirm new k% is being used: `custom k%: 0.03`

### 3. Verify Database Persistence
Run this query in your database:
```sql
SELECT user_id, garch_mode, custom_k_pct, capital, risk_amount, risk_type, 
       subdivisions, no_trade_band_pct, is_running 
FROM bot_configs;
```

Your settings should be stored here and match what you configured in the UI.

## Settings That Persist

All of these settings now persist correctly:

| Setting | Database Column | Description |
|---------|----------------|-------------|
| Symbol | `symbol` | Trading pair (e.g., BTCUSDT) |
| Candle Interval | `candle_interval` | Timeframe (e.g., 5min) |
| Max Trades | `max_trades` | Maximum concurrent positions |
| Leverage | `leverage` | Position leverage multiplier |
| Capital | `capital` | Total trading capital |
| Risk Amount | `risk_amount` | Risk per trade ($ or %) |
| Risk Type | `risk_type` | 'fixed' or 'percent' |
| Daily Target Type | `daily_target_type` | 'fixed' or 'percent' |
| Daily Target Amount | `daily_target_amount` | Profit target value |
| Daily Stop Type | `daily_stop_type` | 'fixed' or 'percent' |
| Daily Stop Amount | `daily_stop_amount` | Loss limit value |
| GARCH Mode | `garch_mode` | 'auto' or 'custom' |
| Custom K% | `custom_k_pct` | Custom volatility (decimal) |
| Order Book Confirm | `use_orderbook_confirm` | Enable order book validation |
| Subdivisions | `subdivisions` | Grid subdivision levels |
| No Trade Band % | `no_trade_band_pct` | Neutral zone around VWAP |

## Technical Details

### Database Schema
All settings are stored in the `bot_configs` table with proper foreign key relationships to the `users` table. The `UNIQUE(user_id)` constraint ensures one config per user.

### Settings Flow
```
User changes settings in UI
    ↓
POST /api/bot/config
    ↓
updateBotConfig(userId, newSettings)
    ↓
Database UPDATE bot_configs
    ↓
Cron job runs (every minute)
    ↓
getRunningBots() loads all configs
    ↓
Bot uses loaded config for all decisions
```

### Environment Variables Required
- `POSTGRES_URL` or `STORAGE_POSTGRES_URL`: Database connection
- `CRON_SECRET` (optional): Protects cron endpoint
- `VERCEL_URL`: Auto-set by Vercel (now properly handled)

## Additional Improvements

The fix also includes:
- Better error handling for failed API calls
- Comprehensive logging for debugging
- Null safety checks for optional settings
- Proper TypeScript typing throughout

## Testing Locally

To test the cron job locally with your settings:

```bash
# Set environment variables
export POSTGRES_URL="your-database-url"
export CRON_SECRET="test-secret"

# Start your Next.js server
npm run dev

# In another terminal, trigger the cron job
curl -X POST http://localhost:3000/api/cron/bot-runner \
  -H "Authorization: Bearer test-secret" \
  -H "Content-Type: application/json"
```

Watch the console output for the settings logs to confirm your configuration is being loaded and used.

## Summary

✅ **Fixed**: Proper HTTPS URL construction for Vercel deployments  
✅ **Fixed**: All user settings now persist and are used by background bot  
✅ **Enhanced**: Added comprehensive logging for debugging  
✅ **Improved**: Better null safety and error handling  

Your bot will now correctly use all your configured settings including custom GARCH levels, position sizing, daily limits, and all other parameters!
