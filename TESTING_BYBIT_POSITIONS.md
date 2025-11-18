# Testing Bybit Position Synchronization

## Quick Test Guide

### Prerequisites
✅ Bybit API keys configured in bot settings  
✅ Bot connected to Bybit (testnet or mainnet)  
✅ At least one active position on Bybit  

## Test Scenarios

### 1. **View External Positions on Dashboard**

**Steps:**
1. Open a position manually on Bybit (web or mobile app)
   - Example: Buy 0.001 BTC at market price
2. Refresh your bot dashboard
3. Look for the position in "Active Positions" section

**Expected Results:**
- ✅ Position appears in Active Positions
- ✅ Shows "External Position (Bybit)" as the reason
- ✅ Displays correct side (LONG/SHORT)
- ✅ Shows average entry price from Bybit
- ✅ Shows real-time unrealized P&L from Bybit
- ✅ "Active Trades" metric increases (e.g., 1/3 → 2/3)

---

### 2. **Max Trades Limit Enforcement**

**Steps:**
1. Set bot `max_trades` to **2** in settings
2. Let bot create **1 trade** via signal
3. Manually open **1 position** on Bybit (different symbol)
4. Wait for next bot signal (should be within a few minutes)

**Expected Results:**
- ✅ Frontend shows 2/2 active trades
- ✅ Bot detects signal but blocks new trade
- ✅ Activity log shows: "Trade signal ignored - max trades reached (2/2, 1 external)"
- ✅ Console logs show:
  ```
  Open trades: 2/2 (DB: 1, External: 1)
  Found 1 external position(s) on Bybit not tracked in database:
    - ETHUSDT: LONG 0.0050, Avg: $3,245.00, PnL: $12.50
  Trade blocked - Max trades reached (2/2, includes 1 external positions)
  ```

---

### 3. **External Position Closes**

**Steps:**
1. Have bot at max trades (e.g., 2/2) with 1 external position
2. Close the external position on Bybit
3. Wait **1-2 minutes** for next cron cycle
4. Check dashboard

**Expected Results:**
- ✅ Active trades decreases (2/2 → 1/2)
- ✅ External position removed from Active Positions
- ✅ Bot can create new trades again
- ✅ Next signal triggers new trade successfully

---

### 4. **Real-Time Updates (SSE Stream)**

**Steps:**
1. Open dashboard with bot running
2. Keep dashboard open (don't refresh)
3. Open a position on Bybit (different device/tab)
4. Watch the dashboard

**Expected Results:**
- ✅ New position appears within **500ms** on dashboard
- ✅ No page refresh needed
- ✅ Active trade count updates automatically
- ✅ Unrealized P&L updates in real-time

---

### 5. **Multiple External Positions**

**Steps:**
1. Set `max_trades` to **5**
2. Bot has **1 trade** in database
3. Manually open **3 positions** on Bybit (different symbols)
4. Check dashboard and wait for bot signal

**Expected Results:**
- ✅ Dashboard shows 4/5 active trades
- ✅ All 3 external positions visible in Active Positions
- ✅ Each marked "External Position (Bybit)"
- ✅ Bot can create **1 more trade** (4/5 → 5/5)
- ✅ After 5/5, bot blocks new trades

---

## Verification Checklist

### Frontend Display
- [ ] External positions appear in Active Positions section
- [ ] Each shows unrealized P&L from Bybit
- [ ] Active Trades metric includes external positions
- [ ] Positions marked with "External Position (Bybit)"
- [ ] Correct entry price, TP, SL displayed
- [ ] Real-time updates work (no refresh needed)

### Bot Behavior
- [ ] Bot counts external positions in max_trades check
- [ ] Bot blocks trades when limit reached (including external)
- [ ] Activity logs show external position count
- [ ] Console logs list external positions with details
- [ ] Bot resumes trading after external positions close

### Edge Cases
- [ ] Works with 0 external positions (normal operation)
- [ ] Works with all external positions (no DB trades)
- [ ] Handles Bybit API failures gracefully (logs warning, continues)
- [ ] Handles multiple positions on same symbol
- [ ] Works on both testnet and mainnet

---

## Console Logs to Look For

### Successful External Position Detection
```
[BOT STATUS] Active positions: 3 (DB: 1, Bybit external: 2)
```

### Bot Runner Max Trades Check
```
[CRON] Open trades: 3/3 (DB: 1, External: 2)
[CRON] Found 2 external position(s) on Bybit not tracked in database:
  - ETHUSDT: LONG 0.0050, Avg: $3,245.00, PnL: $12.50
  - SOLUSDT: SHORT 0.5000, Avg: $198.75, PnL: -$3.20
[CRON] Trade blocked - Max trades reached (3/3, includes 2 external positions)
```

### Activity Log Entry
```
Trade signal ignored - max trades reached (3/3, 2 external)
```

---

## Troubleshooting

### External Positions Not Showing

**Check:**
1. Are Bybit API keys configured? (Settings page)
2. Are API keys valid? (Try manual API test)
3. Check browser console for errors
4. Verify positions exist on Bybit (web app)
5. Wait 1 minute for SSE stream update

**Fix:**
- Reconfigure API keys
- Refresh dashboard
- Check `/api/bot/status` endpoint response

---

### Bot Not Respecting Max Trades

**Check:**
1. Is bot using correct API keys?
2. Check cron job logs for position fetch
3. Verify `max_trades` setting value
4. Check if Bybit API call succeeds

**Fix:**
- Check console logs: `[CRON] Failed to fetch Bybit positions`
- If API fails, bot falls back to DB count only
- Verify Bybit API key permissions include "Position" read access

---

### Unrealized P&L Incorrect

**Check:**
1. For external positions: P&L comes directly from Bybit
2. For DB trades: P&L calculated from current price
3. Current price updating? (Check WebSocket connection)

**Fix:**
- Refresh page to resync
- Check WebSocket status (should show "🟢 Live")
- Verify position size matches Bybit

---

## API Endpoints to Test

### Get Bot Status (includes Bybit positions)
```bash
GET /api/bot/status
```

**Response includes:**
```json
{
  "bybitPositions": [
    {
      "symbol": "ETHUSDT",
      "side": "LONG",
      "size": 0.005,
      "avgPrice": 3245.0,
      "unrealisedPnl": 12.5,
      ...
    }
  ],
  "totalActivePositions": 3
}
```

### SSE Stream (real-time updates)
```bash
GET /api/trades/stream
```

**Stream sends:**
```json
{
  "type": "trades",
  "trades": [
    {
      "id": "bybit-ETHUSDT",
      "status": "open",
      "reason": "External Position (Bybit)",
      "pnl": 12.5,
      ...
    }
  ]
}
```

---

## Success Criteria

✅ All external Bybit positions visible on dashboard  
✅ Bot respects max_trades including external positions  
✅ Real-time P&L displayed from Bybit  
✅ Bot logs show external position details  
✅ Activity logs explain max trades blocks  
✅ Works on both testnet and mainnet  
✅ Gracefully handles API failures  

---

## Next Steps After Testing

Once you've verified everything works:
1. ✅ Set appropriate `max_trades` limit for your account
2. ✅ Monitor activity logs for external position detection
3. ✅ Use both bot and manual trading confidently
4. ✅ Bot will always respect your total position exposure

**The bot is now fully aware of your entire Bybit trading activity!** 🎉
